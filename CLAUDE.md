# Labsy Tool Hub

Internal LAN file distribution platform. Next.js 15 + Prisma/SQLite, serving large binary artifacts (OS images, installers, deployers) over the LAN behind Nginx Proxy Manager.

- **[PRD.md](./PRD.md)** — requirements, API contract, security model, deployment, acceptance criteria, resolved decisions (§16)
- **[CONTEXT.md](./CONTEXT.md)** — implementation conventions, design tokens, gotchas, build order

The project is pre-scaffold: both documents exist, no code yet. Start at CONTEXT.md §8 (build order).

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature>/` — this repo has no git remote. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. Written as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. PRD §16 holds existing decisions and should be checked before writing a new ADR. See `docs/agents/domain.md`.
