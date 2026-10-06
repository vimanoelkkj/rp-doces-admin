import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { runInNewContext } from "node:vm";

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: "https://local.test/admin/notificacoes"
});
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
  "Node",
  "Event",
  "MouseEvent"
])
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test.after(() => {
  dom.window.close();
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  globalThis.MessageChannel = NativeMessageChannel;
});
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Card from './src/admin/notificacoes/PushNotificationCard';
    export {act} from 'react';
    export function mount(container) { const root = createRoot(container); root.render(<Card/>); return root; }
  `
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }
});
const ui = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const container = document.getElementById("root");
const currentBytes = Uint8Array.from({ length: 65 }, (_, index) => (index === 0 ? 4 : index));
const oldBytes = Uint8Array.from(currentBytes, (byte, index) => (index === 64 ? byte + 1 : byte));
const publicKey = Buffer.from(currentBytes).toString("base64url");
const privateSentinel = "synthetic-private-secret-never-render-or-log";

async function mount(
  t,
  {
    key = currentBytes.buffer,
    present = true,
    permission = "granted",
    supported = true,
    serverKey = publicKey,
    cleanupStatus = 200,
    cleanupOk = true,
    localCleanup = true,
    saveStatus = 200,
    testStatus = 200,
    fetchError = false,
    optionsThrow = false,
    createdKey = currentBytes.buffer
  } = {}
) {
  const calls = [];
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  let sub;
  const subscription = (endpoint, applicationServerKey) => ({
    endpoint,
    options: { applicationServerKey },
    toJSON: () => ({ keys: { p256dh: "synthetic-client-public", auth: "synthetic-client-auth" } }),
    async unsubscribe() {
      calls.push({ op: "local:unsubscribe", endpoint });
      if (localCleanup) sub = null;
      return localCleanup;
    }
  });
  sub = present ? subscription("https://push.invalid/old", key) : null;
  if (sub && optionsThrow)
    Object.defineProperty(sub, "options", {
      get() {
        throw new Error(privateSentinel);
      }
    });
  const reg = {
    pushManager: {
      async getSubscription() {
        calls.push({ op: "local:get" });
        return sub;
      },
      async subscribe(options) {
        calls.push({
          op: "local:subscribe",
          bytes: Array.from(new Uint8Array(options.applicationServerKey)),
          visible: options.userVisibleOnly
        });
        sub = subscription("https://push.invalid/new", createdKey);
        return sub;
      }
    }
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve(reg) }
  });
  window.PushManager = class {};
  const notification = {
    permission,
    async requestPermission() {
      return permission;
    }
  };
  Object.defineProperty(window, "Notification", { configurable: true, value: notification });
  Object.defineProperty(globalThis, "Notification", { configurable: true, value: notification });
  if (!supported) delete window.PushManager;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({
      op: String(url),
      method: options.method ?? "GET",
      body: options.body ? JSON.parse(options.body) : null
    });
    if (fetchError) throw new Error(privateSentinel);
    if (url === "/api/admin/push/vapid-key")
      return Response.json({ publicKey: serverKey, privateKey: privateSentinel });
    if (url === "/api/admin/push/unsubscribe")
      return Response.json({ ok: cleanupOk }, { status: cleanupStatus });
    if (url === "/api/admin/push/subscribe")
      return Response.json({ ok: saveStatus === 200 }, { status: saveStatus });
    if (url === "/api/admin/push/test")
      return Response.json(
        { ok: testStatus === 200, stale: testStatus === 410 },
        { status: testStatus }
      );
    assert.fail(`unexpected URL: ${url}`);
  });
  let root;
  await ui.act(async () => {
    root = ui.mount(container);
  });
  t.after(async () => {
    await ui.act(async () => root.unmount());
  });
  return {
    calls,
    logs,
    reg,
    notification,
    setServerKey(value) {
      serverKey = value;
    },
    setSaveStatus(value) {
      saveStatus = value;
    },
    status: () => container.querySelector(".push-card")?.dataset.status,
    async click(text) {
      const button = Array.from(container.querySelectorAll("button")).find(
        element => element.textContent === text
      );
      assert.ok(button, `button ${text} must be visible`);
      await ui.act(async () => {
        button.click();
      });
    }
  };
}

test("no subscription renders PROMPT", async t => {
  const page = await mount(t, { present: false });
  assert.equal(page.status(), "PROMPT");
});
test("current applicationServerKey renders SUBSCRIBED", async t => {
  const page = await mount(t);
  assert.equal(page.status(), "SUBSCRIBED");
  assert.match(container.textContent, /Ativadas/);
});
test("old key requires reactivation without automatic cleanup", async t => {
  const page = await mount(t, { key: oldBytes.buffer });
  assert.equal(page.status(), "PROMPT");
  assert.match(container.textContent, /As chaves de notificação foram atualizadas/);
  assert.equal(
    page.calls.filter(call => call.method === "POST" || call.op === "local:unsubscribe").length,
    0
  );
});
test("rotation cleans backend, unsubscribes locally, creates and saves new endpoint in order", async t => {
  const page = await mount(t, { key: oldBytes.buffer });
  page.calls.length = 0;
  await page.click("Ativar notificações");
  assert.deepEqual(page.calls, [
    { op: "/api/admin/push/vapid-key", method: "GET", body: null },
    { op: "local:get" },
    {
      op: "/api/admin/push/unsubscribe",
      method: "POST",
      body: { endpoint: "https://push.invalid/old" }
    },
    { op: "local:unsubscribe", endpoint: "https://push.invalid/old" },
    { op: "local:subscribe", bytes: Array.from(currentBytes), visible: true },
    {
      op: "/api/admin/push/subscribe",
      method: "POST",
      body: {
        endpoint: "https://push.invalid/new",
        keys: { p256dh: "synthetic-client-public", auth: "synthetic-client-auth" }
      }
    }
  ]);
  assert.equal(page.status(), "SUBSCRIBED");
});

for (const options of [{ cleanupStatus: 500 }, { cleanupOk: false }]) {
  test(`failed backend cleanup stops rotation: ${JSON.stringify(options)}`, async t => {
    const page = await mount(t, { key: oldBytes.buffer, ...options });
    page.calls.length = 0;
    await page.click("Ativar notificações");
    assert.deepEqual(
      page.calls.map(call => call.op),
      ["/api/admin/push/vapid-key", "local:get", "/api/admin/push/unsubscribe"]
    );
    assert.equal(page.status(), "PROMPT");
    assert.match(container.textContent, /Não foi possível remover a inscrição antiga/);
    assert.equal(
      (await page.reg.pushManager.getSubscription()).endpoint,
      "https://push.invalid/old"
    );
  });
}
test("failed local unsubscribe stops before creating another subscription", async t => {
  const page = await mount(t, { key: oldBytes.buffer, localCleanup: false });
  page.calls.length = 0;
  await page.click("Ativar notificações");
  assert.deepEqual(
    page.calls.map(call => call.op),
    ["/api/admin/push/vapid-key", "local:get", "/api/admin/push/unsubscribe", "local:unsubscribe"]
  );
  assert.equal(page.status(), "PROMPT");
  assert.match(container.textContent, /Não foi possível desativar a inscrição antiga/);
});
for (const [label, options] of [
  ["null", { key: null }],
  ["invalid source", { key: {} }],
  ["unreadable options", { optionsThrow: true }]
]) {
  test(`${label} applicationServerKey requires reactivation`, async t => {
    const page = await mount(t, options);
    assert.equal(page.status(), "PROMPT");
    assert.match(container.textContent, /Reative as notificações/);
    assert.equal(
      page.calls.some(call => call.method === "POST"),
      false
    );
  });
}
test("null applicationServerKey is replaced on explicit activation", async t => {
  const page = await mount(t, { key: null });
  await page.click("Ativar notificações");
  assert.equal(page.status(), "SUBSCRIBED");
  assert.equal(page.calls.filter(call => call.op === "local:subscribe").length, 1);
  assert.equal(page.calls.filter(call => call.op === "local:unsubscribe").length, 1);
});

test("browser cannot verify the newly created key: never claims SUBSCRIBED", async t => {
  const page = await mount(t, { key: oldBytes.buffer, createdKey: null });
  await page.click("Ativar notificações");
  assert.equal(page.status(), "PROMPT");
  assert.match(container.textContent, /Não foi possível verificar a chave/);
  assert.equal(
    page.calls.some(call => call.op === "/api/admin/push/subscribe"),
    false
  );
});
for (const padded of [false, true]) {
  test(`base64url bytes match with padding=${padded}`, async t => {
    const page = await mount(t, { serverKey: padded ? `${publicKey}=` : publicKey });
    assert.equal(page.status(), "SUBSCRIBED");
  });
}
for (const dataView of [false, true]) {
  test(`BufferSource view respects offset, DataView=${dataView}`, async t => {
    const buffer = new ArrayBuffer(70);
    new Uint8Array(buffer).set(currentBytes, 3);
    const key = dataView ? new DataView(buffer, 3, 65) : new Uint8Array(buffer, 3, 65);
    const page = await mount(t, { key });
    assert.equal(page.status(), "SUBSCRIBED");
  });
}
test("ArrayBuffer from another realm matches by bytes", async t => {
  const key = runInNewContext("new ArrayBuffer(65)");
  new Uint8Array(key).set(currentBytes);
  const page = await mount(t, { key });
  assert.equal(page.status(), "SUBSCRIBED");
});
test("current subscription is reused and upserted after a fresh key lookup", async t => {
  const page = await mount(t, { serverKey: Buffer.from(oldBytes).toString("base64url") });
  assert.equal(page.status(), "PROMPT");
  page.setServerKey(publicKey);
  page.calls.length = 0;
  await page.click("Ativar notificações");
  assert.equal(page.status(), "SUBSCRIBED");
  assert.deepEqual(
    page.calls.map(call => call.op),
    ["/api/admin/push/vapid-key", "local:get", "/api/admin/push/subscribe"]
  );
  assert.equal(page.calls[2].body.endpoint, "https://push.invalid/old");
});
test("failed registration retries with the new local subscription instead of duplicating it", async t => {
  const page = await mount(t, { key: oldBytes.buffer, saveStatus: 500 });
  await page.click("Ativar notificações");
  assert.equal(page.status(), "PROMPT");
  assert.match(container.textContent, /Falha ao salvar inscrição/);
  page.setSaveStatus(200);
  await page.click("Ativar notificações");
  assert.equal(page.status(), "SUBSCRIBED");
  assert.equal(page.calls.filter(call => call.op === "local:subscribe").length, 1);
});
test("DENIED remains blocked without requests", async t => {
  const page = await mount(t, { permission: "denied" });
  assert.equal(page.status(), "DENIED");
  assert.deepEqual(page.calls, []);
});
test("UNSUPPORTED remains unavailable without requests", async t => {
  const page = await mount(t, { supported: false });
  assert.equal(page.status(), "UNSUPPORTED");
  assert.deepEqual(page.calls, []);
});
test("declined permission does not register or rotate", async t => {
  const page = await mount(t, { present: false, permission: "default" });
  page.calls.length = 0;
  await page.click("Ativar notificações");
  assert.equal(page.status(), "PROMPT");
  assert.deepEqual(page.calls, []);
});
test("manual deactivation keeps the existing endpoint cleanup flow", async t => {
  const page = await mount(t);
  page.calls.length = 0;
  await page.click("Desativar");
  assert.equal(page.status(), "PROMPT");
  assert.deepEqual(
    page.calls.map(call => call.op),
    ["local:get", "/api/admin/push/unsubscribe", "local:unsubscribe"]
  );
  assert.match(container.textContent, /Notificações desativadas/);
});
for (const testStatus of [200, 410]) {
  test(`notification test keeps the current response behavior: ${testStatus}`, async t => {
    const page = await mount(t, { testStatus });
    page.calls.length = 0;
    await page.click("Enviar notificação de teste");
    assert.deepEqual(
      page.calls.map(call => call.op),
      ["local:get", "/api/admin/push/test"]
    );
    assert.equal(page.calls[1].body.endpoint, "https://push.invalid/old");
    assert.equal(page.status(), testStatus === 200 ? "SUBSCRIBED" : "PROMPT");
    assert.match(
      container.textContent,
      testStatus === 200 ? /Notificação de teste enviada/ : /inscrição deste dispositivo expirou/
    );
  });
}
for (const options of [{}, { fetchError: true }, { serverKey: `%%%${privateSentinel}` }]) {
  test(`private sentinel never appears in render or logs: ${JSON.stringify(Object.keys(options))}`, async t => {
    const page = await mount(t, options);
    if (page.status() === "PROMPT") await page.click("Ativar notificações");
    assert.equal(container.textContent.includes(privateSentinel), false);
    assert.equal(JSON.stringify(page.logs).includes(privateSentinel), false);
  });
}
