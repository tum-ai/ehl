import { getSettingValue, SETTING_KEYS } from "@/lib/settings";
import { parseGitHubRepo } from "@/lib/github";
import type { RepoMetadata } from "@/lib/types";

export interface RepoFile {
  path: string;
  content: string;
}

export interface IngestedRepo {
  files: RepoFile[];
  metadata: RepoMetadata;
}

// ─── Language detection ─────────────────────────────────────

const EXT_LANGUAGE: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript",
  py: "Python",
  java: "Java",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++",
  c: "C", h: "C",
  swift: "Swift",
  kt: "Kotlin",
  scala: "Scala",
  vue: "Vue",
  svelte: "Svelte",
  dart: "Dart",
  css: "CSS", scss: "SCSS", less: "LESS",
  html: "HTML",
  sql: "SQL",
  sh: "Shell", bash: "Shell", zsh: "Shell",
};

const RELEVANT_EXTENSIONS = new Set(Object.keys(EXT_LANGUAGE).concat([
  "json", "yaml", "yml", "toml", "md", "prisma", "graphql", "proto",
]));

const RELEVANT_FILES = new Set([
  "README.md", "readme.md", "README.rst", "package.json", "requirements.txt",
  "Cargo.toml", "go.mod", "Gemfile", "build.gradle", "pom.xml",
  "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
  ".env.example", "Makefile", "Procfile",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".next", "dist", "build", ".git", "vendor",
  "__pycache__", ".venv", "venv", "target", "coverage", ".cache",
  ".husky", ".idea", ".vscode", "out", ".turbo",
]);

const TEST_DIRS = new Set([
  "__tests__", "tests", "test", "spec", "specs", "e2e", "cypress",
]);

// ─── Framework detection from package.json ───────────────────

const FRAMEWORK_PATTERNS: Record<string, string[]> = {
  "Next.js": ["next"],
  "React": ["react"],
  "Vue": ["vue"],
  "Angular": ["@angular/core"],
  "Svelte": ["svelte"],
  "Express": ["express"],
  "Fastify": ["fastify"],
  "NestJS": ["@nestjs/core"],
  "Django": [],  // detected from requirements.txt
  "Flask": [],
  "FastAPI": [],
  "Tailwind CSS": ["tailwindcss"],
  "Prisma": ["prisma", "@prisma/client"],
  "Supabase": ["@supabase/supabase-js"],
  "Firebase": ["firebase"],
  "Stripe": ["stripe"],
};

function detectFrameworks(files: RepoFile[]): string[] {
  const frameworks: string[] = [];

  const packageJson = files.find((f) => f.path === "package.json");
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson.content);
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      for (const [framework, packages] of Object.entries(FRAMEWORK_PATTERNS)) {
        if (packages.some((p) => p in allDeps)) {
          frameworks.push(framework);
        }
      }
    } catch { /* skip */ }
  }

  // Python frameworks from requirements.txt
  const reqTxt = files.find((f) =>
    f.path === "requirements.txt" || f.path === "requirements/base.txt"
  );
  if (reqTxt) {
    const content = reqTxt.content.toLowerCase();
    if (content.includes("django")) frameworks.push("Django");
    if (content.includes("flask")) frameworks.push("Flask");
    if (content.includes("fastapi")) frameworks.push("FastAPI");
  }

  return [...new Set(frameworks)];
}

// ─── Main ingestion function ─────────────────────────────────

async function getHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "EHL-Code-Review",
  };
  const token = await getSettingValue(SETTING_KEYS.GITHUB_TOKEN, process.env.GITHUB_TOKEN);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function isIgnoredPath(path: string): boolean {
  return IGNORE_DIRS.has(path.split("/")[0]) ||
    path.split("/").some((segment) => IGNORE_DIRS.has(segment));
}

function getExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function isRelevantFile(path: string): boolean {
  const filename = path.split("/").pop() ?? "";
  if (RELEVANT_FILES.has(filename)) return true;
  return RELEVANT_EXTENSIONS.has(getExtension(path));
}

export async function ingestRepo(
  repoUrl: string,
  tokenBudget: number = 50000
): Promise<IngestedRepo> {
  const parsed = parseGitHubRepo(repoUrl);
  if (!parsed) throw new Error("Invalid GitHub URL");

  const { owner, repo } = parsed;
  const cleanRepo = repo.replace(/\.git$/, "");
  const headers = await getHeaders();

  // Get repo info (default branch + metadata)
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${cleanRepo}`, { headers });
  if (!repoRes.ok) throw new Error(`GitHub API error: ${repoRes.status}`);
  const repoData = await repoRes.json();
  const defaultBranch = repoData.default_branch || "main";

  // Get tree recursively
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${cleanRepo}/git/trees/${defaultBranch}?recursive=1`,
    { headers }
  );
  if (!treeRes.ok) throw new Error(`GitHub tree API error: ${treeRes.status}`);
  const treeData = await treeRes.json();
  const treeItems = (treeData.tree ?? []) as Array<{
    path: string; type: string; size?: number; sha: string; mode?: string;
  }>;

  // Get commit count (from first page with per_page=1, read total from Link header)
  let commitCount = 0;
  try {
    const commitsRes = await fetch(
      `https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=1`,
      { headers }
    );
    if (commitsRes.ok) {
      const linkHeader = commitsRes.headers.get("link") ?? "";
      const lastMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
      commitCount = lastMatch ? parseInt(lastMatch[1]) : 1;
    }
  } catch { /* skip */ }

  // Analyze tree for metadata
  const allBlobs = treeItems.filter((i) => i.type === "blob");
  const languages: Record<string, number> = {};
  let hasReadme = false;
  let hasDockerfile = false;
  let hasTests = false;
  let hasCi = false;

  for (const item of allBlobs) {
    if (isIgnoredPath(item.path)) continue;

    const filename = item.path.split("/").pop() ?? "";
    const ext = getExtension(item.path);
    const size = item.size ?? 0;

    // Language counting
    const lang = EXT_LANGUAGE[ext];
    if (lang) {
      const approxLoc = Math.max(1, Math.round(size / 40)); // ~40 bytes per line
      languages[lang] = (languages[lang] ?? 0) + approxLoc;
    }

    // Feature detection
    if (filename.toLowerCase().startsWith("readme")) hasReadme = true;
    if (filename === "Dockerfile" || filename === "docker-compose.yml") hasDockerfile = true;
    if (item.path.includes(".github/workflows/")) hasCi = true;
    if (item.path.split("/").some((s) => TEST_DIRS.has(s))) hasTests = true;
  }

  // Filter and download relevant files
  const relevantItems = allBlobs.filter((item) => {
    if (isIgnoredPath(item.path)) return false;
    if (!isRelevantFile(item.path)) return false;
    if (item.size && item.size > 50000) return false; // Skip files > 50KB
    return true;
  });

  // Sort: manifest/config files first, then by size ascending
  const PRIORITY_FILES = new Set([
    "README.md", "readme.md", "package.json", "requirements.txt",
    "Cargo.toml", "go.mod", "Dockerfile", "tsconfig.json",
  ]);

  relevantItems.sort((a, b) => {
    const aName = a.path.split("/").pop() ?? "";
    const bName = b.path.split("/").pop() ?? "";
    const aPriority = PRIORITY_FILES.has(aName) ? 0 : 1;
    const bPriority = PRIORITY_FILES.has(bName) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return (a.size ?? 0) - (b.size ?? 0);
  });

  // Download files within token budget
  const files: RepoFile[] = [];
  let totalChars = 0;
  const charBudget = tokenBudget * 4; // ~4 chars per token
  let sampled = false;

  for (const item of relevantItems) {
    if (totalChars >= charBudget) {
      sampled = true;
      break;
    }

    try {
      const contentRes = await fetch(
        `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${item.path}?ref=${defaultBranch}`,
        { headers }
      );
      if (!contentRes.ok) continue;

      const contentData = await contentRes.json();
      if (contentData.encoding !== "base64") continue;

      let decoded = Buffer.from(contentData.content, "base64").toString("utf-8");

      // Truncate large files
      if (decoded.length > 8000) {
        const lines = decoded.split("\n");
        if (lines.length > 200) {
          decoded = lines.slice(0, 200).join("\n") + "\n\n[TRUNCATED - showing first 200 lines]";
        }
      }

      if (totalChars + decoded.length > charBudget) {
        sampled = true;
        // Still include if it fits partially and is a priority file
        const name = item.path.split("/").pop() ?? "";
        if (!PRIORITY_FILES.has(name)) continue;
      }

      files.push({ path: item.path, content: decoded });
      totalChars += decoded.length;
    } catch {
      continue;
    }
  }

  // Determine primary language
  const langEntries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const primaryLanguage = langEntries[0]?.[0] ?? "Unknown";
  const totalLoc = langEntries.reduce((sum, [, loc]) => sum + loc, 0);

  // Detect frameworks
  const frameworksDetected = detectFrameworks(files);

  const metadata: RepoMetadata = {
    languages,
    total_loc: totalLoc,
    file_count: allBlobs.filter((i) => !isIgnoredPath(i.path)).length,
    commit_count: commitCount,
    has_readme: hasReadme,
    has_dockerfile: hasDockerfile,
    has_tests: hasTests,
    primary_language: primaryLanguage,
    frameworks_detected: frameworksDetected,
    token_count: Math.round(totalChars / 4),
    sampled,
  };

  return { files, metadata };
}
