import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// PedidoPagamento é puro de props (sem hooks): renderiza o componente real via SSR.
const bundle = await build({
  entryPoints: ["src/admin/Pedidos/PedidoDetalhe/PedidoPagamento.tsx"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"]
});
const modulo = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  createRequire(import.meta.url),
  modulo,
  modulo.exports
);
const PedidoPagamento = modulo.exports.default;

const semAcao = () => {};
// Estado saudável: sem captura pendente, saldo cobrável integral, comanda ABERTA
// and one pending ADMIN Pix; regeneration remains suspended even without a capture.
const propsBase = {
  pedido: {
    id: 1,
    cliente_nome: "Balcao",
    cliente_whatsapp: "11999999999",
    observacao: "",
    valor_total_centavos: 10000,
    status_pagamento: "PENDENTE",
    status_pedido: "NOVO",
    status_comanda: "ABERTA",
    criado_em: "2026-01-01 12:00:00",
    pago_em: null,
    origem_pedido: "MANUAL",
    arquivado: 0,
    arquivado_em: null
  },
  financeiro: {
    status: "PENDENTE",
    brutoPagoCentavos: 0,
    reembolsadoCentavos: 0,
    liquidoCentavos: 0,
    saldoCentavos: 10000,
    pagoCentavos: 0,
    totalCentavos: 10000,
    excessoCentavos: 0,
    temExcesso: false,
    metodosConfirmados: []
  },
  capacidadeCobravelCentavos: 10000,
  capturaMpNaoConciliada: false,
  pixAdminPendentes: [
    {
      id: 7,
      valorCentavos: 10000,
      qrCode: "00020126580014br.gov.bcb.pix0136teste",
      qrCodeBase64: null,
      ticketUrl: null,
      expiresAt: null
    }
  ],
  operacoesInconclusivas: [],
  anulado: false,
  trocaAguardandoCobranca: false,
  registrandoPagamento: false,
  metodoPagamento: "DINHEIRO",
  valorPagamento: "100,00",
  pagamentoEmVoo: false,
  pagamentoError: null,
  pagamentoPendente: false,
  gerando: false,
  regenerandoId: null,
  pixError: null,
  pixAviso: null,
  agora: Date.parse("2026-01-01T12:00:00Z"),
  copiedId: null,
  copyError: null,
  onAbrirRegistroPagamento: semAcao,
  onMetodoPagamentoChange: semAcao,
  onValorPagamentoChange: semAcao,
  onRegistrarPagamento: semAcao,
  onCancelarRegistroPagamento: semAcao,
  onGerarPix: semAcao,
  onCopiarCodigo: semAcao,
  onAtualizarPedido: semAcao,
  onLimparPixAviso: semAcao
};
const renderizar = overrides =>
  renderToStaticMarkup(createElement(PedidoPagamento, { ...propsBase, ...overrides }));
const avisos = html => html.match(/<div[^>]*role="alert"[^>]*>.*?<\/div>/gs) ?? [];

// Backend real: a captura não conciliada também chega como PIX_MP_INTEGRIDADE.
const operacaoIntegridade = {
  tipo: "PIX_MP_INTEGRIDADE",
  diagnostico: "INTEGRIDADE_MP:APROVACAO_DIVERGENTE",
  atualizadoEm: "2026-01-01 12:05:00"
};

test("captura MP nao conciliada esconde cobranca nova e explica o bloqueio", () => {
  const html = renderizar({
    capturaMpNaoConciliada: true,
    capacidadeCobravelCentavos: 0,
    operacoesInconclusivas: [operacaoIntegridade]
  });

  // O cartão do Pix segue na tela; só as ações de cobrança somem.
  assert.match(html, /Pix pendente/);
  for (const acao of [/Registrar pagamento/, /Retomar pagamento/, /Gerar Pix/, /Regenerar Pix/]) {
    assert.doesNotMatch(html, acao);
  }
  const alertas = avisos(html);
  assert.equal(alertas.length, 1);
  assert.match(alertas[0], /bloqueadas até a conciliação/);
  assert.match(alertas[0], /<button[^>]*>Atualizar pedido<\/button>/);
});

test("captura MP nao conciliada tambem esconde retomar pagamento pendente", () => {
  const html = renderizar({
    capturaMpNaoConciliada: true,
    capacidadeCobravelCentavos: 0,
    pagamentoPendente: true
  });

  assert.doesNotMatch(html, /Retomar pagamento/);
});

test("healthy order keeps payment and Pix generation but explains the regeneration suspension", () => {
  const html = renderizar({});

  for (const acao of [/Registrar pagamento/, /Gerar Pix/, /Copiar código/, /Atualizar pedido/]) {
    assert.match(html, acao);
  }
  assert.doesNotMatch(html, /Regenerar Pix|Regenerando\.\.\./);
  assert.match(html, /role="status"/);
  assert.match(html, /Regeneração de Pix temporariamente suspensa por segurança financeira/);
  assert.match(html, /00020126580014br\.gov\.bcb\.pix0136teste/);
  assert.equal(avisos(html).length, 0);
});

test("expired Pix still offers refresh and copying without a regeneration action", () => {
  const html = renderizar({
    pixAdminPendentes: [{ ...propsBase.pixAdminPendentes[0], expiresAt: "2025-12-31T12:00:00Z" }]
  });
  assert.doesNotMatch(html, /Regenerar Pix|Regenerando\.\.\./);
  assert.match(html, /Expiração informada pelo Mercado Pago atingida/);
  assert.match(html, /Copiar código/);
  assert.equal((html.match(/>Atualizar pedido<\/button>/g) ?? []).length, 1);
});

test("captura MP nao conciliada exibe o aviso mesmo sem operacoes inconclusivas", () => {
  const html = renderizar({
    capturaMpNaoConciliada: true,
    capacidadeCobravelCentavos: 0,
    operacoesInconclusivas: []
  });

  const alertas = avisos(html);
  assert.equal(alertas.length, 1);
  assert.match(alertas[0], /bloqueadas até a conciliação/);
  assert.match(alertas[0], /<button[^>]*>Atualizar pedido<\/button>/);
});

test("a captura nao conciliada sozinha esconde a cobranca, inclusive com o formulario manual aberto", () => {
  const html = renderizar({ capturaMpNaoConciliada: true, registrandoPagamento: true });

  for (const acao of [
    /Saldo aguardando pagamento/,
    /Registrar pagamento/,
    /Confirmar pagamento/,
    /Gerar Pix/,
    /Regenerar Pix/
  ]) {
    assert.doesNotMatch(html, acao);
  }
});
