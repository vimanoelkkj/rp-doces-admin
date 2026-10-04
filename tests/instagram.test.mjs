import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Compila o helper do frontend via esbuild para execução direta no node:test
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `export * from './src/lib/instagram';`
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});

const { INSTAGRAM_WEB_URL, openInstagram } = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=instagram-bundle.mjs`).toString("base64")}`
);

const WEB_URL = "https://www.instagram.com/rp.doces_/";
const IOS_URL = "instagram://user?username=rp.doces_";
const ANDROID_URL =
  "intent://instagram.com/_u/rp.doces_/#Intent;package=com.instagram.android;scheme=https;S.browser_fallback_url=https%3A%2F%2Fwww.instagram.com%2Frp.doces_%2F;end";

const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15";
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126";

// Instala navigator/window/document falsos (com timers e visibilitychange controláveis) só durante o teste.
function instalarAmbiente(t, userAgent) {
  const timers = [];
  const ouvintes = new Set();
  const pagina = { hidden: false };
  const location = { href: "" };
  const globais = {
    navigator: { userAgent },
    window: {
      location,
      setTimeout: (fn, ms) => timers.push({ fn, ms, cancelado: false }) - 1,
      clearTimeout: id => {
        timers[id].cancelado = true;
      }
    },
    document: {
      get hidden() {
        return pagina.hidden;
      },
      addEventListener: (tipo, fn) => {
        if (tipo === "visibilitychange") ouvintes.add(fn);
      },
      removeEventListener: (tipo, fn) => {
        if (tipo === "visibilitychange") ouvintes.delete(fn);
      }
    }
  };

  const originais = Object.keys(globais).map(nome => [
    nome,
    Object.getOwnPropertyDescriptor(globalThis, nome)
  ]);
  for (const [nome, valor] of Object.entries(globais)) {
    Object.defineProperty(globalThis, nome, { configurable: true, writable: true, value: valor });
  }
  t.after(() => {
    for (const [nome, descritor] of originais) {
      if (descritor) Object.defineProperty(globalThis, nome, descritor);
      else delete globalThis[nome];
    }
  });

  return { location, timers, ouvintes, pagina };
}

function novoClique() {
  const evento = {
    defaultPrevented: false,
    preventDefault: () => {
      evento.defaultPrevented = true;
    }
  };
  return evento;
}

test("URL web exportada é a do perfil da R&P Doces", () => {
  assert.equal(INSTAGRAM_WEB_URL, WEB_URL);
});

test("Android: cancela o link e abre o app pela intent com fallback para a web", t => {
  const ambiente = instalarAmbiente(t, UA_ANDROID);
  const clique = novoClique();

  openInstagram(clique);

  assert.equal(clique.defaultPrevented, true);
  assert.equal(ambiente.location.href, ANDROID_URL);
  assert.equal(ambiente.timers.length, 0);
});

test("iPhone: cancela o link, abre o deep link e agenda o fallback web em 1200 ms", t => {
  const ambiente = instalarAmbiente(t, UA_IPHONE);
  const clique = novoClique();

  openInstagram(clique);

  assert.equal(clique.defaultPrevented, true);
  assert.equal(ambiente.location.href, IOS_URL);
  assert.equal(ambiente.timers.length, 1);
  assert.equal(ambiente.timers[0].ms, 1200);
  assert.equal(ambiente.ouvintes.size, 1);

  // O app não abriu: o fallback leva para a versão web.
  ambiente.timers[0].fn();
  assert.equal(ambiente.location.href, WEB_URL);
});

test("iPhone: página oculta (app abriu) cancela o fallback e remove o ouvinte", t => {
  const ambiente = instalarAmbiente(t, UA_IPHONE);
  openInstagram(novoClique());

  ambiente.pagina.hidden = true;
  for (const ouvinte of [...ambiente.ouvintes]) ouvinte();

  assert.equal(ambiente.timers[0].cancelado, true);
  assert.equal(ambiente.ouvintes.size, 0);
  assert.equal(ambiente.location.href, IOS_URL);
});

test("iPhone: visibilitychange com a página ainda visível não cancela o fallback", t => {
  const ambiente = instalarAmbiente(t, UA_IPHONE);
  openInstagram(novoClique());

  for (const ouvinte of [...ambiente.ouvintes]) ouvinte();

  assert.equal(ambiente.timers[0].cancelado, false);
  assert.equal(ambiente.ouvintes.size, 1);
});

test("outros ambientes: não cancela o link nem mexe em location, timers ou ouvintes", t => {
  const ambiente = instalarAmbiente(t, UA_DESKTOP);
  const clique = novoClique();

  openInstagram(clique);

  assert.equal(clique.defaultPrevented, false);
  assert.equal(ambiente.location.href, "");
  assert.equal(ambiente.timers.length, 0);
  assert.equal(ambiente.ouvintes.size, 0);
});
