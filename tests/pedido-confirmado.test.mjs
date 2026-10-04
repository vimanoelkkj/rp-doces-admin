import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Regras puras da tela de confirmação (sem React): modelo da linha do tempo e quando a tela deixa de valer.
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `export * from './src/lib/pedidoConfirmado';`
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node"
});

const { etapasDaLinhaDoTempo, confirmacaoEncerrada } = await import(
  `data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//# sourceURL=pedido-confirmado-bundle.mjs`).toString("base64")}`
);

test("etapasDaLinhaDoTempo: pedido e pagamento sempre concluídos; preparo e retirada seguem o status", () => {
  for (const [status, estados, rotuloRetirada] of [
    ["NOVO", ["done", "done", "current", "pending"], "Pronto para retirada"],
    ["PREPARANDO", ["done", "done", "current", "pending"], "Pronto para retirada"],
    ["PRONTO", ["done", "done", "done", "current"], "Pronto para retirada"],
    ["ENTREGUE", ["done", "done", "done", "done"], "Retirado"],
    // CANCELADO não chega a esta tela (ela sai para o acompanhamento), mas o modelo não muda.
    ["CANCELADO", ["done", "done", "current", "pending"], "Pronto para retirada"]
  ]) {
    const etapas = etapasDaLinhaDoTempo(status);
    assert.deepEqual(
      etapas.map(etapa => etapa.estado),
      estados,
      status
    );
    assert.equal(etapas[3].rotulo, rotuloRetirada, status);
  }
});

test("etapasDaLinhaDoTempo: ids e rótulos fixos, na ordem da tela", () => {
  const etapas = etapasDaLinhaDoTempo("PREPARANDO");
  assert.deepEqual(
    etapas.map(etapa => etapa.id),
    ["recebido", "pagamento", "preparo", "retirada"]
  );
  assert.deepEqual(
    etapas.slice(0, 3).map(etapa => etapa.rotulo),
    ["Pedido recebido", "Pagamento confirmado", "Em preparação"]
  );
});

test("confirmacaoEncerrada: só a entrega normal (ENTREGUE e PAGO) e os pedidos ainda ativos ficam na tela", () => {
  for (const [statusPagamento, statusPedido, encerrada] of [
    ["PAGO", "NOVO", false],
    ["PAGO", "PREPARANDO", false],
    ["PAGO", "PRONTO", false],
    ["PAGO", "ENTREGUE", false],
    ["PAGO", "CANCELADO", true],
    ["REEMBOLSADO", "NOVO", true],
    ["REEMBOLSADO", "PREPARANDO", true],
    ["REEMBOLSADO", "ENTREGUE", true],
    ["REEMBOLSADO", "CANCELADO", true],
    ["CANCELADO", "NOVO", true],
    // Pix tardio ainda pode virar PAGO: EXPIRADO não encerra sozinho...
    ["EXPIRADO", "NOVO", false],
    // ...mas uma entrega sem pagamento confirmado não é "entrega normal".
    ["EXPIRADO", "ENTREGUE", true]
  ]) {
    assert.equal(
      confirmacaoEncerrada({ statusPagamento, statusPedido }),
      encerrada,
      `${statusPagamento}/${statusPedido}`
    );
  }
});
