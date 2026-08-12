# 02 — Design tokens, self-hosted fonts, palette lint rule

Status: resolved
Phase: P0
Blocked by: 01
Spec: PRD §5, CONTEXT §5, CONTEXT §8 step 1

## Why

The token set is normative (PRD §5) and the server has **no internet egress**, so
fonts must be self-hosted. Landing this before any UI means no component is ever
written against a default Tailwind colour.

## Scope

- `src/app/globals.css` exactly as CONTEXT §5 specifies: `@theme` block, body
  background + fixed radial gradient, heading letter-spacing.
- Inter and JetBrains Mono via `next/font/local`, subset `latin`, `display: swap`,
  preloaded. Font files committed under `src/app/fonts/`.
- `src/app/layout.tsx`: `<html class="dark">`, font variables applied, metadata.
- ESLint rule (`no-restricted-syntax` on `className` string literals) banning the
  list in CONTEXT §5: `bg-gray-*`, `text-zinc-*`, `bg-black`, `text-white`,
  `bg-green-*`, `shadow-lg|xl|2xl`, `rounded-full`, `bg-gradient-to-*`,
  `backdrop-blur-lg`+.
- A `prefers-reduced-motion` utility or convention for the card-hover transform.

## Done when

- [x] A blank page renders `#0A0A0B` with the top radial gradient visible
- [x] Both fonts load from local files with the network throttled/offline
- [x] `pnpm lint` fails on a deliberately added `className="bg-gray-800"`

## Watch out

- `rounded-full` is banned generally but **allowed** for status dots ≤ 8px and
  icon chips (PRD §5.3). Add an eslint-disable convention for those two cases
  rather than weakening the rule.
- The gradient is `background-attachment: fixed` — one gradient, whole app, not
  per-section.

## Answer

Tokens, fonts, and the palette rule are in. Verified against the CSS the dev
server actually serves, not just the source: `--color-base: #0a0a0b`,
`--color-accent: #10b981`, `--radius-card: 8px`, the radial gradient, and both
woff2 files returning 200 at full size (48 KB Inter, 40 KB JetBrains Mono) with
`content-type: font/woff2`.

Deviations from this issue as written:

- **`@theme` points at the generated font variables, not the literal family
  names.** CONTEXT §5 writes `--font-sans: "Inter", ...`, but `next/font/local`
  emits an obfuscated `@font-face` family (`"inter"`, per the generated
  `--font-inter`), so the literal name would have resolved to the system
  fallback and looked *almost* right. Now `--font-sans: var(--font-inter), …`.
  CONTEXT §5's snippet is still correct as a token list; this is the one line
  that has to differ once the fonts are self-hosted.
- **Variable fonts, one file each**, rather than one static file per weight.
  PRD §5.2 wants Inter 400/500/600 and JetBrains Mono 400 — four files against
  two, and the two are smaller. Provenance in `src/app/fonts/README.md`;
  `@fontsource-variable/*` is not kept as a dependency.
- **`shadow-overlay` added as a `@utility`** so PRD §5.3's single permitted
  shadow has a name, and every other `shadow-*` can stay banned.

The lint rule covers more than the CONTEXT §5 list: also `slate`/`neutral`/
`stone` greys, `red`/`rose`, and `amber`/`yellow`/`orange`, since those are the
other obvious ways to reach past the tokens. It matches both plain strings and
template literals, and each message names the token to use instead.

`tests/design-system.test.ts` runs ESLint programmatically over two fixtures —
one violating (asserts ≥7 errors), one built entirely from CONTEXT §5's
component recipes (asserts zero). The second is the one that matters: it stops
a future tightening of the patterns from quietly banning `bg-surface-hover` or
`backdrop-blur-sm`.

Still deferred to the components that need them: the `rounded-full`
eslint-disable convention for status dots and icon chips (issue 13 ships the
first one), and `prefers-reduced-motion` handling (issue 15's card hover).
