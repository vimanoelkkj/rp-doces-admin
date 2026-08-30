import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { renderPaymentStatus } from "../public/assets/js/components/payment-status.js";
import { formatPixExpiry } from "../public/assets/js/utils/pix-expiry.js";
import { pixCode, pixQrImageSrc } from "../public/assets/js/utils/payment-data.js";
import {
  normalizeOrderStatus,
  isPaidStatus,
  isFailedStatus
} from "../public/assets/js/utils/payment-status.js";

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.resolve(root, relativePath), "utf8");

function pendingOrder(overrides = {}) {
  const dataOverrides = overrides.data || {};
  const pixOverrides = overrides.pix || {};
  const hasPixOverride = Object.prototype.hasOwnProperty.call(overrides, "pix");

  return {
    phase: "pending",
    paymentMethod: "PIX",
    token: "pedido-token",
    data: {
      token: "pedido-token",
      status: "PENDENTE",
      valor_total_centavos: 2500,
      pix_expira_em: "2026-08-30T04:00:00.000Z",
      ...dataOverrides
    },
    pix: hasPixOverride
      ? overrides.pix
      : {
          qr_code: "000201PIX-COPIA-E-COLA",
          qr_code_base64: "data:image/png;base64,QUJD",
          ...pixOverrides
        },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => !["data", "pix"].includes(key))
    )
  };
}

test("storefront produtivo carrega a pilha modular de pagamento", () => {
  const html = read("public/index.html");

  assert.match(html, /<meta name="rp-payment-mode" content="enabled" \/>/);
  assert.match(html, /\/assets\/css\/payment\.css/);
  assert.match(html, /\/assets\/css\/payment-qr\.css/);
  assert.match(html, /\/assets\/js\/app\.js/);
  assert.match(html, /\/assets\/js\/pending-order-recovery\.js/);
  assert.doesNotMatch(html, /id="rp-pix-flow"/);
  assert.doesNotMatch(html, /assets\/css\/site\.css/);
});

test("estrutura modular mantém somente os containers de aplicação no HTML", () => {
  const html = read("public/index.html");
  const paymentCss = read("public/assets/css/payment.css");

  assert.match(html, /<main id="rp-app" class="rp-shell"/);
  assert.doesNotMatch(html, /class="pix-modal pix-sheet"/);
  assert.match(paymentCss, /\.rp-payment/);
});

test("Pix pendente renderiza valor, código copia e cola e acompanhamento automático", () => {
  const html = renderPaymentStatus(pendingOrder());

  assert.match(html, /Aguardando pagamento/);
  assert.match(html, /R\$\s*25,00/);
  assert.match(html, /000201PIX-COPIA-E-COLA/);
  assert.match(html, /data-copy-pix/);
  assert.match(html, /acompanha a confirmação do pagamento automaticamente/i);
});

test("QR Code Pix aparece sempre no desktop e opcionalmente no mobile", () => {
  const html = renderPaymentStatus(pendingOrder());

  assert.match(html, /class="rp-payment__qr-desktop"/);
  assert.match(html, /class="rp-payment__qr-mobile"/);
  assert.match(html, /<summary>Mostrar QR Code<\/summary>/);
  assert.match(html, /data:image\/png;base64,QUJD/);
});

test("Pix sem QR de imagem preserva copia e cola sem renderizar frame vazio", () => {
  const order = pendingOrder({
    pix: {
      qr_code: "000201PIX-COPIA-E-COLA",
      qr_code_base64: null
    }
  });
  const html = renderPaymentStatus(order);

  assert.doesNotMatch(html, /class="rp-payment__qr-desktop"/);
  assert.match(html, /000201PIX-COPIA-E-COLA/);
  assert.match(html, /data-copy-pix/);
});

test("Pix sem expiração não inventa validade visual", () => {
  const order = pendingOrder({ data: { pix_expira_em: null } });
  const html = renderPaymentStatus(order);

  assert.doesNotMatch(html, /Pix válido até/);
  assert.match(html, /Aguardando pagamento/);
});

test("timestamp Pix inválido é ocultado com segurança", () => {
  assert.equal(formatPixExpiry("nao-e-data"), "");

  const html = renderPaymentStatus(pendingOrder({ data: { pix_expira_em: "nao-e-data" } }));
  assert.doesNotMatch(html, /Pix válido até/);
});

test("timestamp Pix válido é formatado para apresentação", () => {
  const formatted = formatPixExpiry("2026-08-30T04:00:00.000Z");
  assert.equal(typeof formatted, "string");
  assert.ok(formatted.length > 0);
});

test("helper de dados aceita QR base64 cru e data URL", () => {
  assert.equal(
    pixQrImageSrc({ pix: { qr_code_base64: "QUJD" } }),
    "data:image/png;base64,QUJD"
  );
  assert.equal(
    pixQrImageSrc({ pix: { qr_code_base64: "data:image/png;base64,REVG" } }),
    "data:image/png;base64,REVG"
  );
});

test("helper de dados rejeita QR em formato incompatível", () => {
  assert.equal(
    pixQrImageSrc({ pix: { qr_code_base64: "data:image/jpeg;base64,QUJD" } }),
    ""
  );
  assert.equal(pixQrImageSrc({ pix: { qr_code_base64: "" } }), "");
});

test("helper de dados expõe o Pix copia e cola do pedido", () => {
  assert.equal(pixCode(pendingOrder()), "000201PIX-COPIA-E-COLA");
});

test("feedback de cópia aparece sem remover o código Pix", () => {
  const html = renderPaymentStatus(pendingOrder({ demoState: "pix-copied" }));

  assert.match(html, /Código Pix copiado/);
  assert.match(html, /data-copy-pix/);
  assert.match(html, /000201PIX-COPIA-E-COLA/);
});

test("cancelamento pendente bloqueia as ações da confirmação", () => {
  const html = renderPaymentStatus(
    pendingOrder({ demoState: "cancel-confirm", cancelPending: true })
  );

  assert.match(html, /Cancelando…/);
  assert.match(html, /data-confirm-cancel-order disabled aria-busy="true"/);
  assert.match(html, /data-keep-order disabled/);
  assert.doesNotMatch(html, />Desistir da compra<\/button>/);
});

test("PENDENTE continua sendo estado não terminal", () => {
  const status = normalizeOrderStatus("pendente");
  assert.equal(status, "PENDENTE");
  assert.equal(isPaidStatus(status), false);
  assert.equal(isFailedStatus(status), false);
});

test("PAGO é reconhecido como terminal aprovado", () => {
  assert.equal(isPaidStatus("pago"), true);
  assert.equal(isFailedStatus("PAGO"), false);
});

test("estados terminais de falha são reconhecidos sem confundir PAGO", () => {
  for (const status of ["CANCELADO", "REJEITADO", "EXPIRADO", "ERRO", "REEMBOLSADO"]) {
    assert.equal(isFailedStatus(status), true, status);
  }
  assert.equal(isFailedStatus("PAGO"), false);
});

test("estado confirming-paid mantém visual pendente durante a transição", () => {
  const html = renderPaymentStatus(pendingOrder({ phase: "confirming-paid" }));

  assert.match(html, /Aguardando pagamento/);
  assert.match(html, /rp-payment__pending--exit/);
  assert.doesNotMatch(html, /Pedido confirmado/);
});

test("estado PAGO renderiza confirmação e ação de retorno ao cardápio", () => {
  const html = renderPaymentStatus(
    pendingOrder({
      phase: "paid",
      data: {
        status: "PAGO",
        token: "45409627-7b60-440c-8fb3-5cc71e72ae1c",
        valor_total_centavos: 2500
      }
    })
  );

  assert.match(html, /Pagamento confirmado/);
  assert.match(html, /Pedido confirmado/);
  assert.match(html, /data-finish-order/);
  assert.match(html, /Voltar ao cardápio/);
  assert.doesNotMatch(html, /data-copy-pix/);
});

test("estado de erro não mantém controles de Pix pendente", () => {
  const html = renderPaymentStatus(
    pendingOrder({ phase: "error", error: "Pagamento expirado.", data: { status: "EXPIRADO" } })
  );

  assert.doesNotMatch(html, /data-copy-pix/);
  assert.doesNotMatch(html, />Desistir da compra<\/button>/);
});

test("payment-controller usa geração de polling para impedir respostas obsoletas", () => {
  const source = read("public/assets/js/payment-controller.js");

  assert.match(source, /let pollingRun = 0;/);
  assert.match(source, /const active = \(\) => run === pollingRun;/);
  assert.match(source, /if \(!active\(\)\) return;/);
  assert.match(source, /stopOrderPolling\(\);/);
});

test("payment-controller não consulta pedidos demo", () => {
  const source = read("public/assets/js/payment-controller.js");
  assert.match(source, /startsWith\("demo-"\)/);
});

test("payment-controller respeita visibilidade da página antes de consultar", () => {
  const source = read("public/assets/js/payment-controller.js");

  assert.match(source, /if \(!pageVisible\(\)\)/);
  assert.match(source, /schedule\(\);/);
});

test("payment-controller passa por confirming-paid antes de PAGO", () => {
  const source = read("public/assets/js/payment-controller.js");

  assert.match(source, /phase: "confirming-paid"/);
  assert.match(source, /phase: "paid"/);
  assert.match(source, /ORDER_PAID_TRANSITION_MS = 220/);
});

test("payment-controller interrompe polling em status terminal de falha", () => {
  const source = read("public/assets/js/payment-controller.js");

  assert.match(source, /if \(isFailedStatus\(status\)\)/);
  assert.match(source, /phase: "error"/);
  assert.match(source, /stopOrderPolling\(\);/);
});

test("payment-controller tolera falha transitória enquanto ainda há tentativas", () => {
  const source = read("public/assets/js/payment-controller.js");

  assert.match(source, /catch \{/);
  assert.match(source, /pollingExhausted\(attempts\)/);
  assert.match(source, /if \(active\(\) && attempts < ORDER_POLL_MAX_ATTEMPTS\) schedule\(\);/);
});

test("recovery de pedido pendente está ativo somente para pagamentos reais", () => {
  const source = read("public/assets/js/pending-order-recovery.js");

  assert.match(source, /paymentSimulationEnabled\(\)/);
  assert.match(source, /return;/);
  assert.match(source, /rp_pending_order_token/);
});

test("recovery busca o pedido canônico e reinicia polling", () => {
  const source = read("public/assets/js/pending-order-recovery.js");

  assert.match(source, /api\.getOrder\(/);
  assert.match(source, /startOrderPolling\(/);
  assert.match(source, /phase: "pending"/);
});

test("recovery limpa identidade de checkout ao encontrar pedido terminal", () => {
  const source = read("public/assets/js/pending-order-recovery.js");

  assert.match(source, /clearTerminalOrderIdentity/);
  assert.match(source, /resetCheckoutRequestId\(\)/);
});

test("checkout-service mantém identidade idempotente por tentativa", () => {
  const source = read("public/assets/js/checkout-service.js");

  assert.match(source, /client_request_id/);
  assert.match(source, /REQUEST_KEY = "rp_checkout_request_id"/);
  assert.match(source, /CART_KEY = "rp_checkout_cart_signature"/);
  assert.match(source, /newIdempotencyId\(\)/);
});

test("checkout-service expõe limpeza explícita da identidade da tentativa", () => {
  const source = read("public/assets/js/checkout-service.js");

  assert.match(source, /export function resetCheckoutRequestId\(\)/);
  assert.match(source, /sessionRemove\(REQUEST_KEY\)/);
  assert.match(source, /sessionRemove\(CART_KEY\)/);
});

test("storefront produtivo não habilita o atraso artificial de cancelamento do preview", () => {
  const html = read("public/index.html");
  assert.doesNotMatch(html, /preview-cancel-delay\.js/);
});

test("storefront produtivo não carrega debug de transição do preview", () => {
  const html = read("public/index.html");
  assert.doesNotMatch(html, /preview-transition-debug\.js/);
});

test("storefront produtivo mantém recovery, rota, menu desktop e limpeza do carrinho", () => {
  const html = read("public/index.html");

  for (const script of [
    "storefront-route-runtime.js",
    "pending-order-recovery.js",
    "desktop-menu-runtime.js",
    "persisted-cart-finish.js"
  ]) {
    assert.match(html, new RegExp(script.replace(".", "\\.")), script);
  }
});
