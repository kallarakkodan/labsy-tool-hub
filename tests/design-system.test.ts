import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const eslint = new ESLint({ cwd: root });

async function lint(source: string) {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(root, "src/components/public/Fixture.tsx"),
  });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("design system palette rule (CONTEXT §5)", () => {
  it("rejects every banned class, in plain strings and template literals", async () => {
    const messages = await lint(`
      export function Fixture({ cls }: { cls: string }) {
        return (
          <div className="bg-gray-800 text-white shadow-lg rounded-full">
            <span className={\`\${cls} bg-gradient-to-r text-green-500 backdrop-blur-xl\`} />
          </div>
        );
      }
    `);
    expect(messages.length).toBeGreaterThanOrEqual(7);
  });

  it("accepts the token classes the recipes in CONTEXT §5 are built from", async () => {
    const messages = await lint(`
      export function Fixture() {
        return (
          <div className="group rounded-card border border-border bg-surface p-5 transition-all duration-150 hover:-translate-y-1 hover:border-border-hover hover:bg-surface-hover motion-reduce:hover:translate-y-0">
            <button className="rounded-button bg-accent px-4 py-2 text-sm font-medium text-base hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/35" />
            <p className="font-mono text-xs text-fg-muted tabular-nums" />
            <input className="rounded-card border border-border bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-subtle" />
            <header className="backdrop-blur-sm border-b border-border bg-base/80" />
            <span className="text-danger" />
            <span className="text-warning" />
          </div>
        );
      }
    `);
    expect(messages).toEqual([]);
  });
});
