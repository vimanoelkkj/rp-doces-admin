import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testsDir = path.join(root, "tests");
const files = readdirSync(testsDir)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => path.join(testsDir, file));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--test", file], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
