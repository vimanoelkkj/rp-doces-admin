import { paymentReference, paymentTotalCents, pixCode } from "../utils/payment-data.js";
import { shortOrderReference } from "../utils/order-reference.js";
import { formatPixExpiry } from "../utils/pix-expiry.js";
import { formatMoney } from "../utils/money.js";
import { escapeHtml } from "../utils/html.js";
const waitingPixIcon = `<svg class="rp-payment__waiting-icon" width="34" height="30" viewBox="0 0 34 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5.94314 20.6548C6.46415 20.6561 6.98026 20.5542 7.46165 20.3549C7.94304 20.1557 8.38016 19.863 8.74777 19.4938L12.7978 15.4438C12.941 15.3066 13.1316 15.2301 13.3299 15.2301C13.5282 15.2301 13.7188 15.3066 13.862 15.4438L17.9266 19.5084C18.2942 19.8776 18.7313 20.1704 19.2127 20.3697C19.6941 20.5689 20.2103 20.6708 20.7313 20.6694H21.53L16.4 25.7994C15.6307 26.5683 14.5875 27.0002 13.4998 27.0002C12.4121 27.0002 11.3689 26.5683 10.5995 25.7994L5.45601 20.6548H5.94314ZM20.7313 6.33012C20.2103 6.32876 19.6942 6.43066 19.2128 6.62994C18.7314 6.82921 18.2942 7.12191 17.9266 7.49113L13.862 11.5569C13.7207 11.6977 13.5294 11.7768 13.3299 11.7768C13.1304 11.7768 12.9391 11.6977 12.7978 11.5569L8.74777 7.50688C8.38026 7.13746 7.94317 6.84455 7.46178 6.64508C6.98038 6.44561 6.46422 6.34353 5.94314 6.34475H5.45489L10.5995 1.20125C11.3687 0.432099 12.412 0 13.4998 0C14.5876 0 15.6308 0.432099 16.4 1.20125L21.5289 6.33012H20.7313ZM1.20126 10.5995L4.26351 7.53612H5.94202C6.67744 7.53805 7.38244 7.82991 7.90402 8.34837L11.954 12.3984C12.3188 12.7621 12.813 12.9664 13.3282 12.9664C13.8434 12.9664 14.3376 12.7621 14.7024 12.3984L18.7681 8.33375C19.2895 7.81477 19.9945 7.52247 20.7301 7.52037H22.718L25.7971 10.5995C26.5663 11.3687 26.9984 12.412 26.9984 13.4998C26.9984 14.5875 26.5663 15.6308 25.7971 16.4L22.7191 19.478H20.7301C19.9947 19.4762 19.2897 19.1843 18.7681 18.6658L14.7035 14.6011C14.3331 14.2476 13.8408 14.0504 13.3288 14.0504C12.8168 14.0504 12.3244 14.2476 11.954 14.6011L7.90402 18.6511C7.38244 19.1696 6.67744 19.4615 5.94202 19.4634H4.26464L1.20126 16.4C0.432114 15.6308 1.52588e-05 14.5875 1.52588e-05 13.4998C1.52588e-05 12.412 0.432114 11.3687 1.20126 10.5995Z" fill="#CFA354"/><path d="M28.2995 29.1C30.9504 29.1 33.0995 26.951 33.0995 24.3C33.0995 21.649 30.9504 19.5 28.2995 19.5C25.6485 19.5 23.4995 21.649 23.4995 24.3C23.4995 26.951 25.6485 29.1 28.2995 29.1Z" stroke="#CFA354" stroke-width="1.4"/><path class="rp-payment__waiting-clock-hand rp-payment__waiting-clock-hand--pix" d="M28.4995 20.5V24.7H31.2995" stroke="#CFA354" stroke-width="1.4"/></svg>`;
const waitingCardIcon = `<svg class="rp-payment__waiting-icon" width="33" height="29" viewBox="0 0 33 29" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="0.5" y="0.5" width="27" height="19" rx="4.5" stroke="#81685F"/><rect x="1" y="6" width="26" height="3" fill="#81685F"/><path d="M26.8 27.6C29.451 27.6 31.6 25.451 31.6 22.8C31.6 20.149 29.451 18 26.8 18C24.149 18 22 20.149 22 22.8C22 25.451 24.149 27.6 26.8 27.6Z" stroke="#CFA354" stroke-width="1.4"/><path class="rp-payment__waiting-clock-hand rp-payment__waiting-clock-hand--card" d="M27 19V23.2H29.8" stroke="#CFA354" stroke-width="1.4"/></svg>`;
const successIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--success" aria-hidden="true">✓</span>`;
const failureIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--failure" aria-hidden="true">×</span>`;
const declinedCardIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--failure rp-payment__state-icon--card-declined" aria-hidden="true"><svg viewBox="0 0 72 64" fill="none" xmlns="http://www.w3.org/2000/svg"><rect class="rp-payment__declined-card-body" x="9" y="8" width="54" height="36" rx="7"/><path class="rp-payment__declined-card-stripe" d="M9 18H63"/><path class="rp-payment__declined-card-detail" d="M18 34H30"/><circle class="rp-payment__declined-card-x-ring" cx="52" cy="45" r="13"/><path class="rp-payment__declined-card-x" d="M47 40L57 50M57 40L47 50"/></svg></span>`;
const cancelledIcon = `<span class="rp-payment__state-icon rp-payment__state-icon--muted" aria-hidden="true">—</span>`;
function stateShell({ icon, kicker, title, body, content = "", state = "" }) {
  return `<div class="rp-payment__state${state ? ` rp-payment__state--${state}` : ""}">${icon}<p class="rp-kicker">${kicker}</p><h2>${title}</h2><p>${body}</p>${content}</div>`;
}
function pendingContent({ cardPending, total, qrCode, expiresAt, copied = false }) {
  return `<div class="rp-payment__waiting-mark">${cardPending ? waitingCardIcon : waitingPixIcon}</div><h2>Aguardando pagamento</h2><p>${cardPending ? "Já estamos levando a maquininha até você. Pague no débito ou crédito quando ela chegar." : "Copie o código Pix e pague no app do seu próprio banco."}</p>${!cardPending && total ? `<strong class="rp-payment__total">${formatMoney(total)}</strong>` : ""}${!cardPending && qrCode ? `<textarea class="rp-payment__code" readonly aria-label="Código Pix copia e cola">${escapeHtml(qrCode)}</textarea><button class="rp-btn rp-btn--primary" type="button" data-copy-pix>${copied ? "Código copiado ✓" : "Copiar código Pix"}</button>${copied ? `<div class="rp-payment__copied" role="status">Código Pix copiado. Agora é só colar no app do seu banco.</div>` : ""}` : ""}${!cardPending && expiresAt ? `<p class="rp-payment__hint">Pix válido até ${escapeHtml(expiresAt)}.</p>` : ""}${!cardPending ? `<p class="rp-payment__hint">Esta tela acompanha a confirmação do pagamento automaticamente.</p>` : ""}`;
}
export function renderPaymentStatus(order = {}) {
  if (!order || order.phase === "idle") return "";
  const loading = order.phase === "creating",
    failed = order.phase === "error",
    paid = order.phase === "paid",
    pending = order.phase === "pending",
    cardPending = pending && String(order.paymentMethod || "").toUpperCase() === "CARD",
    total = paymentTotalCents(order),
    qrCode = pixCode(order),
    reference = shortOrderReference(paymentReference(order)),
    expiresAt = formatPixExpiry(order.data?.pix_expira_em),
    demoState = String(order.demoState || "");
  const special = ["card-declined", "pix-error", "cancel-confirm", "cancelled"].includes(demoState);
  const isState = paid || failed || special;
  let body = "";
  if (loading)
    body = `<p class="rp-kicker">Preparando pagamento</p><h2>Gerando seu Pix…</h2><p>Só um instante.</p>`;
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
      icon: failureIcon,
      kicker: "Pix não confirmado",
      title: "Não recebemos a confirmação",
      body: "O Pix não foi confirmado dentro do tempo esperado. Confira no seu banco antes de tentar de novo.",
      content: `<button class="rp-btn rp-btn--primary" type="button" data-retry-payment>Tentar novamente</button><button class="rp-btn rp-payment__secondary" type="button" data-close-payment>Voltar ao pedido</button>`
    });
  else if (demoState === "cancel-confirm")
    body = stateShell({
      icon: cancelledIcon,
      kicker: "Cancelar pedido",
      title: "Tem certeza que deseja cancelar?",
      body: "Se continuar, este pedido será encerrado e você precisará montar outro para pedir novamente.",
      content: `<button class="rp-btn rp-btn--danger" type="button" data-confirm-demo-cancel>Sim, cancelar pedido</button><button class="rp-btn rp-payment__secondary" type="button" data-keep-demo-order>Não, continuar pedido</button>`
    });
  else if (demoState === "cancelled")
    body = stateShell({
      icon: cancelledIcon,
      kicker: "Pedido cancelado",
      title: "Seu pedido foi cancelado",
      body: "Tudo certo. Nenhuma nova tentativa de pagamento será feita por esta tela.",
      content: `<button class="rp-btn rp-btn--primary" type="button" data-finish-order>Voltar ao cardápio</button>`
    });
  else if (pending)
    body = pendingContent({
      cardPending,
      total,
      qrCode,
      expiresAt,
      copied: demoState === "pix-copied"
    });
  else if (paid)
    body = stateShell({
      icon: successIcon,
      kicker: "Pagamento confirmado",
      title: "Pedido confirmado",
      body: "Recebemos seu pagamento. Seu pedido já está confirmado.",
      content: `${reference ? `<div class="rp-payment__reference"><span>Pedido</span><strong>${escapeHtml(reference)}</strong></div>` : ""}<button class="rp-btn rp-btn--primary" type="button" data-finish-order>Voltar ao cardápio</button>`
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
