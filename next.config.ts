import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseHostname = supabaseUrl.replace("https://", "");

const nextConfig: NextConfig = {
  // Lean self-contained server bundle for the Docker simulation image
  // (see docs/SIM.md). No effect on Vercel, which ignores `output`.
  output: "standalone",
  // Skip type-check and lint ONLY when building inside Docker (DOCKER_BUILD=true).
  // The Docker VM budget is too tight for the tsc worker alongside the compiler.
  // DOCKER_BUILD is never set in CI or on Vercel, so both paths still enforce types
  // and lint: CI runs `pnpm typecheck` (.github/workflows/test.yml) and Vercel prod
  // builds run `next build` with the gate off. Only the throwaway sim image skips them.
  typescript: {
    ignoreBuildErrors: process.env.DOCKER_BUILD === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.DOCKER_BUILD === "true",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHostname,
      },
    ],
  },
  experimental: {
    serverActions: {
      // Raises NEXT'S OWN body limit (1MB by default) so it is never the
      // binding constraint. It does NOT raise Vercel's ~4.5MB per-request
      // limit, which is enforced at the edge before this process is reached
      // and cannot be configured from here.
      //
      // So this number is not a promise about what users can upload. The
      // enforced CV cap lives in lib/config/upload-limits.ts and must stay
      // under the PLATFORM limit, not under this one. Reading this setting as
      // "we accept 25MB uploads" is exactly the mistake that shipped a 10MB
      // CV cap the platform silently rejected at 4.6MB.
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // camera omitted: browser default allows it with explicit user grant,
            // which is the correct behaviour for the QR scanner on /admin/check-in.
            // camera=() would block it even after the user accepts the prompt.
            key: "Permissions-Policy",
            value: "microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              `img-src 'self' data: blob: ${supabaseUrl} https://lh3.googleusercontent.com`,
              "font-src 'self'",
              `connect-src 'self' ${supabaseUrl} https://challenges.cloudflare.com`,
              "frame-src 'self' https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://drive.google.com",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
