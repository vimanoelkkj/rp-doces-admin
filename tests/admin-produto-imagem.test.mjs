import test from "node:test";
import assert from "node:assert/strict";
import { app, fixture } from "./helpers/b3.mjs";

const URL_UPLOAD = "https://local.test/api/admin/produtos/1/imagem";
const cookieDe = session => session.cookie.split(";")[0];

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// WebP 1x1 lossy real (42 bytes): "RIFF", tamanho 34, "WEBP", chunk "VP8 ".
const WEBP_1X1 = Uint8Array.from(
  Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")
);

function criarR2() {
  const objetos = new Map();
  const gravacoes = [];

  return {
    objetos,
    gravacoes,

    async put(key, bytes, options) {
      gravacoes.push({ key, bytes, options });
      objetos.set(key, { bytes, options });
    },

    async get(key) {
      const objeto = objetos.get(key);
      if (!objeto) return null;

      return {
        body: new Uint8Array(objeto.bytes),
        httpEtag: '"etag-teste"',
        writeHttpMetadata(headers) {
          headers.set("content-type", objeto.options.httpMetadata.contentType);
        }
      };
    },

    async delete(key) {
      objetos.delete(key);
    }
  };
}

function enviar(db, r2, session, file, origin = "https://local.test") {
  const form = new FormData();
  form.append("image", file);

  return app.adminProdutoImagem.onRequestPost({
    env: { DB: db, PRODUCT_IMAGES: r2 },
    params: { id: "1" },
    request: new Request(URL_UPLOAD, {
      method: "POST",
      headers: {
        Origin: origin,
        ...(session ? { Cookie: cookieDe(session) } : {})
      },
      body: form
    })
  });
}

async function confirmarSemGravacao(db, r2) {
  assert.equal(r2.gravacoes.length, 0);
  assert.equal(r2.objetos.size, 0);

  const produto = await db.prepare("SELECT image_key FROM produtos WHERE id = ?").bind(1).first();

  assert.equal(produto.image_key, null);
}

test("upload sem sessao retorna 401 e nao grava imagem", async t => {
  const db = await fixture(t);
  const r2 = criarR2();

  const file = new File([PNG_SIGNATURE], "produto.png", {
    type: "image/png"
  });

  const res = await enviar(db, r2, null, file);

  assert.equal(res.status, 401);
  await confirmarSemGravacao(db, r2);
});

test("upload de outra origem retorna 403 e nao grava imagem", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File([PNG_SIGNATURE], "produto.png", {
    type: "image/png"
  });

  const res = await enviar(db, r2, session, file, "https://origem-externa.test");

  assert.equal(res.status, 403);
  await confirmarSemGravacao(db, r2);
});

test("upload SVG retorna 415 e nao grava imagem", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], "produto.svg", {
    type: "image/svg+xml"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 415);
  await confirmarSemGravacao(db, r2);
});

test("PNG declarado como JPEG retorna 415 e nao grava imagem", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File([PNG_SIGNATURE], "produto.jpg", {
    type: "image/jpeg"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 415);
  await confirmarSemGravacao(db, r2);
});

test("SVG disfarçado de PNG retorna 415 e nao grava imagem", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], "produto.png", {
    type: "image/png"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 415);
  await confirmarSemGravacao(db, r2);
});

test("arquivo vazio retorna 413 e nao grava imagem", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File([], "produto.png", {
    type: "image/png"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 413);
  await confirmarSemGravacao(db, r2);
});

test("arquivo acima de 5 MB retorna 413 e nao grava imagem", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "produto.png", {
    type: "image/png"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 413);
  await confirmarSemGravacao(db, r2);
});

test("PNG com assinatura reconhecida persiste no R2 e no D1", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File([PNG_SIGNATURE], "produto.png", {
    type: "image/png"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 200);

  const body = await res.json();

  assert.equal(body.ok, true);
  assert.match(body.imageKey, /^product-1-[0-9a-f-]+\.png$/);
  assert.equal(body.imageUrl, `/api/images/${encodeURIComponent(body.imageKey)}`);

  assert.equal(r2.gravacoes.length, 1);
  assert.equal(r2.objetos.has(body.imageKey), true);

  const gravacao = r2.gravacoes[0];

  assert.equal(gravacao.options.httpMetadata.contentType, "image/png");
  assert.equal(gravacao.options.customMetadata.productId, "1");
  assert.deepEqual(new Uint8Array(gravacao.bytes), PNG_SIGNATURE);

  const produto = await db.prepare("SELECT image_key FROM produtos WHERE id = ?").bind(1).first();

  assert.equal(produto.image_key, body.imageKey);
});

test("WebP válido persiste no R2 e no D1 e é entregue como image/webp", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File([WEBP_1X1], "produto.webp", {
    type: "image/webp"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 200);

  const body = await res.json();

  assert.equal(body.ok, true);
  assert.match(body.imageKey, /^product-1-[0-9a-f-]+\.webp$/);
  assert.equal(body.imageUrl, `/api/images/${encodeURIComponent(body.imageKey)}`);

  assert.equal(r2.gravacoes.length, 1);

  const gravacao = r2.gravacoes[0];

  assert.equal(gravacao.options.httpMetadata.contentType, "image/webp");
  assert.deepEqual(new Uint8Array(gravacao.bytes), WEBP_1X1);

  const produto = await db.prepare("SELECT image_key FROM produtos WHERE id = ?").bind(1).first();

  assert.equal(produto.image_key, body.imageKey);

  const publica = await app.publicImage.onRequestGet({
    env: { PRODUCT_IMAGES: r2 },
    params: { key: body.imageKey }
  });

  assert.equal(publica.status, 200);
  assert.equal(publica.headers.get("content-type"), "image/webp");
  assert.equal(publica.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await publica.arrayBuffer()), WEBP_1X1);
});

test("novo upload substitui a imagem anterior do produto", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const antigaKey = "product-1-11111111-1111-4111-8111-111111111111.png";

  r2.objetos.set(antigaKey, {
    bytes: PNG_SIGNATURE.buffer.slice(0),
    options: {
      httpMetadata: { contentType: "image/png" }
    }
  });

  await db.prepare("UPDATE produtos SET image_key = ? WHERE id = ?").bind(antigaKey, 1).run();

  const file = new File([PNG_SIGNATURE], "nova.png", {
    type: "image/png"
  });

  const res = await enviar(db, r2, session, file);

  assert.equal(res.status, 200);

  const body = await res.json();

  assert.notEqual(body.imageKey, antigaKey);
  assert.equal(r2.objetos.has(antigaKey), false);
  assert.equal(r2.objetos.has(body.imageKey), true);
  assert.equal(r2.gravacoes.length, 1);

  const produto = await db.prepare("SELECT image_key FROM produtos WHERE id = ?").bind(1).first();

  assert.equal(produto.image_key, body.imageKey);
});

test("imagem publica preserva MIME e envia nosniff", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const file = new File([PNG_SIGNATURE], "produto.png", {
    type: "image/png"
  });

  const upload = await enviar(db, r2, session, file);

  assert.equal(upload.status, 200);

  const { imageKey } = await upload.json();

  const res = await app.publicImage.onRequestGet({
    env: { PRODUCT_IMAGES: r2 },
    params: { key: imageKey }
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");

  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG_SIGNATURE);

  const invalida = await app.publicImage.onRequestGet({
    env: { PRODUCT_IMAGES: r2 },
    params: { key: "arquivo.svg" }
  });

  assert.equal(invalida.status, 404);
});

test("falha no UPDATE do D1 remove o novo objeto e preserva a imagem anterior", async t => {
  const db = await fixture(t);
  const session = await app.auth.createSession(db, 1);
  const r2 = criarR2();

  const antigaKey = "product-1-22222222-2222-4222-8222-222222222222.png";

  r2.objetos.set(antigaKey, {
    bytes: PNG_SIGNATURE.buffer.slice(0),
    options: {
      httpMetadata: { contentType: "image/png" }
    }
  });

  await db.prepare("UPDATE produtos SET image_key = ? WHERE id = ?").bind(antigaKey, 1).run();

  let updateInterceptado = false;

  const dbComFalha = new Proxy(db, {
    get(target, propriedade) {
      if (propriedade !== "prepare") {
        return Reflect.get(target, propriedade);
      }

      return sql => {
        if (/UPDATE\s+produtos\s+SET\s+image_key\s*=\s*\?/i.test(sql)) {
          updateInterceptado = true;

          return {
            bind() {
              return {
                async run() {
                  throw new Error("Falha D1 simulada");
                }
              };
            }
          };
        }

        return target.prepare(sql);
      };
    }
  });

  const file = new File([PNG_SIGNATURE], "nova.png", {
    type: "image/png"
  });

  // A falha simulada é esperada; evita ruído no terminal.
  t.mock.method(console, "error", () => {});

  const res = await enviar(dbComFalha, r2, session, file);

  assert.equal(res.status, 500);
  assert.equal(updateInterceptado, true);

  // A nova imagem chegou a ser gravada.
  assert.equal(r2.gravacoes.length, 1);

  const novaKey = r2.gravacoes[0].key;

  // O rollback compensatório removeu somente a imagem nova.
  assert.equal(r2.objetos.has(novaKey), false);
  assert.equal(r2.objetos.has(antigaKey), true);

  // O banco continua apontando para a imagem anterior.
  const produto = await db.prepare("SELECT image_key FROM produtos WHERE id = ?").bind(1).first();

  assert.equal(produto.image_key, antigaKey);
});
