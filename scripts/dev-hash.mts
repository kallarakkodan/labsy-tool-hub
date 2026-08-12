// Dev convenience: print a hash non-interactively. `pnpm gen:hash` is the real
// entry point; this exists so automated checks can seed a known password.
import { config } from "dotenv";
config({ path: [".env.local"], quiet: true });
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
const { hashPassword } = await import("../src/lib/auth.js");
process.stdout.write(await hashPassword(process.argv[2]!));
