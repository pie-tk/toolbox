// 插件级类型检查：对每个含 tsconfig.json 的插件目录跑 tsc --noEmit。
// 根 tsconfig 只 include src/，插件代码（含 simulator 的完整核心）需要独立检查。
// 运行：npm run lint:plugins
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const TSC = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");

const ids = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((id) => existsSync(path.join(PLUGINS_DIR, id, "tsconfig.json")));

if (ids.length === 0) {
  console.log("（没有插件配置了 tsconfig.json，跳过）");
  process.exit(0);
}

let failed = 0;
for (const id of ids) {
  try {
    execFileSync(process.execPath, [TSC, "--noEmit", "-p", path.join(PLUGINS_DIR, id)], {
      stdio: "inherit",
    });
    console.log(`✔ 插件 ${id} 类型检查通过`);
  } catch {
    failed++;
    console.error(`✘ 插件 ${id} 类型检查失败`);
  }
}
process.exit(failed > 0 ? 1 : 0);
