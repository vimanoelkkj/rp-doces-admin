const money = cents =>
  (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderPaymentStatus(order = {}) {
  if (!order || order.phase === "idle") return "";

  const loading = order.phase === "creating";
  const failed = order.phase === "error";
  const paid = order.phase === "paid";
  const pending = order.phase === "pending";
  const total = order.data?.valor_total_centavos;
  const qrCode = order.pix?.qr_code;
  const reference = order.data?.referencia || order.token;

  return `
    <div class="rp-payment" data-payment-root>
      <div class="rp-payment__backdrop"></div>
      <section class="rp-payment__sheet" role="dialog" aria-modal="true" aria-live="polite">
        <div class="rp-sheet-handle" aria-hidden="true"></div>
        ${loading ? `<p class="rp-kicker">Preparando pagamento</p><h2>Gerando seu Pix…</h2><p>Só um instante.</p>` : ""}
        ${pending ? `<p class="rp-kicker">Pagamento Pix</p><h2>Agora é só pagar ✨</h2><p>Use o código abaixo no app do seu banco.</p>${total ? `<strong class="rp-payment__total">${money(total)}</strong>` : ""}${qrCode ? `<textarea class="rp-payment__code" readonly>${esc(qrCode)}</textarea><button class="rp-btn rp-btn--primary" type="button" data-copy-pix>Copiar código Pix</button>` : ""}<p class="rp-payment__hint">Esta tela acompanha a confirmação do pagamento automaticamente.</p>` : ""}
        ${paid ? `<p class="rp-kicker">Pagamento confirmado</p><h2>Pedido confirmado 🎉</h2><p>Recebemos seu pagamento. Seu pedido já está confirmado.</p>${reference ? `<p class="rp-payment__hint">Referência: ${esc(reference)}</p>` : ""}<button class="rp-btn rp-btn--primary" type="button" data-finish-order>Voltar ao cardápio</button>` : ""}
        ${failed ? `<p class="rp-kicker">Não deu certo</p><h2>Não conseguimos iniciar o pagamento</h2><p>${esc(order.error || "Tente novamente em instantes.")}</p><button class="rp-btn rp-btn--primary" type="button" data-retry-payment>Tentar novamente</button><button class="rp-btn" type="button" data-close-payment>Voltar ao pedido</button>` : ""}
      </section>
    </div>
  `;
}
