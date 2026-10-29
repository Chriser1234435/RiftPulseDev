import { rmSync } from "node:fs";
import { join } from "node:path";

for (const relativePath of ["dist/worker/.dev.vars", "dist/client/.dev.vars"]) {
  rmSync(join(process.cwd(), relativePath), { force: true });
}
console.log("Removed local .dev.vars copies from build output.");
