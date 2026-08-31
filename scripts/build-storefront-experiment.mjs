import { build } from "esbuild";
import { mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const outdir = path.join(process.cwd(), ".tmp", "storefront-bundle");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await build({
  entryPoints: ["scripts/storefront-bundle-entry.js"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outdir,
  entryNames: "storefront.min",
  assetNames: "assets/[name]-[hash]",
  metafile: true,
  logLevel: "warning"
});

const jsPath = path.join(outdir, "storefront.min.js");
const cssPath = path.join(outdir, "storefront.min.css");
const jsBytes = statSync(jsPath).size;
const cssBytes = statSync(cssPath).size;
const totalBytes = jsBytes + cssBytes;
const inputBytes = Object.values(result.metafile.inputs).reduce(
  (sum, input) => sum + Number(input.bytes || 0),
  0
);

const kib = bytes => `${(bytes / 1024).toFixed(1)} KiB`;
const reduction = inputBytes > 0 ? ((1 - totalBytes / inputBytes) * 100).toFixed(1) : "0.0";

console.log("\nBundle experimental do storefront");
console.log("--------------------------------");
console.log(`Entradas processadas : ${Object.keys(result.metafile.inputs).length}`);
console.log(`JS minificado        : ${kib(jsBytes)}`);
console.log(`CSS minificado       : ${kib(cssBytes)}`);
console.log(`Total gerado         : ${kib(totalBytes)}`);
console.log(`Total das entradas   : ${kib(inputBytes)}`);
console.log(`Redução bruta aprox. : ${reduction}%`);
console.log("Requests alvo        : 2 (1 JS + 1 CSS)");
console.log(`Saída experimental   : ${path.relative(process.cwd(), outdir)}`);
console.log("\nNada em public/ foi alterado; este build não participa do deploy.");
