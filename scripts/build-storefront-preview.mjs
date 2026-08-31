import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const publicDir = path.join(root, "public");
const bundleDir = path.join(root, ".tmp", "storefront-bundle");
const previewDir = path.join(root, ".tmp", "storefront-preview");

const build = spawnSync(process.execPath, ["scripts/build-storefront-experiment.mjs"], {
  cwd: root,
  stdio: "inherit"
});
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(previewDir, { recursive: true, force: true });
mkdirSync(previewDir, { recursive: true });
cpSync(publicDir, previewDir, { recursive: true });

const previewAssets = path.join(previewDir, "assets", "bundle-preview");
mkdirSync(previewAssets, { recursive: true });
cpSync(path.join(bundleDir, "storefront.min.js"), path.join(previewAssets, "storefront.min.js"));
cpSync(path.join(bundleDir, "storefront.min.css"), path.join(previewAssets, "storefront.min.css"));

const indexPath = path.join(previewDir, "index.html");
let html = readFileSync(indexPath, "utf8");

html = html.replace(
  /\s*<link rel="stylesheet" href="\/assets\/css\/[^\"]+" \/>/g,
  ""
);
html = html.replace(
  /\s*<script type="module" src="\/assets\/js\/[^\"]+"><\/script>/g,
  ""
);

const headClose = "</head>";
const bodyClose = "</body>";
if (!html.includes(headClose) || !html.includes(bodyClose)) {
  throw new Error("Não foi possível preparar o HTML de preview.");
}

html = html.replace(
  headClose,
  `    <link rel="stylesheet" href="/assets/bundle-preview/storefront.min.css" />\n  ${headClose}`
);
html = html.replace(
  bodyClose,
  `    <script type="module" src="/assets/bundle-preview/storefront.min.js"></script>\n  ${bodyClose}`
);

writeFileSync(indexPath, html);

if (!existsSync(path.join(previewDir, "index.html"))) {
  throw new Error("Preview não foi gerado corretamente.");
}

console.log("\nPreview navegável pronto");
console.log("-----------------------");
console.log(`Diretório: ${path.relative(root, previewDir)}`);
console.log("Inicie com:");
console.log("  npx wrangler pages dev .tmp/storefront-preview");
console.log("\nO diretório public/ continua intacto.");
