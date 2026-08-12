import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/*
 * CONTEXT §5 bans a specific list of utility classes in src/. Most of the design
 * system is enforced by review, but the palette is enforced here — a stray
 * `bg-gray-800` looks fine in isolation and only reads as wrong next to the
 * token colours, which is exactly the kind of drift review misses.
 *
 * Each entry is [pattern, why]. Patterns are matched against the whole className
 * string, with \b guards so `bg-surface-hover` is not caught by a `bg-s...` rule.
 */
const BANNED_CLASS_PATTERNS = [
  ["\\bbg-(?:gray|zinc|slate|neutral|stone)-\\d", "use bg-base / bg-surface / bg-inset"],
  ["\\btext-(?:gray|zinc|slate|neutral|stone)-\\d", "use text-fg / text-fg-muted / text-fg-subtle"],
  ["\\bborder-(?:gray|zinc|slate|neutral|stone)-\\d", "use border-border / border-border-hover"],
  ["\\bbg-(?:green|emerald)-\\d", "use bg-accent"],
  ["\\btext-(?:green|emerald)-\\d", "use text-accent"],
  ["\\bbg-(?:red|rose)-\\d", "use bg-danger"],
  ["\\btext-(?:red|rose)-\\d", "use text-danger"],
  ["\\b(?:bg|text)-(?:amber|yellow|orange)-\\d", "use the warning token"],
  ["\\bbg-black\\b", "the page background is bg-base (#0A0A0B), never pure black"],
  ["\\btext-white\\b", "use text-fg"],
  ["\\bshadow-(?:lg|xl|2xl)\\b", "elevation is borders, not shadows — see shadow-overlay"],
  ["\\bbg-gradient-to-", "one radial gradient on body, nothing else"],
  ["\\bbackdrop-blur-(?:lg|xl|2xl|3xl)\\b", "backdrop-blur-sm on the header is the ceiling"],
  ["\\brounded-full\\b", "6px/8px radii; allowed only for status dots and icon chips"],
];

const bannedClassSelectors = BANNED_CLASS_PATTERNS.flatMap(([pattern, why]) => {
  const message = `Banned by the design system (CONTEXT §5): ${why}. If this is one of the documented exceptions, disable the rule on the line with a comment saying which.`;
  return [
    {
      selector: `JSXAttribute[name.name='className'] Literal[value=/${pattern}/]`,
      message,
    },
    {
      selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${pattern}/]`,
      message,
    },
  ];
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...bannedClassSelectors],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
