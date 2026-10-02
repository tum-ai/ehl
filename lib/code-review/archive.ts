import { unzipSync } from "fflate";
import { CAPTURE_LIMITS } from "@/lib/submission-snapshots/types";
import { strictRepository } from "@/lib/submission-snapshots/types";

export function readRepositoryZip(bytes: Uint8Array): Map<string, string> {
  if (bytes.byteLength > CAPTURE_LIMITS.archiveBytes)
    throw new Error("Repository archive exceeds download limit");
  let expanded = 0,
    count = 0;
  const paths = new Set<string>();
  const archive = unzipSync(bytes, {
    filter: (file) => {
      count++;
      expanded += file.originalSize;
      if (
        count > CAPTURE_LIMITS.archiveFiles ||
        expanded > CAPTURE_LIMITS.expandedBytes
      )
        throw new Error("Repository archive exceeds expansion limit");
      const segments = file.name.split("/");
      if (
        file.name.startsWith("/") ||
        segments.includes("..") ||
        file.name.includes("\\") ||
        /[\x00-\x1f]/.test(file.name)
      )
        throw new Error("Unsafe archive path");
      const path = segments.slice(1).join("/");
      if (paths.has(path)) throw new Error("Duplicate archive path");
      paths.add(path);
      // Reviews historically omit files larger than 50 KB. Never extract to disk.
      return !file.name.endsWith("/") && file.originalSize <= 50000;
    },
  });
  const files = new Map<string, string>();
  for (const [name, bytes] of Object.entries(archive)) {
    const path = name.split("/").slice(1).join("/");
    if (path && !bytes.includes(0))
      files.set(path, new TextDecoder().decode(bytes));
  }
  return files;
}

export async function downloadCapturedArchive(
  github: { request(path: string): Promise<Response> },
  repoUrl: string,
  sha: string,
): Promise<Map<string, string>> {
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error("An exact commit SHA is required");
  const { owner, repo } = strictRepository(repoUrl);
  let response = await github.request(`/repos/${owner}/${repo}/zipball/${sha}`);
  if (response.status === 302) {
    const location = new URL(response.headers.get("location") ?? "");
    if (
      location.protocol !== "https:" ||
      location.hostname !== "codeload.github.com"
    )
      throw new Error("Unexpected archive redirect");
    // Signed archive URL: never forward the API Authorization header.
    response = await fetch(location, {
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      cache: "no-store",
    });
  }
  if (!response.ok || !response.body)
    throw new Error("Could not download frozen repository archive");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CAPTURE_LIMITS.archiveBytes)
        throw new Error("Repository archive exceeds download limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return readRepositoryZip(bytes);
}
