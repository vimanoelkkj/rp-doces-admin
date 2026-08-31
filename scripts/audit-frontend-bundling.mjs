import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const targets = [
  { name: "Site público", html: "public/index.html", webRoot: "public" },
  { name: "Admin", html: "public/admin/index.html", webRoot: "public" }
];

function localAssetPath(specifier, fromFile, webRoot) {
  if (!specifier || /^(?:https?:|data:|blob:|node:)/i.test(specifier)) return null;
  const clean = specifier.split(/[?#]/, 1)[0];
  if (!clean) return null;
  if (clean.startsWith("/")) return path.join(root, webRoot, clean.slice(1));
  if (clean.startsWith(".")) return path.resolve(path.dirname(fromFile), clean);
  return null;
}

function moduleSpecifiers(source) {
  const found = new Set();
  const patterns = [
    /\bimport\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g,
    /\bexport\s+[^"']*?\s+from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) found.add(match[1]);
  }
  return [...found];
}

async function fileSize(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

async function walkModule(file, webRoot, seen, missing) {
  const normalized = path.normalize(file);
  if (seen.has(normalized)) return;
  seen.add(normalized);

  let source;
  try {
    source = await readFile(normalized, "utf8");
  } catch {
    missing.add(normalized);
    return;
  }

  for (const specifier of moduleSpecifiers(source)) {
    let dependency = localAssetPath(specifier, normalized, webRoot);
    if (!dependency) continue;
    if (!path.extname(dependency)) dependency += ".js";
    await walkModule(dependency, webRoot, seen, missing);
  }
}

function htmlAssets(html, tag, attr, suffix) {
  const result = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+${suffix})["'][^>]*>`, "gi");
  let match;
  while ((match = pattern.exec(html))) result.push(match[1]);
  return result;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function auditTarget(target) {
  const htmlFile = path.join(root, target.html);
  const html = await readFile(htmlFile, "utf8");
  const scripts = htmlAssets(html, "script", "src", "\\.js(?:[?#][^\"']*)?");
  const styles = htmlAssets(html, "link", "href", "\\.css(?:[?#][^\"']*)?");

  const modules = new Set();
  const missing = new Set();
  for (const script of scripts) {
    const file = localAssetPath(script, htmlFile, target.webRoot);
    if (file) await walkModule(file, target.webRoot, modules, missing);
  }

  let jsBytes = 0;
  for (const file of modules) jsBytes += await fileSize(file);

  let cssBytes = 0;
  for (const style of styles) {
    const file = localAssetPath(style, htmlFile, target.webRoot);
    if (file) cssBytes += await fileSize(file);
  }

  console.log(`\n${target.name}`);
  console.log("-".repeat(target.name.length));
  console.log(`Entrypoints JS no HTML : ${scripts.length}`);
  console.log(`Módulos JS únicos      : ${modules.size}`);
  console.log(`JS bruto total         : ${kb(jsBytes)}`);
  console.log(`Arquivos CSS no HTML   : ${styles.length}`);
  console.log(`CSS bruto total        : ${kb(cssBytes)}`);
  console.log(`Requests locais teóricos (JS + CSS): ${modules.size + styles.length}`);

  if (missing.size) {
    console.log(`Arquivos referenciados não encontrados: ${missing.size}`);
    for (const file of [...missing].slice(0, 8)) console.log(`  - ${path.relative(root, file)}`);
  }
}

console.log("Auditoria de bundling — baseline atual");
console.log("Valores brutos em disco; compressão HTTP não está incluída.");

for (const target of targets) await auditTarget(target);
