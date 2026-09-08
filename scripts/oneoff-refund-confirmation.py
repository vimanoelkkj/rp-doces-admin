from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"pattern not found in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")

# Web: explicit confirmation that the refund was already made manually.
web = "admin/src/orders/EditOrderItemDialog.tsx"
patch(
    web,
    '  const [refundMethod, setRefundMethod] = useState<RefundMethod>(() => defaultRefundMethod(order.metodo_pagamento));\n  const [saving, setSaving] = useState(false);\n',
    '  const [refundMethod, setRefundMethod] = useState<RefundMethod>(() => defaultRefundMethod(order.metodo_pagamento));\n  const [refundConfirmed, setRefundConfirmed] = useState(false);\n  const [saving, setSaving] = useState(false);\n'
)
patch(
    web,
    '  const refundCents = paidExchange ? Math.max(0, paidCents - previewTotal) : 0;\n  const pendingAfterExchange = paidExchange ? Math.max(0, previewTotal - paidCents) : 0;\n\n  async function submit',
    '  const refundCents = paidExchange ? Math.max(0, paidCents - previewTotal) : 0;\n  const pendingAfterExchange = paidExchange ? Math.max(0, previewTotal - paidCents) : 0;\n\n  useEffect(() => {\n    setRefundConfirmed(false);\n  }, [productId, quantity, refundMethod, refundCents]);\n\n  async function submit'
)
patch(
    web,
    '    if (quantity > maxQuantity) {\n      setError(`${selectedProduct.nome}: estoque disponível insuficiente.`);\n      return;\n    }\n\n    updateSaving(true);\n',
    '    if (quantity > maxQuantity) {\n      setError(`${selectedProduct.nome}: estoque disponível insuficiente.`);\n      return;\n    }\n    if (refundCents > 0 && !refundConfirmed) {\n      setError(`Confirme que ${money(refundCents)} já foi devolvido à cliente antes de registrar a troca.`);\n      return;\n    }\n\n    updateSaving(true);\n'
)
patch(
    web,
    '''              {refundCents > 0 ? (\n                <div className={styles.field}>\n                  <label htmlFor="edit-order-refund-method">Forma da devolução</label>\n                  <ManualOrderSelect\n                    id="edit-order-refund-method"\n                    value={refundMethod}\n                    options={REFUND_METHOD_OPTIONS}\n                    disabled={saving}\n                    ariaLabel="Selecionar forma da devolução"\n                    onChange={value => setRefundMethod(value as RefundMethod)}\n                  />\n                </div>\n              ) : null}\n''',
    '''              {refundCents > 0 ? (\n                <>\n                  <div className={styles.field}>\n                    <label htmlFor="edit-order-refund-method">Forma da devolução</label>\n                    <ManualOrderSelect\n                      id="edit-order-refund-method"\n                      value={refundMethod}\n                      options={REFUND_METHOD_OPTIONS}\n                      disabled={saving}\n                      ariaLabel="Selecionar forma da devolução"\n                      onChange={value => setRefundMethod(value as RefundMethod)}\n                    />\n                  </div>\n\n                  <div\n                    style={{\n                      marginTop: 12,\n                      padding: 12,\n                      border: "1px solid var(--line)",\n                      borderRadius: 10,\n                      background: "var(--surface-soft)",\n                      display: "grid",\n                      gap: 10\n                    }}\n                  >\n                    <strong style={{ fontSize: 12, color: "var(--text)" }}>Atenção</strong>\n                    <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--muted)" }}>\n                      Faça a devolução de {money(refundCents)} para a cliente antes de confirmar. Este fluxo não envia Pix nem faz estorno automático.\n                    </span>\n                    <label\n                      style={{\n                        display: "flex",\n                        alignItems: "center",\n                        gap: 9,\n                        fontSize: 11,\n                        fontWeight: 700,\n                        color: "var(--text)",\n                        cursor: saving ? "default" : "pointer"\n                      }}\n                    >\n                      <input\n                        type="checkbox"\n                        checked={refundConfirmed}\n                        disabled={saving}\n                        onChange={event => setRefundConfirmed(event.target.checked)}\n                        style={{ accentColor: "var(--pink-strong)", width: 16, height: 16 }}\n                      />\n                      Confirmo que {money(refundCents)} já foi devolvido à cliente\n                    </label>\n                  </div>\n                </>\n              ) : null}\n'''
)
patch(
    web,
    '''            {refundCents > 0\n              ? `Ao confirmar, ${money(refundCents)} será registrado como devolvido. O produto original volta ao estoque e o novo produto assume a baixa ou reserva correspondente.`\n''',
    '''            {refundCents > 0\n              ? `Depois da confirmação manual, ${money(refundCents)} será apenas registrado como devolvido no sistema. O produto original volta ao estoque e o novo produto assume a baixa ou reserva correspondente.`\n'''
)
patch(
    web,
    '''            <button className={styles.submit} type="submit" disabled={saving || loadingProducts || !selectedProduct}>\n              {saving ? "Salvando..." : refundCents > 0 ? `Trocar e devolver ${money(refundCents)}` : "Salvar troca"}\n            </button>\n''',
    '''            <button\n              className={styles.submit}\n              type="submit"\n              disabled={saving || loadingProducts || !selectedProduct || (refundCents > 0 && !refundConfirmed)}\n            >\n              {saving ? "Salvando..." : refundCents > 0 ? `Confirmar devolução de ${money(refundCents)}` : "Salvar troca"}\n            </button>\n'''
)

# Android: mirror the same manual-refund acknowledgement with R&P-styled control.
android = "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/orders/EditOrderItemDialog.kt"
patch(
    android,
    '    var refundMethod by remember(item.id) { mutableStateOf(defaultRefundMethod(order.paymentMethod)) }\n    var refundMethodOpen by remember { mutableStateOf(false) }\n',
    '    var refundMethod by remember(item.id) { mutableStateOf(defaultRefundMethod(order.paymentMethod)) }\n    var refundConfirmed by remember(item.id) { mutableStateOf(false) }\n    var refundMethodOpen by remember { mutableStateOf(false) }\n'
)
patch(
    android,
    '''                onSelect = { productId ->\n                    selectedProductId = productId\n                    quantity = 1\n                    productOpen = false\n                }\n''',
    '''                onSelect = { productId ->\n                    selectedProductId = productId\n                    quantity = 1\n                    refundConfirmed = false\n                    productOpen = false\n                }\n'''
)
patch(
    android,
    '''                    onDecrease = { quantity = (quantity - 1).coerceAtLeast(1) },\n                    onIncrease = { quantity = (quantity + 1).coerceAtMost(maxQuantity) }\n''',
    '''                    onDecrease = {\n                        quantity = (quantity - 1).coerceAtLeast(1)\n                        refundConfirmed = false\n                    },\n                    onIncrease = {\n                        quantity = (quantity + 1).coerceAtMost(maxQuantity)\n                        refundConfirmed = false\n                    }\n'''
)
patch(
    android,
    '''                                onSelect = {\n                                    refundMethod = it\n                                    refundMethodOpen = false\n                                }\n                            )\n''',
    '''                                onSelect = {\n                                    refundMethod = it\n                                    refundConfirmed = false\n                                    refundMethodOpen = false\n                                }\n                            )\n                            Spacer(Modifier.height(10.dp))\n                            Surface(\n                                onClick = { if (!saving) refundConfirmed = !refundConfirmed },\n                                modifier = Modifier.fillMaxWidth(),\n                                shape = RoundedCornerShape(9.dp),\n                                color = web.surface,\n                                border = BorderStroke(1.dp, if (refundConfirmed) web.accent else web.borderStrong)\n                            ) {\n                                Row(\n                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 11.dp, vertical = 10.dp),\n                                    verticalAlignment = Alignment.CenterVertically,\n                                    horizontalArrangement = Arrangement.spacedBy(9.dp)\n                                ) {\n                                    Surface(\n                                        shape = RoundedCornerShape(5.dp),\n                                        color = if (refundConfirmed) web.accent else web.surface,\n                                        border = BorderStroke(1.dp, if (refundConfirmed) web.accent else web.borderStrong)\n                                    ) {\n                                        Box(modifier = Modifier.size(18.dp), contentAlignment = Alignment.Center) {\n                                            if (refundConfirmed) {\n                                                Text("✓", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)\n                                            }\n                                        }\n                                    }\n                                    Text(\n                                        "Confirmo que ${money(refundCents)} já foi devolvido à cliente",\n                                        color = web.text,\n                                        fontSize = 10.5.sp,\n                                        fontWeight = FontWeight.SemiBold,\n                                        modifier = Modifier.weight(1f)\n                                    )\n                                }\n                            }\n'''
)
patch(
    android,
    '''                    refundCents > 0 -> "Ao confirmar, ${money(refundCents)} será registrado como devolvido. O produto original volta ao estoque e o novo assume a baixa ou reserva correspondente."\n''',
    '''                    refundCents > 0 -> "Faça a devolução de ${money(refundCents)} à cliente antes de confirmar. Este fluxo não envia Pix nem faz estorno automático; ele apenas registra a devolução e conclui a troca."\n'''
)
patch(
    android,
    '            primaryText = if (refundCents > 0) "Trocar e devolver ${money(refundCents)}" else "Salvar troca",\n',
    '            primaryText = if (refundCents > 0) "Confirmar devolução de ${money(refundCents)}" else "Salvar troca",\n'
)
patch(
    android,
    '''                    quantity !in 1..maxQuantity -> "Quantidade indisponível para este produto."\n                    else -> null\n''',
    '''                    quantity !in 1..maxQuantity -> "Quantidade indisponível para este produto."\n                    refundCents > 0 && !refundConfirmed -> "Confirme que ${money(refundCents)} já foi devolvido à cliente."\n                    else -> null\n'''
)
patch(
    android,
    '                                confirmRefund = refundCents > 0\n',
    '                                confirmRefund = refundCents > 0 && refundConfirmed\n'
)
