import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import {
  sidebarPath,
  iconsPath,
  iconNames,
  inspectIcons,
  compileIcons,
  svgSnapshot,
  consumerImports
} from "./helpers/admin-sidebar-icons.mjs";

const contract = JSON.parse(
  await readFile("tests/fixtures/admin-sidebar-icons-contract.json", "utf8")
);
const original = await readFile(iconsPath, "utf8");
const forbidden = path =>
  /AdminSidebar\.(?:tsx|css)$|(?:Auth|Theme|Notificacoes)Context\.tsx$/.test(path);
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://local.test" });
const channels = [];
const NativeMessageChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeMessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "MutationObserver",
  "localStorage",
  "getComputedStyle"
])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
dom.window.scrollTo = () => {};
const breakpoints = new Set();
dom.window.matchMedia = media => ({
  matches: false,
  media,
  addEventListener: (_, listener) => breakpoints.add(listener),
  removeEventListener: (_, listener) => breakpoints.delete(listener),
  addListener() {},
  removeListener() {}
});
globalThis.matchMedia = dom.window.matchMedia;
test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});

async function svgContracts(overrides, prefix) {
  const { module, result } = await compileIcons(overrides, prefix);
  assert.deepEqual(
    Object.keys(module)
      .filter(name => name.startsWith("Icon"))
      .sort(),
    Object.keys(contract.icons)
  );
  for (const [name, expected] of Object.entries(contract.icons)) {
    const container = document.createElement("div");
    container.innerHTML = module.markup(name);
    assert.deepEqual(svgSnapshot(container.querySelector("svg")), expected, name);
  }
  const logout = document.createElement("div");
  logout.innerHTML = module.logoutMarkup();
  assert.deepEqual(svgSnapshot(logout.querySelector("svg")), contract.logout);
  assert.deepEqual(
    Object.keys(result.metafile.inputs).filter(forbidden),
    [],
    "Isolated declarations must not load administrative modules or CSS"
  );
}

const consumerPaths = Object.keys(contract.consumers);
async function consumerBundle(overrides = new Map(), mocks = false) {
  return build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import {createRoot} from 'react-dom/client';
      import {MemoryRouter} from 'react-router-dom';
      import Sidebar from './${sidebarPath}';
      import * as publicIcons from './${iconsPath}';
      const icons={...publicIcons,default:Sidebar};
      import BottomNav from './src/admin/components/AdminMobileBottomNav';
      import Header from './src/components/Header';
      import LastOrder from './src/components/UltimoPedidoLink';
      export {act} from 'react';
      export {icons};
      ${mocks ? "" : consumerPaths.map((path, index) => `export * as Consumer${index} from './${path}';`).join("\n")}
      export const events=[];
      globalThis.__sidebarIconEvents=events;
      export function mount(container){const root=createRoot(container);return {
        render(route,badge,theme='light'){
          globalThis.__sidebarIconState={badge,theme};
          root.render(<MemoryRouter key={route} initialEntries={[route]}
            future={{v7_startTransition:true,v7_relativeSplatPath:true}}>
            <Sidebar/><BottomNav/><Header variant="admin"/><LastOrder/>
          </MemoryRouter>);
        },unmount(){root.unmount();}
      };}
    `
    },
    bundle: true,
    write: false,
    metafile: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    logLevel: "silent",
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env.PROD": "false",
      "import.meta.env.DEV": "true"
    },
    loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
    plugins: [
      {
        name: "characterization-only",
        setup(api) {
          api.onLoad({ filter: /\.tsx?$/ }, async ({ path }) => {
            if (overrides.has(path))
              return {
                contents: overrides.get(path),
                loader: "tsx",
                resolveDir: path.replace(/[/\\][^/\\]+$/, "")
              };
            if (!mocks) return;
            const stub = path.endsWith("AdminAuthContext.tsx")
              ? `
          export function useAdminAuth(){return {user:{nome:'Ana Teste',papel:'OWNER'},
            logout:()=>globalThis.__sidebarIconEvents.push('logout')};}
          export const useOptionalAdminAuth=useAdminAuth;`
              : path.endsWith("AdminThemeContext.tsx") || path.endsWith("StoreThemeContext.tsx")
                ? `
          import {useState} from 'react';
          export function useAdminTheme(){const [theme,setTheme]=useState(globalThis.__sidebarIconState.theme);
            return {theme,toggleTheme:()=>{globalThis.__sidebarIconEvents.push('theme');setTheme(t=>t==='light'?'dark':'light');}};}
          export const useStoreTheme=useAdminTheme;`
                : path.endsWith("NotificacoesContext.tsx")
                  ? `
          export function useNotificacoes(){const badge=globalThis.__sidebarIconState.badge;
            return {naoLidas:badge,notificacoes:Array.from({length:badge},()=>({tipo:'PEDIDO'}))};}
          export const useOptionalNotificacoes=useNotificacoes;`
                  : null;
            if (stub) return { contents: stub, loader: "tsx" };
          });
        }
      }
    ]
  });
}

test("icons: frozen SVG trees, all attributes and isolated declaration dependencies", async () => {
  await svgContracts();
});

test("consumers: complete import inventory and availability in the real module graph", async () => {
  assert.deepEqual(await consumerImports(), { ...contract.consumers, [sidebarPath]: iconNames });
  const bundle = await consumerBundle();
  for (const path of consumerPaths) assert.ok(bundle.metafile.inputs[path], path);
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  assert.deepEqual(Object.keys(module.icons).sort(), [...iconNames, "default"].sort());
  for (const name of iconNames) assert.equal(typeof module.icons[name], "function", name);
});

test("dependencies: characterize the legacy facade and require independent defining modules", async () => {
  const { icons } = inspectIcons();
  const owners = [...icons]
    .filter(([name]) => iconNames.includes(name))
    .map(([name, node]) => [
      name,
      relative(process.cwd(), node.getSourceFile().fileName).replaceAll("\\", "/")
    ]);
  const legacy = owners.some(([, path]) => path === sidebarPath);
  const bundle = await build({
    stdin: {
      contents: owners.map(([name, path]) => `export {${name}} from './${path}';`).join("\n"),
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
  const inputs = Object.keys(bundle.metafile.inputs).filter(forbidden).sort();
  // Existing defining modules are coupled. Once definitions move, this same
  // check forbids those dependencies without requiring a particular filename.
  assert.deepEqual(
    inputs,
    legacy
      ? [
          "src/admin/auth/AdminAuthContext.tsx",
          "src/admin/components/AdminSidebar.css",
          sidebarPath,
          "src/admin/notificacoes/NotificacoesContext.tsx",
          "src/admin/theme/AdminThemeContext.tsx",
          "src/context/StoreThemeContext.tsx"
        ].sort()
      : []
  );
});

test("sidebar/mobile: links, active routes, badges, profile, theme, logout and sheet lifecycle", async t => {
  const bundle = await consumerBundle(new Map(), true);
  const ui = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  const root = ui.mount(document.getElementById("root"));
  t.after(async () => {
    await ui.act(async () => root.unmount());
    delete globalThis.__sidebarIconState;
    delete globalThis.__sidebarIconEvents;
  });
  const render = async (route, badge, theme) =>
    ui.act(async () => root.render(route, badge, theme));
  const click = async element => {
    assert.ok(element);
    await ui.act(async () => element.click());
  };
  const paths = [
    "/admin",
    "/admin/produtos",
    "/admin/pedidos",
    "/admin/administradores",
    "/admin/despesas",
    "/admin/loja",
    "/admin/notificacoes"
  ];
  for (const badge of [0, 1, 9, 10]) {
    await render(`/admin/produtos?badge=${badge}`, badge);
    const sidebar = document.querySelector(".admin-sidebar");
    assert.deepEqual(
      [...sidebar.querySelectorAll("a")].map(a => a.getAttribute("href")),
      paths
    );
    assert.equal(
      sidebar.querySelector('[aria-current="page"]').getAttribute("href"),
      "/admin/produtos"
    );
    assert.equal(
      sidebar.querySelector(".sidebar-nav-badge")?.textContent ?? null,
      badge ? (badge > 9 ? "9+" : String(badge)) : null
    );
    assert.equal(
      document.querySelector(".admin-mobile-nav-badge")?.textContent ?? null,
      badge ? (badge > 9 ? "9+" : String(badge)) : null
    );
    assert.equal(sidebar.querySelector(".sidebar-user-name").textContent, "Ana Teste");
    assert.equal(sidebar.querySelector(".sidebar-user-role").textContent, "Owner");
    assert.equal(sidebar.querySelector(".sidebar-user-avatar").textContent, "AT");
    assert.deepEqual(
      svgSnapshot(sidebar.querySelector(".sidebar-logo-circle svg")),
      contract.icons.IconCakeLogo
    );
    assert.deepEqual(
      svgSnapshot(sidebar.querySelector(".sidebar-logout-btn svg")),
      contract.logout
    );
    await click(
      [...sidebar.querySelectorAll("button")].find(b => b.textContent.includes("Tema Escuro"))
    );
    assert.ok(sidebar.textContent.includes("Tema Claro"));
    await click(sidebar.querySelector('[aria-label="Sair"]'));
  }
  await render("/admin/despesas", 12, "dark");
  const trigger = document.querySelector('[aria-controls="admin-mobile-more-sheet"]');
  assert.equal(trigger.getAttribute("aria-current"), "page");
  await click(trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  await ui.act(async () => new Promise(resolve => setTimeout(resolve, 60)));
  const sheet = document.getElementById("admin-mobile-more-sheet");
  assert.deepEqual(
    [...sheet.querySelectorAll("a")].map(a => a.getAttribute("href")),
    ["/admin/administradores", "/admin/despesas", "/admin/notificacoes"]
  );
  assert.equal(sheet.querySelector(".admin-mobile-sheet-badge").textContent, "9+");
  assert.ok(sheet.contains(document.activeElement));
  await click(sheet.querySelector('a[href="/admin/notificacoes"]'));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await click(trigger);
  await click(sheet.querySelector(".admin-mobile-sheet-item--theme"));
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  await click(trigger);
  await click(sheet.querySelector('[aria-label="Sair"]'));
  await ui.act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  );
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, trigger);
  await click(trigger);
  await ui.act(async () => {
    for (const listener of breakpoints) listener({ matches: true });
  });
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(ui.events.filter(e => e === "theme").length, 5);
  assert.equal(ui.events.filter(e => e === "logout").length, 5);
});

test("negative controls: SVG, exports, consumer imports and forbidden icon dependencies", async t => {
  for (const [name, before, after] of [
    ["aria-hidden", 'aria-hidden="true"', 'aria-hidden="false"'],
    ["path", 'd="M7.33333 2H2.88889', 'd="M8.33333 2H2.88889'],
    ["viewBox", 'viewBox="0 0 20 20"', 'viewBox="0 0 21 20"'],
    ["export", "export const IconBag", "const IconBag"],
    [
      "context dependency",
      "export const IconBag = () => (",
      "export const IconBag = () => (useAdminAuth(),"
    ],
    [
      "sidebar dependency",
      "export const IconBag = () => (",
      "export const IconBag = () => (AdminSidebar(),"
    ]
  ])
    await t.test(name, async () => {
      assert.ok(original.includes(before), "Mutation anchor must exist");
      const dependencyImport =
        name === "context dependency"
          ? 'import {useAdminAuth} from "../../admin/auth/AdminAuthContext";\n'
          : name === "sidebar dependency"
            ? 'import AdminSidebar from "../../admin/components/AdminSidebar";\n'
            : "";
      await assert.rejects(
        svgContracts(
          new Map([[resolve(iconsPath), dependencyImport + original.replace(before, after)]])
        ),
        { code: "ERR_ASSERTION" }
      );
    });
  await t.test("consumer import", async () => {
    const path = "src/components/UltimoPedidoLink.tsx";
    const source = await readFile(path, "utf8");
    assert.ok(source.includes("import { IconBag }"), "Mutation anchor must exist");
    await assert.rejects(
      consumerBundle(
        new Map([
          [resolve(path), source.replace("import { IconBag }", "import { IconMissing as IconBag }")]
        ])
      ),
      /No matching export/
    );
  });
  await t.test("isolated stylesheet dependency", async () => {
    await assert.rejects(
      svgContracts(undefined, "import './src/admin/components/AdminSidebar.css';"),
      { code: "ERR_ASSERTION" }
    );
  });
});
