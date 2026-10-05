import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { build } from "esbuild";

export const sidebarPath = "src/admin/components/AdminSidebar.tsx";
export const iconsPath = "src/components/icons/AdminNavigationIcons.tsx";
export const iconNames = [
  "IconBag",
  "IconBell",
  "IconDashboard",
  "IconMoon",
  "IconProdutosCake",
  "IconReceipt",
  "IconStore",
  "IconSun",
  "IconUsers"
];

export function inspectIcons(overrides = new Map()) {
  const options = {
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = path => overrides.get(resolve(path)) ?? read(path);
  const program = ts.createProgram([sidebarPath, iconsPath], options, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(sidebarPath);
  const exports = checker.getExportsOfModule(
    checker.getSymbolAtLocation(program.getSourceFile(iconsPath))
  );
  const names = exports
    .map(symbol => symbol.name)
    .filter(name => name.startsWith("Icon"))
    .sort();
  assert.deepEqual(names, iconNames, "Public icon exports changed");
  const declaration = symbol => {
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const node = symbol.valueDeclaration;
    assert.ok(node, "Icon declaration must resolve");
    return node;
  };
  const icons = new Map(
    exports
      .filter(symbol => names.includes(symbol.name))
      .map(symbol => [symbol.name, declaration(symbol)])
  );
  let sidebar;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "AdminSidebar") sidebar = node;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === "IconCakeLogo") {
        icons.set("IconCakeLogo", declaration(checker.getSymbolAtLocation(node.tagName)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(sidebar, "Sidebar implementation must resolve");
  assert.equal(icons.size, 10, "Nine public icons and the private logo must exist");
  // Resolve references semantically: a context/helper captured by an icon is
  // forbidden even when the extracted JSX still compiles or returns the same SVG.
  for (const [name, node] of icons) {
    const check = child => {
      if (ts.isIdentifier(child)) {
        if (ts.isJsxAttribute(child.parent) && child.parent.name === child) return;
        if (
          (ts.isJsxOpeningElement(child.parent) ||
            ts.isJsxClosingElement(child.parent) ||
            ts.isJsxSelfClosingElement(child.parent)) &&
          /^[a-z]/.test(child.text)
        )
          return;
        const symbol = checker.getSymbolAtLocation(child);
        for (const dependency of symbol?.declarations ?? []) {
          if (
            dependency.getSourceFile() === node.getSourceFile() &&
            dependency.pos >= node.pos &&
            dependency.end <= node.end
          )
            continue;
          assert.fail(`${name}: external icon dependency ${child.text}`);
        }
      }
      ts.forEachChild(child, check);
    };
    check(node);
  }
  const contents = [...icons]
    .map(([name, node]) =>
      ts.isVariableDeclaration(node)
        ? `export const ${name} = ${node.initializer.getText()};`
        : `${node.getText().replace(/^export\s+/, "")}\nexport {${name}};`
    )
    .join("\n");
  return { icons, sidebar, contents };
}

export function sidebarSvgInventory() {
  const { icons, sidebar } = inspectIcons();
  const svgs = [];
  const visit = node => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText() === "svg"
    ) {
      const attributes = Object.fromEntries(
        node.attributes.properties.map(attribute => {
          assert.ok(ts.isJsxAttribute(attribute), "SVG spreads require explicit characterization");
          const value = attribute.initializer;
          return [
            attribute.name.getText(),
            ts.isStringLiteral(value)
              ? value.text
              : ts.isJsxExpression(value)
                ? value.expression?.getText()
                : "true"
          ];
        })
      );
      svgs.push(attributes);
    }
    ts.forEachChild(node, visit);
  };
  for (const node of [...icons.values(), sidebar]) visit(node);
  return svgs;
}

export async function compileIcons(overrides, prefix = "") {
  const { contents, sidebar } = inspectIcons(overrides);
  let logout;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "svg") logout = node;
    ts.forEachChild(node, visit);
  };
  visit(sidebar);
  assert.ok(logout, "Inline logout SVG must exist");
  const result = await build({
    stdin: {
      contents: `${prefix}\n${contents}
    import {renderToStaticMarkup} from 'react-dom/server';
    export function markup(name){return renderToStaticMarkup(icons[name]());}
    export function logoutMarkup(){return renderToStaticMarkup(${logout.getText()});}
    const icons={${[...iconNames, "IconCakeLogo"].join(",")}};`,
      resolveDir: process.cwd(),
      loader: "tsx"
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    metafile: true,
    loader: { ".css": "empty" }
  });
  return {
    result,
    module: await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
    )
  };
}

export function svgSnapshot(element) {
  return {
    tag: element.localName,
    attributes: Object.fromEntries([...element.attributes].map(a => [a.name, a.value]).sort()),
    children: [...element.children].map(svgSnapshot)
  };
}

export async function consumerImports() {
  const found = {};
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.tsx?$/.test(path)) {
        const source = ts.createSourceFile(
          path,
          await readFile(path, "utf8"),
          ts.ScriptTarget.Latest,
          true
        );
        for (const statement of source.statements) {
          if (!ts.isImportDeclaration(statement)) continue;
          const clause = statement.importClause;
          const names = [
            clause?.name && statement.moduleSpecifier.text.endsWith("/AdminSidebar")
              ? "default"
              : null,
            ...(clause?.namedBindings?.elements ?? []).map(
              item => item.propertyName?.text ?? item.name.text
            )
          ].filter(name => name === "default" || iconNames.includes(name));
          if (names.length) found[path] = [...(found[path] ?? []), ...names].sort();
        }
      }
    }
  };
  await walk("src");
  return found;
}
