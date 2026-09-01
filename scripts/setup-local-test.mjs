import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_NAME = "rp-doces-db";
const D1_ID = process.env.RP_D1_ID || "c2e15599-3d68-4801-9a1c-96a84977dd7c";
const ADMIN_USER = "adminlocal";
const ADMIN_PASSWORD = "TesteLocal@123";
const serve = process.argv.includes("--serve");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(args, { inherit = true } = {}) {
  const result = spawnSync(npx, args, {
    cwd: process.cwd(),
    stdio: inherit ? "inherit" : "pipe",
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    if (!inherit && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  return result;
}

function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 100000, 32, "sha256");
  return `pbkdf2_sha256$100000$${salt.toString("hex")}$${derived.toString("hex")}`;
}

console.log("\nR&P Doces · preparando ambiente local de testes\n");
console.log("1/2 Aplicando migrations locais...");
run(["wrangler", "d1", "migrations", "apply", DB_NAME, "--local"]);

const hash = passwordHash(ADMIN_PASSWORD);
const sql = `
PRAGMA foreign_keys = ON;

DELETE FROM auth_rate_limits;
DELETE FROM checkout_rate_limits;
DELETE FROM pedidos WHERE token_publico LIKE 'local-test-%';
DELETE FROM produtos WHERE nome IN ('Produto A (Teste)', 'Produto B (Teste)', 'Produto C (Teste)');

INSERT INTO categorias (id, nome, emoji, descricao, ordem, ativo, sistema)
VALUES ('BOLO_NO_POTE', 'Bolos no pote', '🍰', 'Categoria local de testes', 0, 1, 1)
ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, ativo=1;

INSERT INTO categorias (id, nome, emoji, descricao, ordem, ativo, sistema)
VALUES ('MINI_PUDIM', 'Mini pudins', '🍮', 'Categoria local de testes', 1, 1, 1)
ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, ativo=1;

UPDATE usuarios_admin
SET nome='Admin Local', email='adminlocal@teste.local', senha_hash='${hash}', ativo=1, papel='OWNER'
WHERE username='${ADMIN_USER}';

INSERT INTO usuarios_admin (nome, username, email, senha_hash, ativo, papel)
SELECT 'Admin Local', '${ADMIN_USER}', 'adminlocal@teste.local', '${hash}', 1, 'OWNER'
WHERE NOT EXISTS (SELECT 1 FROM usuarios_admin WHERE username='${ADMIN_USER}');

INSERT INTO produtos (nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji, estoque, estoque_reservado)
VALUES ('Produto A (Teste)', 'BOLO_NO_POTE', 'Fixture para comanda paga', 1200, 1, 1, 0, 900, '🍰', 10, 0);
INSERT INTO produtos (nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji, estoque, estoque_reservado)
VALUES ('Produto B (Teste)', 'BOLO_NO_POTE', 'Fixture para adicionar à comanda', 1200, 1, 1, 0, 901, '🧁', 10, 0);
INSERT INTO produtos (nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji, estoque, estoque_reservado)
VALUES ('Produto C (Teste)', 'MINI_PUDIM', 'Fixture para Pix pendente', 1000, 1, 1, 0, 902, '🍮', 10, 0);

INSERT INTO pedidos (
  token_publico, produto_id, produto_nome, quantidade, valor_unitario_centavos,
  valor_total_centavos, cliente_nome, cliente_email, cliente_whatsapp, observacao,
  metodo_pagamento, status_pagamento, idempotency_key, status_pedido, origem_pedido,
  reserva_status, status_comanda, pago_em, estoque_baixado_em
)
SELECT
  'local-test-paid-a', id, nome, 1, 1200,
  1200, 'Cliente Teste Pago', 'pago@teste.local', '5531999990001', 'Comanda local já paga',
  'PIX_EXTERNO', 'PAGO', 'local-test-paid-a-0001', 'NOVO', 'MANUAL',
  'CONVERTIDA', 'ABERTA', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM produtos WHERE nome='Produto A (Teste)';

INSERT INTO pedido_itens (
  pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos,
  valor_total_centavos, estoque_baixado_em, adicionado_por_usuario_id, adicionado_em
)
SELECT p.id, pr.id, pr.nome, 1, 1200, 1200, CURRENT_TIMESTAMP,
       (SELECT id FROM usuarios_admin WHERE username='${ADMIN_USER}' LIMIT 1), CURRENT_TIMESTAMP
FROM pedidos p JOIN produtos pr ON pr.nome='Produto A (Teste)'
WHERE p.token_publico='local-test-paid-a';

INSERT INTO pedido_pagamentos (
  pedido_id, metodo, origem, valor_centavos, status, registrado_por_usuario_id,
  observacao, pago_em
)
SELECT id, 'PIX_EXTERNO', 'ADMIN', 1200, 'PAGO',
       (SELECT id FROM usuarios_admin WHERE username='${ADMIN_USER}' LIMIT 1),
       'Pagamento fixture local', CURRENT_TIMESTAMP
FROM pedidos WHERE token_publico='local-test-paid-a';

INSERT INTO pedido_pagamento_alocacoes (pagamento_id, pedido_item_id, valor_centavos)
SELECT pg.id, pi.id, 1200
FROM pedido_pagamentos pg
JOIN pedidos p ON p.id=pg.pedido_id AND p.token_publico='local-test-paid-a'
JOIN pedido_itens pi ON pi.pedido_id=p.id
WHERE pg.observacao='Pagamento fixture local';

UPDATE produtos SET estoque=9, estoque_reservado=0 WHERE nome='Produto A (Teste)';

INSERT INTO pedidos (
  token_publico, produto_id, produto_nome, quantidade, valor_unitario_centavos,
  valor_total_centavos, cliente_nome, cliente_email, cliente_whatsapp, observacao,
  metodo_pagamento, status_pagamento, mp_order_id, mp_status, mp_status_detail,
  mp_ticket_url, mp_qr_code, idempotency_key, status_pedido, origem_pedido,
  reserva_status, reserva_expira_em, pix_expira_em, status_comanda
)
SELECT
  'local-test-pix-pending', id, nome, 1, 1000,
  1000, 'Cliente Teste Pix', 'pix@teste.local', '5531999990002', 'Comanda local com Pix pendente',
  'PIX', 'PENDENTE', 'local_test_pix_pending_1', 'action_required', 'waiting_transfer',
  'http://127.0.0.1:8788/pedido/?token=local-test-pix-pending', '000201LOCALTESTPIX1000',
  'local-test-pix-pending-0001', 'NOVO', 'SITE',
  'ATIVA', datetime('now', '+31 minutes'), datetime('now', '+30 minutes'), 'ABERTA'
FROM produtos WHERE nome='Produto C (Teste)';

INSERT INTO pedido_itens (
  pedido_id, produto_id, produto_nome, quantidade, valor_unitario_centavos, valor_total_centavos
)
SELECT p.id, pr.id, pr.nome, 1, 1000, 1000
FROM pedidos p JOIN produtos pr ON pr.nome='Produto C (Teste)'
WHERE p.token_publico='local-test-pix-pending';

INSERT INTO pedido_pagamentos (
  pedido_id, metodo, origem, valor_centavos, status, mp_order_id, mp_status,
  mp_status_detail, mp_ticket_url, mp_qr_code, idempotency_key, pix_expira_em,
  observacao
)
SELECT id, 'PIX_MP', 'SITE', 1000, 'PENDENTE', 'local_test_pix_pending_1',
       'action_required', 'waiting_transfer',
       'http://127.0.0.1:8788/pedido/?token=local-test-pix-pending',
       '000201LOCALTESTPIX1000', 'local-test-ledger-pix-0001', datetime('now', '+30 minutes'),
       'Pix fixture local'
FROM pedidos WHERE token_publico='local-test-pix-pending';

UPDATE produtos SET estoque_reservado=1 WHERE nome='Produto C (Teste)';
`;

const tempFile = join(tmpdir(), `rp-doces-local-test-${process.pid}.sql`);
writeFileSync(tempFile, sql, "utf8");
console.log("2/2 Recriando fixtures locais...");
try {
  run(["wrangler", "d1", "execute", DB_NAME, "--local", "--file", tempFile]);
} finally {
  try {
    unlinkSync(tempFile);
  } catch {}
}

console.log(`\nAmbiente pronto.\n\nAdmin: ${ADMIN_USER}\nSenha: ${ADMIN_PASSWORD}\n`);
console.log("Fixtures:");
console.log("- Produto A (Teste): estoque 9, já pago em uma comanda aberta");
console.log("- Produto B (Teste): estoque 10, pronto para ser adicionado");
console.log("- Produto C (Teste): estoque 10 / reservado 1, Pix pendente");
console.log("- Comanda paga: Cliente Teste Pago");
console.log("- Comanda Pix pendente: Cliente Teste Pix\n");

if (serve) {
  console.log("Subindo Pages local em http://127.0.0.1:8788 ...\n");
  const child = spawn(
    npx,
    [
      "wrangler",
      "pages",
      "dev",
      "public",
      "--port",
      "8788",
      "--d1",
      `DB=${D1_ID}`,
      "--binding",
      "SETUP_KEY=teste-local-123",
      "--binding",
      "LOCAL_TEST_MODE=1",
      "--binding",
      "RATE_LIMIT_SECRET=teste-local-rate-limit"
    ],
    { cwd: process.cwd(), stdio: "inherit", shell: false }
  );
  child.on("exit", code => process.exit(code ?? 0));
}
