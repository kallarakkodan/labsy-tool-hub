// Dev convenience: seal a valid session token so automated checks can exercise
// the admin-scoped paths before the login route exists (issue 20).
import { config } from "dotenv";
config({ path: [".env.local"], quiet: true });
const { sealToken } = await import("../src/lib/auth.js");
process.stdout.write(await sealToken());
