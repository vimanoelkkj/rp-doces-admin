import test from "node:test";
import assert from "node:assert/strict";
import { bodyJson, sameOrigin } from "../functions/lib/http.js";
import {
  getCookie,
  hashPassword,
  validatePassword,
  verifyPassword
} from "../functions/lib/auth.js";
test("bodyJson valida tamanho e formato", async () => {
  assert.deepEqual(
    await bodyJson(
      new Request("https://loja.test/api", { method: "POST", body: JSON.stringify({ a: 1 }) }),
      100
    ),
    { a: 1 }
  );
  assert.equal(
    await bodyJson(
      new Request("https://loja.test/api", { method: "POST", body: "x".repeat(101) }),
      100
    ),
    null
  );
  assert.equal(
    await bodyJson(new Request("https://loja.test/api", { method: "POST", body: "{" })),
    null
  );
});
test("sameOrigin protege métodos mutáveis", () => {
  assert.equal(
    sameOrigin(
      new Request("https://loja.test/api", {
        method: "POST",
        headers: { Origin: "https://loja.test" }
      })
    ),
    true
  );
  assert.equal(
    sameOrigin(
      new Request("https://loja.test/api", {
        method: "POST",
        headers: { Origin: "https://fraude.test" }
      })
    ),
    false
  );
  assert.equal(sameOrigin(new Request("https://loja.test/api", { method: "POST" })), false);
  assert.equal(sameOrigin(new Request("https://loja.test/api")), true);
});
test("senha é derivada e verificada", async () => {
  const hash = await hashPassword("segura123");
  assert.notEqual(hash, "segura123");
  assert.equal(await verifyPassword("segura123", hash), true);
  assert.equal(await verifyPassword("errada123", hash), false);
  assert.equal(validatePassword("curta1"), "A senha precisa ter pelo menos 8 caracteres.");
  assert.equal(validatePassword("semsomenteletras"), "Use pelo menos uma letra e um número.");
});
test("cookie administrativo é extraído corretamente", () =>
  assert.equal(
    getCookie(
      new Request("https://loja.test/admin", {
        headers: { Cookie: "x=1; rp_admin_session=abc%20123; y=2" }
      })
    ),
    "abc 123"
  ));
