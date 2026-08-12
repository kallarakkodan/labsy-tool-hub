// Dev convenience: print a hash non-interactively. `pnpm gen:hash` is the real
// entry point; this exists so automated checks can seed a known password.
import { config } from "dotenv";
config({ path: [".env.local"], quiet: true });
process.env.ADMIN_PASSWORD_HASH ||= "placeholder";
const { hashPassword } = await import("../src/lib/auth.js");
process.stdout.write(await hashPassword(process.argv[2]!));
