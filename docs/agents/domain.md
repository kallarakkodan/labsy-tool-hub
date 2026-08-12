# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a **single-context** repo:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── src/
```

Multi-context layout (a root `CONTEXT-MAP.md` pointing at per-context `CONTEXT.md` files) is not in use here and should not be introduced without a real reason — there is one deployable and one bounded context.

## Repo-specific notes

Two root documents predate this setup and serve different purposes. Read both; do not conflate them:

- **`PRD.md`** — requirements, API contract, security model, deployment, acceptance criteria, and the resolved-decisions log (§16). This is the authority on *what* and *why*. §16 functions as a lightweight ADR set; when writing a new ADR under `docs/adr/`, check §16 first and cross-reference rather than restating.
- **`CONTEXT.md`** — currently implementation conventions: the gotchas, design tokens, code patterns, and build order. It is the authority on *how we build it here*.

`CONTEXT.md` does **not** yet contain a domain glossary. Its §11 Glossary is a short term list, not a modelled ubiquitous language. When `/domain-modeling` resolves a term, add it there and grow that section into a proper glossary rather than creating a second file.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

Established terms so far: **Tool**, **STORAGE_ROOT**, **Server path source**, **Direct upload**, **Chunk**, **Draft**, **Internal**, **Stale**, **fileMissing**, **isSeed**, **NPM**, **X-Accel-Redirect**.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

The same applies to PRD §16 decisions (D1–D5). Those were made deliberately with recorded reasoning and revisit triggers; contradict them explicitly, citing the trigger that has been met, rather than quietly.
