# 11 — GET /api/tools and GET /api/tools/[id]

Status: resolved
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

- [x] Test: anonymous `/api/tools` excludes `published: false` and
      `visibility: "admin"` rows
- [x] Test: `/api/tools/[id]` for an out-of-scope tool returns **404, not 403**
- [x] Test: an admin session sees both, correctly flagged
- [x] Test: category counts match the scoped set (an internal tool must not
      inflate a public category's count)

## Watch out

- `isAdmin` never comes from a query param or header (CONTEXT §7.4).
- Sorting by size sorts a `BigInt` column — do it in SQL, not after
  serialisation to strings.
- CONTEXT §9 asks for a visibility test case **per read path**. This issue owns
  the first two; every later read path adds its own.

## Answer

`GET /api/tools` and `GET /api/tools/[id]` are in, with 17 tests, and verified
against the real seeded catalogue: 4 of the 6 seeded tools are visible
anonymously, the draft and the internal tool each 404, and — the case worth
looking at — the **"Drivers" category disappears from the filter list entirely**,
because the only tool in it is `visibility: "admin"`.

Three things worth recording:

- **The query logic lives in `lib/tools.ts`, not in the route.** The public page
  is a Server Component (CONTEXT §6), so it needs the same scoped query. Having
  the page fetch its own `/api/tools` would be an HTTP round trip to itself, and
  worse, would make it possible for the page and the API to scope differently.
  One implementation, two callers.
- **Category counts are scoped by the same visibility rule as the list.**
  Counting unscoped is a small leak but a real one: it tells an anonymous
  visitor that something exists in "Drivers" they cannot see. The counts also
  deliberately ignore the active search, since the pills show what is available
  to pick, not what the current filter already narrowed to.
- **Sorting by size happens in SQL.** After serialisation `fileSize` is a
  string, and a lexicographic sort puts `"300"` ahead of `"9007199254740993"`.
  There is a test with exactly those two values.

`lib/auth.ts` now exists with **only** `isAdmin()`, hard-coded to `false`, as
this issue specified. It is a whole module rather than an inline `false` at each
call site so issue 18 changes one function body instead of hunting for the
places that guessed. There is a test asserting `?isAdmin=true&admin=1` does not
widen scope — the thing CONTEXT §7.4 warns about.

Next 16 note: `params` is a Promise, and the generated `RouteContext<"/api/tools/[id]">`
type covers it.
