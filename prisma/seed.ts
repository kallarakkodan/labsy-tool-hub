import { config as loadEnv } from "dotenv";
import { open, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createPrismaClient } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { formatBytes } from "../src/lib/format";

/*
 * Demo catalogue (PRD §15). Every row carries `isSeed: true` so `db:seed:clear`
 * removes them in one command and the empty state stays reachable without
 * hand-editing the database (CONTEXT §10).
 *
 * Placeholder files are **sparse** and carry their true sizes (ADR-0002): the
 * apparent size is 2.1 GB, the allocated size is ~0 blocks. That keeps
 * `Tool.fileSize` honest, so downloads, Range requests, and `sha256sum` all
 * work against seeded rows at realistic sizes for no disk.
 *
 * No Lorem Ipsum anywhere, including descriptions (CONTEXT §10).
 */

/*
 * This runs under tsx, not Next, so nothing has loaded .env.local. Same order
 * Next uses, and the same reason prisma.config.ts does it: without this the
 * seeder would build its own database somewhere else entirely.
 *
 * Safe at module scope because getEnv() is lazy — no import reads the
 * environment before this line executes.
 */
loadEnv({ path: [".env.local", ".env"], quiet: true });

/** Everything the seeder writes lives here, and this is the only thing it deletes. */
const SEED_SUBDIR = "seed";

interface SeedTool {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  fileName: string;
  fileSize: bigint;
  mimeType: string;
  featured?: boolean;
  published?: boolean;
  visibility?: "public" | "admin";
}

const SEED_TOOLS: SeedTool[] = [
  {
    slug: "ubuntu-22-04-4-lts-server",
    name: "Ubuntu 22.04.4 LTS Server",
    description:
      "Minimal server image with cloud-init and the standard Labsy provisioning overlay. Boots unattended from the deployer.",
    category: "OS Images",
    version: "22.04.4",
    fileName: "ubuntu-22.04.4-live-server-amd64.iso",
    fileSize: 2_100_000_000n,
    mimeType: "application/x-iso9660-image",
    featured: true,
  },
  {
    slug: "windows-11-dev-kit",
    name: "Windows 11 Dev Kit",
    description:
      "Developer workstation image with the toolchain and domain join scripts preinstalled. Awaiting sign-off on the December driver rollup.",
    category: "OS Images",
    version: "23H2",
    fileName: "windows-11-dev-kit-23h2.iso",
    fileSize: 5_800_000_000n,
    mimeType: "application/x-iso9660-image",
    // Draft: exercises the `published: false` badge and the anonymous-404 path.
    published: false,
  },
  {
    slug: "labsy-deployer",
    name: "Labsy Deployer",
    description:
      "Unattended installer that writes an image to a target machine and applies site configuration. Run from a technician laptop over the LAN.",
    category: "Utilities",
    version: "3.1.0",
    fileName: "labsy-deployer-3.1.0.exe",
    fileSize: 84_000_000n,
    mimeType: "application/vnd.microsoft.portable-executable",
  },
  {
    slug: "ventoy-multiboot-usb",
    name: "Ventoy Multiboot USB",
    description:
      "Prepared Ventoy payload for building a multiboot USB stick. Drop ISOs onto the partition and they appear in the boot menu.",
    category: "Utilities",
    version: "1.0.99",
    fileName: "ventoy-1.0.99-multiboot.img",
    fileSize: 62_000_000n,
    mimeType: "application/octet-stream",
  },
  {
    slug: "intel-network-driver-bundle",
    name: "Intel Network Driver Bundle",
    description:
      "Wired and wireless adapter drivers for the current fleet, repackaged for offline install. Vendor licence restricts redistribution outside Labsy.",
    category: "Drivers",
    version: "28.3",
    fileName: "intel-network-drivers-28.3.zip",
    fileSize: 412_000_000n,
    mimeType: "application/zip",
    // Internal: the licence-restricted vendor driver PRD §16 D3 uses as its example.
    visibility: "admin",
  },
  {
    slug: "nodejs-22-lts-offline-installer",
    name: "Node.js 22 LTS Offline Installer",
    description:
      "Offline Node.js runtime for build agents with no internet egress. Includes the bundled npm release and the corepack shim.",
    category: "Dev Tools",
    version: "22.11.0",
    fileName: "node-v22.11.0-offline-installer.msi",
    fileSize: 118_000_000n,
    mimeType: "application/octet-stream",
  },
];

/**
 * Create a sparse placeholder: a file whose apparent size is `size` and whose
 * allocated size is ~0. `ftruncate` past EOF leaves a hole on ext4 and APFS.
 */
async function writeSparseFile(absolute: string, size: bigint): Promise<void> {
  const handle = await open(absolute, "w");
  try {
    await handle.truncate(Number(size));
  } finally {
    await handle.close();
  }
}

/**
 * Absolute, resolved. `STORAGE_ROOT` is a relative path in development
 * (`./storage`), and comparing a relative path against a resolved one is how the
 * deletion guard below silently compares apples to oranges.
 */
function seedDir(): string {
  return path.resolve(getEnv().STORAGE_ROOT, SEED_SUBDIR);
}

async function seed(): Promise<void> {
  const prisma = createPrismaClient();
  const dir = seedDir();
  await mkdir(dir, { recursive: true });

  let apparentBytes = 0n;

  for (const tool of SEED_TOOLS) {
    const absolute = path.join(dir, tool.fileName);
    await writeSparseFile(absolute, tool.fileSize);
    apparentBytes += tool.fileSize;

    const row = {
      name: tool.name,
      description: tool.description,
      category: tool.category,
      version: tool.version,
      filePath: absolute,
      fileName: tool.fileName,
      fileSize: tool.fileSize,
      mimeType: tool.mimeType,
      featured: tool.featured ?? false,
      published: tool.published ?? true,
      visibility: tool.visibility ?? "public",
      isSeed: true,
      // Left null on purpose: it makes the "Computing…" state reachable, and
      // issue 32's bounded hash queue is what fills it in.
      checksum: null,
    };

    // Upsert on slug so re-running is a no-op rather than a unique violation.
    await prisma.tool.upsert({
      where: { slug: tool.slug },
      create: { slug: tool.slug, ...row },
      update: row,
    });
  }

  const onDisk = await allocatedBytes(dir);

  console.log(`\n  Seeded ${SEED_TOOLS.length} tools into ${SEED_SUBDIR}/`);
  console.log(`    apparent size : ${formatBytes(apparentBytes)}`);
  console.log(`    actually used : ${formatBytes(onDisk)}  (sparse — ADR-0002)`);
  console.log(`\n  Clear them with: pnpm db:seed:clear\n`);

  await prisma.$disconnect();
}

async function clear(): Promise<void> {
  const dir = seedDir();

  /*
   * Only ever the seed directory. PRD §14: "No scheduled job anywhere in the
   * repo deletes a file from STORAGE_ROOT." This is a developer command rather
   * than a job, but the blast radius is still pinned to one constant subpath —
   * hence the assertion rather than trusting the join.
   *
   * Checked BEFORE the rows are deleted. Guarding afterwards leaves the database
   * emptied and the files still on disk when it trips.
   */
  const root = path.resolve(getEnv().STORAGE_ROOT);
  if (path.dirname(dir) !== root || path.basename(dir) !== SEED_SUBDIR) {
    throw new Error(`Refusing to delete ${dir}: not ${path.join(root, SEED_SUBDIR)}`);
  }

  const prisma = createPrismaClient();
  const { count } = await prisma.tool.deleteMany({ where: { isSeed: true } });
  await rm(dir, { recursive: true, force: true });

  console.log(`\n  Removed ${count} seeded tools and ${SEED_SUBDIR}/\n`);
  await prisma.$disconnect();
}

/** Blocks actually allocated, which for a sparse file is far less than its size. */
async function allocatedBytes(dir: string): Promise<bigint> {
  let total = 0n;
  for (const tool of SEED_TOOLS) {
    try {
      const s = await stat(path.join(dir, tool.fileName));
      total += BigInt(s.blocks) * 512n;
    } catch {
      // already removed
    }
  }
  return total;
}

const run = process.argv.includes("--clear") ? clear : seed;

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
