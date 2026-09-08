from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# A lista principal precisa carregar financeiro por item. Sem isso o modal entende item pago como pendente.
patch(
    "functions/api/admin/orders/index.js",
    'import { syncManualPaidOrder } from "../../../lib/comandaLedger.js";\n',
    'import { syncManualPaidOrder } from "../../../lib/comandaLedger.js";\nimport { attachOrderFinancials } from "../../../lib/orderLedger.js";\n'
)
patch(
    "functions/api/admin/orders/index.js",
    '  for (const pedido of pedidos) pedido.itens = porPedido.get(Number(pedido.id)) || [];\n  return json({ pedidos });\n',
    '  for (const pedido of pedidos) pedido.itens = porPedido.get(Number(pedido.id)) || [];\n  await attachOrderFinancials(env, pedidos);\n  return json({ pedidos });\n'
)

# Defesa no servidor: item com pagamento confirmado nunca pode passar pela edição comum.
patch(
    "functions/api/admin/orders/[id]/items.js",
    '  await ensureLegacyPaymentMaterialized(env, pedidoId);\n\n  const statements = stockMutationStatements(env, item, product, quantidade, pedido.reserva_status);\n',
    '''  await ensureLegacyPaymentMaterialized(env, pedidoId);\n\n  const paidRow = await env.DB.prepare(\n    `SELECT COALESCE(SUM(a.valor_centavos), 0) AS pago_centavos\n     FROM pedido_pagamento_alocacoes a\n     JOIN pedido_pagamentos pp ON pp.id = a.pagamento_id\n     WHERE a.pedido_item_id = ? AND pp.status = 'PAGO'`\n  )\n    .bind(itemId)\n    .first();\n  if (Number(paidRow?.pago_centavos || 0) > 0) {\n    return json({\n      erro: "Este item possui pagamento confirmado. Use a troca de item pago para ajustar saldo ou devolução."\n    }, 409);\n  }\n\n  const statements = stockMutationStatements(env, item, product, quantidade, pedido.reserva_status);\n'''
)

# Regressão simples e permanente para impedir que as duas proteções desapareçam.
test_path = ROOT / "tests/paid-item-exchange-guard.test.mjs"
test_path.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst ordersIndex = fs.readFileSync("functions/api/admin/orders/index.js", "utf8");\nconst itemsApi = fs.readFileSync("functions/api/admin/orders/[id]/items.js", "utf8");\n\ntest("lista de pedidos anexa financeiro por item antes de responder", () => {\n  assert.match(ordersIndex, /attachOrderFinancials/);\n  assert.match(ordersIndex, /await attachOrderFinancials\\(env, pedidos\\)/);\n});\n\ntest("edicao comum bloqueia item com pagamento confirmado", () => {\n  assert.match(itemsApi, /pedido_pagamento_alocacoes/);\n  assert.match(itemsApi, /Este item possui pagamento confirmado/);\n  assert.match(itemsApi, /pp\\.status = 'PAGO'/);\n});\n''', encoding="utf-8")
