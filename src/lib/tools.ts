import type { Prisma } from "@/generated/prisma/client";
import { prisma, toolVisibilityWhere } from "@/lib/db";
import { serializeTool } from "@/lib/serialize";
import type { ToolsQuery } from "@/lib/validation";
import type { SerializedTool } from "@/types";

/*
 * Catalogue reads, shared by the API route and the RSC page.
 *
 * The public page renders on the server (CONTEXT §6), so it needs the same query
 * the API performs. Putting it here rather than having the page fetch its own
 * `/api/tools` avoids an HTTP round trip to itself — and, more importantly, keeps
 * one implementation of the visibility scoping instead of two.
 */

export interface CategoryCount {
  name: string;
  count: number;
}

export interface ToolListResult {
  tools: SerializedTool[];
  total: number;
  categories: CategoryCount[];
}

const ORDER_BY: Record<ToolsQuery["sort"], Prisma.ToolOrderByWithRelationInput> = {
  newest: { createdAt: "desc" },
  name: { name: "asc" },
  // Sorted in SQL, not after serialisation — `fileSize` becomes a string at the
  // boundary and would then sort lexicographically ("9" before "10000000000").
  size: { fileSize: "desc" },
};

export async function listTools(query: ToolsQuery, isAdmin: boolean): Promise<ToolListResult> {
  const where: Prisma.ToolWhereInput = {
    ...toolVisibilityWhere(isAdmin),
    ...searchWhere(query.q),
    ...(query.category ? { category: query.category } : {}),
  };

  const [tools, total, categories] = await Promise.all([
    prisma.tool.findMany({
      where,
      orderBy: ORDER_BY[query.sort],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.tool.count({ where }),
    countCategories(isAdmin),
  ]);

  return { tools: tools.map(serializeTool), total, categories };
}

/** By id or slug — PRD §9.1. Returns null when out of scope, so the caller 404s. */
export async function findTool(idOrSlug: string, isAdmin: boolean) {
  return prisma.tool.findFirst({
    where: {
      ...toolVisibilityWhere(isAdmin),
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
  });
}

/**
 * Category counts for the filter pills.
 *
 * Scoped by the same visibility rule as the list. Counting unscoped would make
 * an internal tool inflate a public category's badge — a small leak, but a real
 * one: it tells an anonymous visitor that something exists in "Drivers" that
 * they cannot see.
 *
 * Deliberately ignores the active search and category filter: the pills show
 * what is available to pick, not what the current filter already narrowed to.
 */
async function countCategories(isAdmin: boolean): Promise<CategoryCount[]> {
  const grouped = await prisma.tool.groupBy({
    by: ["category"],
    where: toolVisibilityWhere(isAdmin),
    _count: { category: true },
  });

  return grouped
    .map((row) => ({ name: row.category, count: row._count.category }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Matches name, description, category, and version (PRD §7.1).
 *
 * SQLite's LIKE is case-insensitive for ASCII by default, which is why there is
 * no `mode: "insensitive"` here — that option is a no-op on SQLite and its
 * presence would imply a guarantee this database does not make for non-ASCII.
 */
function searchWhere(q: string | undefined): Prisma.ToolWhereInput {
  if (!q) return {};
  return {
    OR: [
      { name: { contains: q } },
      { description: { contains: q } },
      { category: { contains: q } },
      { version: { contains: q } },
    ],
  };
}
