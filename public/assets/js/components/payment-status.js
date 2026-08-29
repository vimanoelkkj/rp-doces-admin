import { paymentReference, paymentTotalCents, pixCode } from "../utils/payment-data.js";
import { shortOrderReference } from "../utils/order-reference.js";
import { formatPixExpiry } from "../utils/pix-expiry.js";
import { formatMoney } from "../utils/money.js";
import { escapeHtml } from "../utils/html.js";
const pixMarkPath = `M5.94314 20.6548C6.46415 20.6561 6.98026 20.5542 7.46165 20.3549C7.94304 20.1557 8.38016 19.863 8.74777 19.4938L12.7978 15.4438C12.941 15.3066 13.1316 15.2301 13.3299 15.2301C13.5282 15.2301 13.7188 15.3066 13.862 15.4438L17.9266 19.5084C18.2942 19.8776 18.7313 20.1704 19.2127 20.3697C19.6941 20.5689 20.2103 20.6708 20.7313 20.6694H21.53L16.4 25.7994C15.6307 26.5683 14.5875 27.0002 13.4998 27.0002C12.4121 27.0002 11.3689 26.5683 10.5995 25.7994L5.45601 20.6548H5.94314ZM20.7313 6.33012C20.2103 6.32876 19.6942 6.43066 19.2128 6.62994C18.7314 6.82921 18.2942 7.12191 17.9266 7.49113L13.862 11.5569C13.7207 11.6977 13.5294 11.7768 13.3299 11.7768C13.1304 11.7768 12.9391 11.6977 12.7978 11.5569L8.74777 7.50688C8.38026 7.13746 7.94317 6.84455 7.46178 6.64508C6.98038 6.44561 6.46422 6.34353 5.94314 6.34475H5.45489L10.5995 1.20125C11.3687 0.432099 12.412 0 13.4998 0C14.5876 0 15.6308 0.432099 16.4 1.20125L21.5289 6.33012H20.7313ZM1.20126 10.5995L4.26351 7.53612H5.94202C6.67744 7.53805 7.38244 7.82991 7.90402 8.34837L11.954 12.3984C12.3188 12.7621 12.813 12.9664 13.3282 12.9664C13.8434 12.9664 14.3376 12.7621 14.7024 12.3984L18.7681 8.33375C19.2895 7.81477 19.9945 7.52247 20.7301 7.52037H22.718L25.7971 10.5995C26.5663 11.3687 26.9984 12.412 26.9984 13.4998C26.9984 14.5875 26.5663 15.6308 25.7971 16.4L22.7191 19.478H20.7301C19.9947 19.4762 19.2897 19.1843 18.7681 18.6658L14.7035 14.6011C14.3331 14.2476 13.8408 14.0504 13.3288 14.0504C12.8168 14.0504 12.3244 14.2476 11.954 14.6011L7.90402 18.6511C7.38244 19.1696 6.67744 19.4615 5.94202 19.4634H4.26464L1.20126 16.4C0.432114 15.6308 1.52588e-05 14.5875 1.52588e-05 13.4998C1.52588e-05 12.412 0.432114 11.3687 1.20126 10.5995Z`;
const waitingPixIcon = `<svg class="rp-payment__waiting-icon" style="width:72px;height:64px" width="72" height="64" viewBox="0 0 72 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g transform="translate(7 3) scale(1.8)"><path d="${pixMarkPath}" fill="#CFA354"/></g><circle cx="52" cy="45" r="13" fill="var(--rp-color-surface)" stroke="#CFA354" stroke-width="3"/><path class="rp-payment__waiting-clock-hand" style="transform-origin:52px 45px" d="M52 37V45L58 49" stroke="#CFA354" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const failedPixIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--failure rp-payment__state-icon--card-declined" aria-hidden="true"><svg viewBox="0 0 72 64" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(7 3) scale(1.8)"><path d="${pixMarkPath}" fill="#B65252"/></g><circle class="rp-payment__declined-card-x-ring" cx="52" cy="45" r="13"/><path class="rp-payment__declined-card-x" d="M47 40L57 50M57 40L47 50"/></svg></span>`;
const waitingCardIcon = `<svg class="rp-payment__waiting-icon" style="width:72px;height:64px" width="72" height="64" viewBox="0 0 72 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="9" y="8" width="54" height="36" rx="7" fill="#fffaf7" stroke="#81685F" stroke-width="2.4"/><path d="M9 18H63" stroke="#81685F" stroke-width="2.4" stroke-linecap="round"/><path d="M18 34H30" stroke="#81685F" stroke-width="2.4" stroke-linecap="round"/><circle cx="52" cy="45" r="13" fill="var(--rp-color-surface)" stroke="#CFA354" stroke-width="3"/><path class="rp-payment__waiting-clock-hand" style="transform-origin:52px 45px" d="M52 37V45L58 49" stroke="#CFA354" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const successIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--success" aria-hidden="true">✓</span>`;
const failureIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--failure" aria-hidden="true">×</span>`;
const declinedCardIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--failure rp-payment__state-icon--card-declined" aria-hidden="true"><svg viewBox="0 0 72 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect class="rp-payment__declined-card-body" x="9" y="8" width="54" height="36" rx="7"/><path class="rp-payment__declined-card-stripe" d="M9 18H63"/><path class="rp-payment__declined-card-detail" d="M18 34H30"/><circle class="rp-payment__declined-card-x-ring" cx="52" cy="45" r="13"/><path class="rp-payment__declined-card-x" d="M47 40L57 50M57 40L47 50"/></svg></span>`;
const warningIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--warning" aria-hidden="true">!</span>`;
const cancelledIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--muted" aria-hidden="true">—</span>`;
function stateShell({ icon, kicker, title, body, content = "", state = "" }) {
  return `<div class="rp-payment__state${state ? ` rp-payment__state--${state}` : ""}">${icon}<p class="rp-kicker">${kicker}</p><h2>${title}</h2><p>${body}</p>${content}</div>`;
}
function pendingContent({ cardPending, total, qrCode, expiresAt, copied = false, exiting = false }) {
  return `<div class="rp-payment__pending${exiting ? " rp-payment__pending--exit" : ""}"><style>.rp-payment .rp-payment__copied{background:#dff3e4;color:#287a45}@keyframes rp-pix-copy-feedback{0%{opacity:0;transform:translateY(6px) scale(.985)}14%{opacity:1;transform:translateY(0) scale(1.012)}22%{opacity:1;transform:translateY(0) scale(1)}86%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(4px) scale(.99)}}@keyframes rp-payment-pending-exit{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(-5px) scale(.992)}}@media (prefers-reduced-motion:no-preference){.rp-payment .rp-payment__copied{animation:rp-pix-copy-feedback 1.8s cubic-bezier(.2,.75,.25,1) both}.rp-payment__pending--exit{animation:rp-payment-pending-exit 220ms ease both}.rp-payment__pending--exit .rp-payment__waiting-mark,.rp-payment__pending--exit .rp-payment__waiting-mark~h2,.rp-payment__pending--exit .rp-payment__waiting-mark~p,.rp-payment__pending--exit .rp-payment__waiting-mark~.rp-payment__total,.rp-payment__pending--exit .rp-payment__waiting-mark~.rp-payment__code,.rp-payment__pending--exit .rp-payment__waiting-mark~.rp-btn,.rp-payment__pending--exit .rp-payment__waiting-mark~.rp-payment__hint{animation:none!important}}</style><div class="rp-payment__waiting-mark">${cardPending ? waitingCardIcon : waitingPixIcon}</div><h2>Aguardando pagamento</h2><p>${cardPending ? "Já estamos levando a maquininha até você. Pague no débito ou crédito quando ela chegar." : "Copie o código Pix e pague no app do seu próprio banco."}</p>${!cardPending && total ? `<strong class="rp-payment__total">${formatMoney(total)}</strong>` : ""}${!cardPending && qrCode ? `<textarea class="rp-payment__code" readonly aria-label="Código Pix copia e cola">${escapeHtml(qrCode)}</textarea><button class="rp-btn rp-btn--primary" type="button" data-copy-pix>Copiar código Pix</button>${copied ? `<div class="rp-payment__copied" role="status">✓ Código Pix copiado. Agora é só colar no app do seu banco.</div>` : ""}` : ""}${!cardPending && expiresAt ? `<p class="rp-payment__hint">Pix válido até ${escapeHtml(expiresAt)}.</p>` : ""}${!cardPending ? `<p class="rp-payment__hint">Esta tela acompanha a confirmação do pagamento automaticamente.</p>${exiting ? "" : `<button class="rp-btn rp-payment__secondary" type="button" data-request-cancel-order>Desistir da compra</button>`}` : ""}</div>`;
}
export function renderPaymentStatus(order = {}) {
  if (!order || order.phase === "idle") return "";
  const loading = order.phase === "creating",
    failed = order.phase === "error",
    paid = order.phase === "paid",
    transitioningToPaid = order.phase === "confirming-paid",
    pending = order.phase === "pending" || transitioningToPaid,
    cardPending = pending && String(order.paymentMethod || "").toUpperCase() === "CARD",
    total = paymentTotalCents(order),
    qrCode = pixCode(order),
    reference = shortOrderReference(paymentReference(order)),
    expiresAt = formatPixExpiry(order.data?.pix_expira_em),
    demoState = String(order.demoState || ""),
    cancelPending = Boolean(order.cancelPending),
    cancelError = String(order.cancelError || "");
  const special = ["card-declined", "pix-error", "cancel-confirm", "cancelled"].includes(demoState);
  const isState = paid || failed || special;
  let body = "";
  if (loading)
    body = `<p class="rp-kicker">Preparando pagamento</p><h2>Gerando seu Pix…</h2><p>Só um instante.</p>`;
  else if (paid)
    body = stateShell({
      icon: successIcon,
      kicker: "Pagamento confirmado",
      title: "Pedido confirmado",
      body: "Recebemos seu pagamento. Seu pedido já está confirmado.",
      content: `${reference ? `<div class="rp-payment__reference"><span>Pedido</span><strong>${escapeHtml(reference)}</strong></div>` : ""}<button class="rp-btn rp-btn--primary" type="button" data-finish-order>Voltar ao cardápio</button>`
    });
  else if (demoState === "card-declined")
    body = stateShell({
      icon: declinedCardIcon,
      kicker: "Cartão não aprovado",
      title: "O pagamento não passou",
      body: "A maquininha não aprovou esta tentativa. Você pode escolher outra forma de pagamento.",
      content: `<button class="rp-btn rp-btn--primary" type="button" data-close-payment>Escolher outra forma</button><button class="rp-btn rp-payment__secondary" type="button" data-finish-order>Voltar ao cardápio</button>`,
      state: "card-declined"
    });
  else if (demoState === "pix-error")
    body = stateShell({
      icon: failedPixIcon,
      kicker: "Pix não confirmado",
      title: "Não recebemos a confirmação",
      body: "O Pix não foi confirmado dentro do tempo esperado. Confira no seu banco antes de tentar de novo.",
      content: `<button class="rp-btn rp-btn--primary" type="button" data-retry-payment>Tentar novamente</button><button class="rp-btn rp-payment__secondary" type="button" data-close-payment>Voltar ao pedido</button>`,
      state: "card-declined"
    });
  else if (demoState === "cancel-confirm")
    body = stateShell({
      icon: warningIcon,
      kicker: "Cancelar pedido",
      title: "Tem certeza que deseja cancelar?",
      body: "Se continuar, o Pix será cancelado e este código não poderá mais ser usado para pagar.",
      content: `${cancelError ? `<p class="rp-payment__hint" role="alert">${escapeHtml(cancelError)}</p>` : ""}<button class="rp-btn rp-btn--danger" type="button" data-confirm-cancel-order${cancelPending ? " disabled" : ""}>${cancelPending ? "Cancelando…" : "Sim, cancelar pedido"}</button><button class="rp-btn rp-payment__secondary" type="button" data-keep-order${cancelPending ? " disabled" : ""}>Não, continuar pedido</button>`,
      state: "cancel-confirm"
    });
  else if (demoState === "cancelled")
    body = stateShell({
      icon: cancelledIcon,
      kicker: "Pedido cancelado",
      title: "Seu pedido foi cancelado",
      body: "O Pix foi invalidado e este código não pode mais ser usado para pagar.",
      content: `<button class="rp-btn rp-btn--primary" type="button" data-finish-order>Voltar ao cardápio</button>`
    });
  else if (pending)
    body = pendingContent({
      cardPending,
      total,
      qrCode,
      expiresAt,
      copied: demoState === "pix-copied",
      exiting: transitioningToPaid
    });
  else if (failed)
    body = stateShell({
      icon: failureIcon,
      kicker: "Pagamento não confirmado",
      title: "Não conseguimos concluir",
      body: escapeHtml(
        order.error || "O pagamento não foi confirmado. Você pode tentar novamente."
      ),
      content: `<button class="rp-btn rp-btn--primary" type="button" data-retry-payment>Tentar novamente</button><button class="rp-btn rp-payment__secondary" type="button" data-close-payment>Voltar ao pedido</button>`
    });
  return `<div class="rp-payment" data-payment-root><div class="rp-payment__backdrop"></div><section class="rp-payment__sheet${isState ? " rp-payment__sheet--state" : ""}" role="dialog" aria-modal="true" aria-live="polite"><div class="rp-sheet-handle" aria-hidden="true"></div>${body}</section></div>`;
}
