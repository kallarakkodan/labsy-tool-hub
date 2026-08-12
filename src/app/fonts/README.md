# Self-hosted fonts

Two `latin`-subset **variable** woff2 files, committed deliberately. PRD §5.2
requires self-hosting: the production server has no internet egress, so a
Google Fonts URL would render the UI in a fallback face and nobody would notice
until it was in front of a customer.

Variable rather than one file per weight — PRD §5.2 wants Inter 400/500/600 and
JetBrains Mono 400, which would be four static files against these two.

| File | Source |
|---|---|
| `inter-latin-wght-normal.woff2` | `@fontsource-variable/inter@5.3.0` |
| `jetbrains-mono-latin-wght-normal.woff2` | `@fontsource-variable/jetbrains-mono@5.3.0` |

To update, take the file from the package rather than a CDN:

```bash
pnpm add -D @fontsource-variable/inter@latest
cp node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2 src/app/fonts/
pnpm remove @fontsource-variable/inter
```

The package is not kept as a dependency — the committed file is the source of
truth, and nothing at build or run time resolves it from `node_modules`.
