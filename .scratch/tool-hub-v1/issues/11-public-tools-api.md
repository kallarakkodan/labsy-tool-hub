# 11 — GET /api/tools and GET /api/tools/[id]

Status: ready-for-agent
Phase: P1
Blocked by: 10, 04
Spec: PRD §9.1, PRD §6 (published vs visibility), CONTEXT §7.4, CONTEXT §9

## Why

The first read path, and the template every later read path copies. Getting the
visibility scoping right here sets the pattern.

## Scope

- `GET /api/tools` — `?q=&category=&sort=newest|name|size&page=&limit=`
  (default limit 100). Returns `{ tools, total, categories: [{ name, count }] }`.
- `GET /api/tools/[id]` — resolves by **id or slug**.
- Both scope with `where: { ...toolVisibilityWhere(isAdmin), ...filters }` where
  `isAdmin` comes from `await getSession()` — stubbed to `false` until issue 18,
  wired then.
- An admin session additionally sees drafts and internal tools, each flagged in
  the payload so the UI can badge them.
- Categories derived with `SELECT DISTINCT category` scoped to the same
  visibility (PRD §6).
- All responses through `serializeTool`. `export const dynamic = 'force-dynamic'`.

## Done when

- [ ] Test: anonymous `/api/tools` excludes `published: false` and
      `visibility: "admin"` rows
- [ ] Test: `/api/tools/[id]` for an out-of-scope tool returns **404, not 403**
- [ ] Test: an admin session sees both, correctly flagged
- [ ] Test: category counts match the scoped set (an internal tool must not
      inflate a public category's count)

## Watch out

- `isAdmin` never comes from a query param or header (CONTEXT §7.4).
- Sorting by size sorts a `BigInt` column — do it in SQL, not after
  serialisation to strings.
- CONTEXT §9 asks for a visibility test case **per read path**. This issue owns
  the first two; every later read path adds its own.
