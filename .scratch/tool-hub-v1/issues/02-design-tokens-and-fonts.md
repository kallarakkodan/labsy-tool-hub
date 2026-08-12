# 02 — Design tokens, self-hosted fonts, palette lint rule

Status: ready-for-agent
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

- [ ] A blank page renders `#0A0A0B` with the top radial gradient visible
- [ ] Both fonts load from local files with the network throttled/offline
- [ ] `pnpm lint` fails on a deliberately added `className="bg-gray-800"`

## Watch out

- `rounded-full` is banned generally but **allowed** for status dots ≤ 8px and
  icon chips (PRD §5.3). Add an eslint-disable convention for those two cases
  rather than weakening the rule.
- The gradient is `background-attachment: fixed` — one gradient, whole app, not
  per-section.
