import { createInterface } from "node:readline";
import { config as loadEnv } from "dotenv";
import { hashPassword } from "../src/lib/auth";

/*
 * `pnpm gen:hash` — prompt for the admin password and print the
 * ADMIN_PASSWORD_HASH line to paste into .env.local or /etc/labsy-hub/env.
 *
 * The password is never echoed and never written anywhere: it goes in, a hash
 * comes out. Taking it as an argv argument would put it in the shell history of
 * whoever ran it, which is why this prompts instead.
 */

loadEnv({ path: [".env.local", ".env"], quiet: true });

function promptSilently(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    // Swallow the echo of everything typed after the prompt itself.
    let muted = false;
    const output = process.stdout as NodeJS.WriteStream & { _write?: unknown };
    const write = output.write.bind(output);
    (output as { write: (chunk: string) => boolean }).write = (chunk: string) =>
      muted ? true : write(chunk);

    rl.question(question, (answer) => {
      (output as { write: typeof write }).write = write;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function main(): Promise<void> {
  const password = await promptSilently("Admin password: ");
  if (password.length === 0) {
    console.error("\n  No password entered. Nothing generated.\n");
    process.exit(1);
  }

  const confirmation = await promptSilently("Confirm password: ");
  if (password !== confirmation) {
    console.error("\n  Passwords did not match. Nothing generated.\n");
    process.exit(1);
  }

  if (password.length < 12) {
    console.warn(
      "\n  Warning: shorter than 12 characters. This is the only credential\n" +
        "  protecting the admin panel, and it is shared (PRD §11.4).",
    );
  }

  const hash = await hashPassword(password);

  console.log("\n  Paste this into .env.local (dev) or /etc/labsy-hub/env (prod):\n");
  console.log(`ADMIN_PASSWORD_HASH="${hash}"\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
