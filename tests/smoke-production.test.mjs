import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  EXIT,
  checkAdminProtection,
  checkAsset,
  checkFrontendHtml,
  checkNotFoundEndpoint,
  checkPublicConfig,
  checkPublicProducts,
  detectLeaks,
  executeSmokeWithRetries,
  parseConfig,
  runSmokeSuite
} from "../scripts/smoke-production.mjs";

test("detectLeaks detecta padrões sensíveis e stack traces", () => {
  assert.equal(detectLeaks("Texto limpo e normal").length, 0);

  const leak1 = detectLeaks("-----BEGIN RSA PRIVATE KEY-----");
  assert.equal(leak1.length, 1);

  const leak2 = detectLeaks("Erro de conexão CLOUDFLARE_API_TOKEN vazou");
  assert.equal(leak2.length, 1);

  const leak3 = detectLeaks("at async doWork (file:///app/dist/server.js:42:15)");
  assert.equal(leak3.length, 1);

  const leak4 = detectLeaks("Falha em C:\\app\\node_modules\\d1\\index.js");
  assert.equal(leak4.length, 1);

  const leak5 = detectLeaks("D1_ERROR: query syntax error");
  assert.equal(leak5.length, 1);
});

test("parseConfig processa argumentos de linha de comando e env", () => {
  const cfg1 = parseConfig(["--url=https://minhaloja.preview.pages.dev"], {});
  assert.equal(cfg1.baseUrl, "https://minhaloja.preview.pages.dev");
  assert.equal(cfg1.timeoutMs, 10000);
  assert.equal(cfg1.retries, 3);

  const cfg2 = parseConfig([], {
    SMOKE_BASE_URL: "https://custom.com/",
    SMOKE_TIMEOUT_MS: "5000",
    SMOKE_RETRIES: "1",
    SMOKE_RETRY_DELAY_MS: "500"
  });
  assert.equal(cfg2.baseUrl, "https://custom.com");
  assert.equal(cfg2.timeoutMs, 5000);
  assert.equal(cfg2.retries, 1);
  assert.equal(cfg2.retryDelayMs, 500);

  // Fallback padrão
  const cfg3 = parseConfig([], {});
  assert.equal(cfg3.baseUrl, "https://rpdoces.com.br");
});

test("Suite de smoke test contra servidor HTTP simulado", async t => {
  let server;
  let baseUrl;

  // Mock server state
  let configResponse = {
    config: {
      days: [0, 1, 2, 3, 4, 5, 6],
      openTime: "10:00",
      closeTime: "22:00",
      localName: "R&P Doces",
      whatsapp: "11999999999",
      deliveryStatus: "aberto"
    }
  };
  let productsResponse = {
    produtos: [{ id: 1, nome: "Bolo de Chocolate", preco_centavos: 1500, categoria: "Bolos" }]
  };
  let htmlResponse = `<!doctype html><html><head><script type="module" src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>`;
  let assetResponse = "console.log('bundle');";
  let adminStatus = 401;
  let force500 = false;
  let injectLeak = false;

  await new Promise(resolve => {
    server = http.createServer((req, res) => {
      if (force500) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Error" }));
        return;
      }

      const url = req.url || "/";

      if (url === "/") {
        const body = injectLeak ? htmlResponse + " VAPID_PRIVATE_KEY=secret " : htmlResponse;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(body);
      } else if (url === "/assets/index-abc123.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(assetResponse);
      } else if (url === "/api/produtos") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(productsResponse));
      } else if (url === "/api/config") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(configResponse));
      } else if (url === "/api/admin/pedidos") {
        res.writeHead(adminStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Não autorizado" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Não encontrado" }));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  await t.test("suite passa com sucesso no cenário padrão", async () => {
    const result = await runSmokeSuite({ baseUrl, timeoutMs: 3000 });
    assert.equal(result.ok, true);
    assert.equal(result.checks.length, 6);
    assert.ok(result.checks.every(c => c.ok));
  });

  await t.test("checkFrontendHtml valida HTML e extrai asset", async () => {
    const res = await checkFrontendHtml(baseUrl);
    assert.equal(res.ok, true);
    assert.equal(res.assetPath, "/assets/index-abc123.js");
  });

  await t.test("checkFrontendHtml detecta vazamento de segredos", async () => {
    injectLeak = true;
    const res = await checkFrontendHtml(baseUrl);
    assert.equal(res.ok, false);
    assert.match(res.error, /Padrão proibido detectado/);
    injectLeak = false;
  });

  await t.test("checkAsset valida asset encontrado", async () => {
    const res = await checkAsset(baseUrl, "/assets/index-abc123.js");
    assert.equal(res.ok, true);
    assert.ok(res.bytes > 0);
  });

  await t.test("checkPublicProducts falha se produtos não for array", async () => {
    const orig = productsResponse;
    productsResponse = { produtos: "invalido" };
    const res = await checkPublicProducts(baseUrl);
    assert.equal(res.ok, false);
    assert.match(res.error, /chave 'produtos' deve ser um array/);
    productsResponse = orig;
  });

  await t.test("checkPublicConfig falha se contrato estiver incompleto", async () => {
    const orig = configResponse;
    configResponse = { config: { days: [0] } };
    const res = await checkPublicConfig(baseUrl);
    assert.equal(res.ok, false);
    assert.match(res.error, /'days' deve ser um array com 7 dias/);
    configResponse = orig;
  });

  await t.test(
    "checkAdminProtection detecta falha se endpoint estiver desprotegido (HTTP 200)",
    async () => {
      adminStatus = 200;
      const res = await checkAdminProtection(baseUrl);
      assert.equal(res.ok, false);
      assert.match(res.error, /Falha de segurança/);
      adminStatus = 401;
    }
  );

  await t.test("checkNotFoundEndpoint valida retorno 404 em rota inexistente", async () => {
    const res = await checkNotFoundEndpoint(baseUrl);
    assert.equal(res.ok, true);
    assert.equal(res.status, 404);
  });

  await t.test("executeSmokeWithRetries recupera falha temporária e tem sucesso", async () => {
    let callCount = 0;
    force500 = true;

    const mockLogger = {
      log: () => {
        callCount++;
        // Na segunda tentativa, desativa o erro 500 simulando edge restabelecido
        force500 = false;
      },
      error: () => {}
    };

    const res = await executeSmokeWithRetries(
      { baseUrl, timeoutMs: 2000, retries: 2, retryDelayMs: 50 },
      mockLogger
    );

    assert.equal(res.ok, true);
    assert.equal(res.attempt, 2);
    assert.equal(callCount, 1);
  });

  await t.test("executeSmokeWithRetries encerra com erro quando retries se esgotam", async () => {
    force500 = true;
    const mockLogger = { log: () => {}, error: () => {} };

    const res = await executeSmokeWithRetries(
      { baseUrl, timeoutMs: 2000, retries: 1, retryDelayMs: 20 },
      mockLogger
    );

    assert.equal(res.ok, false);
    assert.equal(res.attempt, 2);
    force500 = false;
  });
});
