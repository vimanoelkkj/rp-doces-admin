from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def effective_sql(indent):
    return f'''{indent}CASE
{indent}  WHEN (SELECT COUNT(DISTINCT pp.metodo)
{indent}        FROM pedido_pagamentos pp
{indent}        WHERE pp.pedido_id = pedidos.id AND pp.status = 'PAGO') = 1
{indent}  THEN COALESCE((
{indent}    SELECT CASE WHEN pp.metodo = 'PIX_MP' THEN 'PIX' ELSE pp.metodo END
{indent}    FROM pedido_pagamentos pp
{indent}    WHERE pp.pedido_id = pedidos.id AND pp.status = 'PAGO'
{indent}    ORDER BY pp.id DESC
{indent}    LIMIT 1
{indent}  ), pedidos.metodo_pagamento)
{indent}  WHEN (SELECT COUNT(DISTINCT pp.metodo)
{indent}        FROM pedido_pagamentos pp
{indent}        WHERE pp.pedido_id = pedidos.id AND pp.status = 'PAGO') > 1
{indent}  THEN 'MULTIPLO'
{indent}  ELSE pedidos.metodo_pagamento
{indent}END AS metodo_pagamento,'''

# Admin order list: show the confirmed ledger method, not the legacy creation default.
patch(
    "functions/api/admin/orders/index.js",
    "      cliente_whatsapp, tipo_entrega, observacao, metodo_pagamento, status_pagamento, status_pedido,\n",
    "      cliente_whatsapp, tipo_entrega, observacao,\n" + effective_sql("      ") + "\n      status_pagamento, status_pedido,\n"
)

# Financial list used by Android: same canonical display rule.
patch(
    "functions/api/admin/orders/finance.js",
    "            tipo_entrega, observacao, metodo_pagamento,\n            status_pagamento, status_pedido, status_comanda, origem_pedido,\n",
    "            tipo_entrega, observacao,\n" + effective_sql("            ") + "\n            status_pagamento, status_pedido, status_comanda, origem_pedido,\n"
)

# Web label for genuine mixed payments.
patch(
    "admin/src/orders/OrdersPage.tsx",
    "  if (method.includes(\"DINHEIRO\")) return \"Dinheiro\";\n  return order.metodo_pagamento || \"—\";\n",
    "  if (method.includes(\"DINHEIRO\")) return \"Dinheiro\";\n  if (method === \"MULTIPLO\") return \"Múltiplos\";\n  if (method === \"A_COMBINAR\") return \"A combinar\";\n  return order.metodo_pagamento || \"—\";\n"
)

# Android label for mixed payments in the order summary.
patch(
    "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt",
    "                                DetailLine(\"Pagamento\", order.paymentMethod ?: \"—\")\n",
    "                                DetailLine(\"Pagamento\", paymentMethodLabel(order.paymentMethod))\n"
)

# Add Android payment-method presentation helper next to other small label helpers.
patch(
    "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/OrdersScreen.kt",
    '''private fun financialLabel(status: String?): String = when (status?.uppercase()) {
    "PAGO" -> "Pago"
    "PARCIAL" -> "Parcial"
    else -> "Pendente"
}
''',
    '''private fun paymentMethodLabel(method: String?): String = when (method.orEmpty().uppercase()) {
    "PIX", "PIX_MP" -> "Pix"
    "PIX_EXTERNO" -> "Pix direto"
    "CARTAO" -> "Cartão"
    "DINHEIRO" -> "Dinheiro"
    "MULTIPLO" -> "Múltiplos"
    "A_COMBINAR" -> "A combinar"
    else -> method ?: "—"
}

private fun financialLabel(status: String?): String = when (status?.uppercase()) {
    "PAGO" -> "Pago"
    "PARCIAL" -> "Parcial"
    else -> "Pendente"
}
'''
)
