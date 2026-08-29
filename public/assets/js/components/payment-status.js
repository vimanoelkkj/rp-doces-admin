import { paymentReference, paymentTotalCents, pixCode } from "../utils/payment-data.js";
import { shortOrderReference } from "../utils/order-reference.js";
import { formatPixExpiry } from "../utils/pix-expiry.js";
import { formatMoney } from "../utils/money.js";
import { escapeHtml } from "../utils/html.js";
export function renderPaymentStatus(order = {}) {
  if (!order || order.phase === "idle") return "";
  const loading = order.phase === "creating",
    failed = order.phase === "error",
    paid = order.phase === "paid",
    pending = order.phase === "pending",
    total = paymentTotalCents(order),
    qrCode = pixCode(order),
    reference = shortOrderReference(paymentReference(order)),
    expiresAt = formatPixExpiry(order.data?.pix_expira_em);
  return `<div class="rp-payment" data-payment-root><div class="rp-payment__backdrop"></div><section class="rp-payment__sheet" role="dialog" aria-modal="true" aria-live="polite"><div class="rp-sheet-handle" aria-hidden="true"></div>${loading ? `<p class="rp-kicker">Preparando pagamento</p><h2>Gerando seu Pix…</h2><p>Só um instante.</p>` : ""}${pending ? `<p class="rp-kicker">Pagamento Pix</p><h2>Agora é só pagar ✨</h2><p>Use o código abaixo no app do seu banco.</p>${total ? `<strong class="rp-payment__total">${formatMoney(total)}</strong>` : ""}${qrCode ? `<textarea class="rp-payment__code" readonly aria-label="Código Pix copia e cola">${escapeHtml(qrCode)}</textarea><button class="rp-btn rp-btn--primary" type="button" data-copy-pix>Copiar código Pix</button>` : ""}${expiresAt ? `<p class="rp-payment__hint">Pix válido até ${escapeHtml(expiresAt)}.</p>` : ""}<p class="rp-payment__hint">Esta tela acompanha a confirmação do pagamento automaticamente.</p>` : ""}${paid ? `<p class="rp-kicker">Pagamento confirmado</p><h2>Pedido confirmado 🎉</h2><p>Recebemos seu pagamento. Seu pedido já está confirmado.</p>${reference ? `<p class="rp-payment__hint">Referência: ${escapeHtml(reference)}</p>` : ""}<button class="rp-btn rp-btn--primary" type="button" data-finish-order>Voltar ao cardápio</button>` : ""}${failed ? `<p class="rp-kicker">Não deu certo</p><h2>Não conseguimos concluir o pagamento</h2><p>${escapeHtml(order.error || "Tente novamente em instantes.")}</p><button class="rp-btn rp-btn--primary" type="button" data-retry-payment>Tentar novamente</button><button class="rp-btn" type="button" data-close-payment>Voltar ao pedido</button>` : ""}</section></div>`;
}
