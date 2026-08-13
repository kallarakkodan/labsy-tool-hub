#!/usr/bin/env node
"use strict";

/*
 * Standalone admin-password hasher, shared by both deploy methods. Zero
 * dependencies — just `node:crypto` and `node:readline` — so it runs
 * identically inside the lean Docker runtime image (which has no
 * TypeScript/tsx, unlike `pnpm gen:hash`), from deploy/install.sh on a bare
 * host, or from any plain `node` install.
 *
 * MUST stay byte-for-byte compatible with `hashPassword()` in
 * `src/lib/auth.ts`: same scrypt parameters, same `scrypt$N$r$p$salt$hash`
 * format. If that function's parameters ever change, update the constants
 * below to match — `verifyPassword()` on the real app is what actually
 * checks the hash this prints, so a mismatch here fails silently until
 * someone tries to log in.
 */

const crypto = require("node:crypto");
const readline = require("node:readline");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

function promptSilently(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => (muted ? true : write(chunk));

    rl.question(question, (answer) => {
      process.stdout.write = write;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(plain, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (error, derived) => {
      if (error) return reject(error);
      resolve(["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), derived.toString("base64")].join("$"));
    });
  });
}

async function main() {
  // ADMIN_PASSWORD skips the interactive prompts entirely — used by
  // deploy/install.sh for non-interactive installs. Interactive prompting is
  // otherwise the default so a human always sees confirmation + the length
  // warning below.
  const envPassword = process.env.ADMIN_PASSWORD;
  let password;
  if (envPassword !== undefined) {
    password = envPassword;
    if (password.length === 0) {
      console.error("\n  ADMIN_PASSWORD is empty. Nothing generated.\n");
      process.exit(1);
    }
  } else {
    password = await promptSilently("Admin password: ");
    if (password.length === 0) {
      console.error("\n  No password entered. Nothing generated.\n");
      process.exit(1);
    }

    const confirmation = await promptSilently("Confirm password: ");
    if (password !== confirmation) {
      console.error("\n  Passwords did not match. Nothing generated.\n");
      process.exit(1);
    }
  }

  if (password.length < 12) {
    console.warn(
      "\n  Warning: shorter than 12 characters. This is the only credential\n" +
        "  protecting the admin panel, and it is shared (PRD §11.4).",
    );
  }

  const hash = await hashPassword(password);

  // Escaped the same way pnpm gen:hash prints it: dotenv-expand reads a bare
  // `$` in an env file as a variable reference and silently deletes it.
  const forEnvFile = hash.replace(/\$/g, "\\$");

  console.log("\n  Paste this into your .env file (ADMIN_PASSWORD_HASH):\n");
  console.log(`ADMIN_PASSWORD_HASH="${forEnvFile}"\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
