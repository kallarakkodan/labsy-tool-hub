import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /*
     * Next 16's proxy (the renamed middleware) silently truncates any request
     * body over 10 MB by default — undocumented in PRD/CONTEXT because it is a
     * Next implementation detail, not a Labsy decision, and only surfaces
     * against a real server (`src/proxy.ts`'s matcher deliberately covers
     * `/api/**`, so every upload chunk passes through it). The default
     * `CHUNK_SIZE` is 16 MiB, well over that cap, so every chunk PUT would be
     * silently corrupted without this.
     *
     * Set to match nginx's own ceiling (PRD §12.4's `client_max_body_size 32m`)
     * rather than the smaller default CHUNK_SIZE, so raising CHUNK_SIZE later
     * stays a config change instead of hitting a second, lower limit here.
     */
    proxyClientMaxBodySize: "32mb",
  },
};

export default nextConfig;
