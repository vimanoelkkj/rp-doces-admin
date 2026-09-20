import { useCallback, useEffect, useRef, useState } from "react";
import { novaOperationKey } from "../../lib/operationKey";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import "./PedidoDetalheModal.css";
import { formatarFinanceiro, type FinanceiroPedido } from "./formatarFinanceiro";
import AdicionarItemModal from "./AdicionarItemModal";
import CancelamentoItemPreviewModal from "./CancelamentoItemPreviewModal";
import TrocarItemModal from "./TrocarItemModal";
import HistoricoComandaModal from "./HistoricoComandaModal";

/* ── Types (espelham o retorno de GET /api/admin/pedidos/:id) ── */
interface PedidoItemRow {
  id: number;
  produto_id: number | null;
  produto_nome: string;
  emoji: string | null;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
  status_item: string;
  estoque_estado: string;
  cancelamento_id: number | null;
  cancelamento_status: string | null;
  troca_id: number | null;
  troca_status: string | null;
  troca_item_origem_id: number | null;
}

type StatusPedido = "NOVO" | "PREPARANDO" | "PRONTO" | "ENTREGUE" | "CANCELADO";

interface PedidoRow {
  id: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  observacao: string;
  valor_total_centavos: number;
  status_pagamento: string;
  status_pedido: StatusPedido;
  status_comanda: string;
  criado_em: string;
  pago_em: string | null;
  origem_pedido: "SITE" | "MANUAL";
}

interface PixAdminPendente {
  id: number;
  valorCentavos: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}

interface PedidoDetalheResponse {
  pedido: PedidoRow;
  itens: PedidoItemRow[];
  financeiro: FinanceiroPedido;
  pixAdminPendentes: PixAdminPendente[];
  capacidadeCobravelCentavos: number;
  /** B-3: cobranças sem confirmação do Mercado Pago (leitura, nunca decisão). */
  operacoesInconclusivas: {
    tipo: string;
    diagnostico: string | null;
    atualizadoEm: string;
  }[];
}

interface PedidoDetalheModalProps {
  orderId: number;
  onClose: () => void;
  onStatusChanged?: () => void;
}

/* ── Helpers ── */
const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const formatarData = (isoLike: string) => {
  // SQLite CURRENT_TIMESTAMP é UTC e chega como "YYYY-MM-DD HH:mm:ss".
  // Sem o sufixo Z, o navegador interpretava esse valor como horário LOCAL,
  // exibindo o pedido com deslocamento de fuso (ex.: +3h no UTC-3).
  const iso = isoLike.replace(" ", "T");
  const comFuso = /(?:Z|[+-]\\d{2}:?\\d{2})$/i.test(iso) ? iso : `${iso}Z`;

  return new Date(comFuso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Mesmo enum de produção (order.model.ts / OrderStatusSelect.tsx) — o admin
// pode escolher qualquer status livremente, sem avanço linear forçado.
const STATUS_PEDIDO_OPCOES: StatusPedido[] = [
  "NOVO",
  "PREPARANDO",
  "PRONTO",
  "ENTREGUE",
  "CANCELADO",
];

const STATUS_LABEL: Record<StatusPedido, string> = {
  NOVO: "Novo",
  PREPARANDO: "Em produção",
  PRONTO: "Pronto",
  ENTREGUE: "Entregue",
  CANCELADO: "Cancelado",
};

const STATUS_TYPE: Record<StatusPedido, "green" | "orange" | "blue" | "red"> = {
  NOVO: "orange",
  PREPARANDO: "orange",
  PRONTO: "blue",
  ENTREGUE: "green",
  CANCELADO: "red",
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  ATIVO: "Ativo", CANCELADO: "Cancelado",
  TROCA_PENDENTE: "Destino da troca · aguardando conclusão",
};
const STOCK_STATUS_LABEL: Record<string, string> = {
  RESERVADO: "Estoque reservado", BAIXADO: "Estoque baixado",
  LIBERADO: "Reserva liberada", REPOSTO: "Estoque reposto",
};
const FLOW_STATUS_LABEL: Record<string, string> = {
  AGUARDANDO_REEMBOLSO: "Aguardando devolução", INCONCLUSIVO: "Estorno inconclusivo",
  INCONCLUSIVA: "Troca inconclusiva", AGUARDANDO_COBRANCA: "Troca aguardando pagamento",
  CONCLUIDO: "Cancelamento concluído", CONCLUIDA: "Troca concluída",
};

/* ── Component ── */
export default function PedidoDetalheModal({
  orderId,
  onClose,
  onStatusChanged,
}: PedidoDetalheModalProps) {
  const modalProps = useAdminModal(true, onClose);
  const [data, setData] = useState<PedidoDetalheResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alterando, setAlterando] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  // Pix administrativo: `gerando` cobre a ação sem substituto; `regenerandoId`
  // guarda qual bloco específico está em voo (desabilita só aquele botão).
  // `pixAviso` é o caminho AMBÍGUO (MERCADO_PAGO_INDISPONIVEL) — nunca junta
  // com `pixError` genérico, porque a ação certa é diferente: nunca convidar
  // a tentar de novo direto, só "atualizar e conferir o que persistiu".
  const [gerando, setGerando] = useState(false);
  const [regenerandoId, setRegenerandoId] = useState<number | null>(null);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixAviso, setPixAviso] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [adicionandoItem, setAdicionandoItem] = useState(false);
  const [itemCancelamentoPreviewId, setItemCancelamentoPreviewId] = useState<number | null>(null);
  const [itemTroca, setItemTroca] = useState<PedidoItemRow | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const dataRef = useRef<PedidoDetalheResponse | null>(null);
  const pixEmVooRef = useRef<Set<string>>(new Set());
  const onStatusChangedRef = useRef(onStatusChanged);

  useEffect(() => {
    onStatusChangedRef.current = onStatusChanged;
  }, [onStatusChanged]);

  // A1: uma key por INTENÇÃO de cobrança. A identidade da ação já distingue
  // "gerar Pix novo" de "regenerar o Pix X", então o mapa é indexado por
  // ela. A key sobrevive a um retry da mesma ação (resposta perdida, erro de
  // rede) e é descartada quando a ação se resolve — assim uma regeneração
  // NOVA, iniciada explicitamente pelo operador depois, recebe key nova.
  // No caminho AMBÍGUO a key é preservada de propósito: repetir a ação nunca
  // pode nascer como uma segunda cobrança com outra identidade no MP.
  const pixKeysRef = useRef<Map<string, string>>(new Map());

  const carregarPedido = useCallback((silencioso = false) => {
    if (!silencioso) setLoading(true);
    return fetch(`/api/admin/pedidos/${orderId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar pedido");
        return response.json() as Promise<PedidoDetalheResponse>;
      })
      .then((result) => {
        const anterior = dataRef.current;
        const financeiroMudou = Boolean(
          anterior &&
            (anterior.financeiro.status !== result.financeiro.status ||
              anterior.financeiro.pagoCentavos !== result.financeiro.pagoCentavos ||
              anterior.financeiro.totalCentavos !== result.financeiro.totalCentavos),
        );
        dataRef.current = result;
        setData(result);
        setError(null);
        if (silencioso && financeiroMudou) onStatusChangedRef.current?.();
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!silencioso) setLoading(false);
      });
  }, [orderId]);

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    setAdicionandoItem(false);
    pixKeysRef.current.clear();
    void carregarPedido();
  }, [carregarPedido]);

  // Contador de expiração dos Pix pendentes — só liga o relógio quando há
  // algo pra contar. Nunca decide sozinho que um Pix expirou: só o
  // backend/reconciliação tem autoridade pra transicionar PENDENTE ->
  // EXPIRADO (paymentSync.ts); aqui é só exibição de "tempo informado pelo
  // MP já passou", não uma mudança de estado local.
  useEffect(() => {
    if (!data || data.pixAdminPendentes.length === 0) return;
    const interval = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [data]);

  // O webhook segue sendo a autoridade da confirmação. Enquanto existir
  // uma cobrança pendente, uma releitura espaçada traz a convergência para a
  // tela sem exigir refresh manual nem manter polling quando não há trabalho.
  useEffect(() => {
    if (!data || data.pixAdminPendentes.length === 0) return;
    const interval = setInterval(() => void carregarPedido(true), 5000);
    return () => clearInterval(interval);
  }, [carregarPedido, data]);

  const gerarPix = (substituiId?: number, valorCentavos?: number) => {
    setPixError(null);
    setPixAviso(null);
    if (substituiId) setRegenerandoId(substituiId);
    else setGerando(true);

    const acao = substituiId ? `regen:${substituiId}` : "novo";
    if (pixEmVooRef.current.has(acao)) return;
    pixEmVooRef.current.add(acao);
    let operationKey = pixKeysRef.current.get(acao);
    if (!operationKey) {
      operationKey = novaOperationKey();
      pixKeysRef.current.set(acao, operationKey);
    }

    fetch(`/api/admin/pedidos/${orderId}/pix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        substituiId
          ? { substituiId, operationKey }
          : { operationKey, valorCentavos },
      ),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          // Erro ambíguo ou operação ainda em processamento (código, não
          // texto — nunca inferir pela mensagem): nunca sabemos se o MP criou
          // a cobrança mesmo assim. Não convida a tentar de novo, só a
          // atualizar e conferir o que persistiu (a próxima carga do GET
          // reflete a verdade do ledger). A key é PRESERVADA: se a ação for
          // repetida, ela recupera a MESMA operação em vez de abrir outra.
          if (
            body.code === "MERCADO_PAGO_INDISPONIVEL" ||
            body.code === "OPERACAO_EM_PROCESSAMENTO"
          ) {
            setPixAviso(body.error ?? "Não foi possível confirmar a criação do Pix.");
            return;
          }
          // Qualquer outro erro é conclusivo para esta intenção: descarta a
          // key para que uma nova tentativa do operador seja tratada como a
          // intenção nova que ela é.
          pixKeysRef.current.delete(acao);
          throw new Error(body.error ?? "Falha ao gerar Pix");
        }
        pixKeysRef.current.delete(acao);
        return carregarPedido(true);
      })
      .catch((err) => setPixError(err.message))
      .finally(() => {
        pixEmVooRef.current.delete(acao);
        setGerando(false);
        setRegenerandoId(null);
      });
  };

  const copiarCodigo = (pixId: number, codigo: string) => {
    navigator.clipboard.writeText(codigo);
    setCopiedId(pixId);
    setTimeout(() => setCopiedId((atual) => (atual === pixId ? null : atual)), 2000);
  };

  useEffect(() => {
    if (!statusMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        statusMenuRef.current &&
        !statusMenuRef.current.contains(e.target as Node)
      ) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [statusMenuOpen]);

  const alterarStatus = (novoStatus: StatusPedido) => {
    setStatusMenuOpen(false);
    if (!data || novoStatus === data.pedido.status_pedido) return;

    setAlterando(true);
    setStatusError(null);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusPedido: novoStatus }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao alterar status");
        }
        setData((prev) =>
          prev
            ? { ...prev, pedido: { ...prev.pedido, status_pedido: novoStatus } }
            : prev,
        );
        onStatusChanged?.();
      })
      .catch((err) => setStatusError(err.message))
      .finally(() => setAlterando(false));
  };

  const financeiro = data ? formatarFinanceiro(data.financeiro) : null;
  const trocaAguardandoCobranca = data?.itens.some(
    (item) => item.troca_status === "AGUARDANDO_COBRANCA",
  );
  const itensAtuais = data?.itens.filter(
    (item) => item.status_item === "ATIVO" || item.status_item === "TROCA_PENDENTE",
  ) ?? [];

  // "Ver detalhes" no histórico fecha o histórico e abre o modal específico
  // por cima do principal — mesmo comportamento de quem abre a partir da
  // lista de itens atual, sem empilhar um terceiro nível.
  const verCancelamentoDoHistorico = (itemId: number) => {
    setHistoricoAberto(false);
    setItemCancelamentoPreviewId(itemId);
  };
  const verTrocaDoHistorico = (itemId: number) => {
    const item = data?.itens.find((i) => i.id === itemId);
    setHistoricoAberto(false);
    if (item) setItemTroca(item);
  };

  return createPortal(
    <div className="pedmodal-overlay" {...modalProps}>
      <div className="pedmodal-card">
        {/* Header */}
        <div className="pedmodal-header">
          <h2 className="pedmodal-title">
            Pedido #{orderId}
            {data ? ` - ${data.pedido.cliente_nome}` : ""}
          </h2>
          <div className="pedmodal-header-actions">
            {data && (
              <div className="pedmodal-status-dropdown" ref={statusMenuRef}>
                <button
                  type="button"
                  className="pedmodal-btn-advance"
                  onClick={() => setStatusMenuOpen((open) => !open)}
                  disabled={alterando}
                >
                  Alterar status
                </button>
                {statusMenuOpen && (
                  <ul className="pedmodal-status-menu">
                    {STATUS_PEDIDO_OPCOES.map((status) => (
                      <li key={status}>
                        <button
                          type="button"
                          className={`pedmodal-status-option${
                            status === data.pedido.status_pedido
                              ? " pedmodal-status-option--current"
                              : ""
                          }${status === "CANCELADO" ? " pedmodal-status-option--danger" : ""}`}
                          onClick={() => alterarStatus(status)}
                        >
                          {STATUS_LABEL[status]}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <button className="pedmodal-btn-close" onClick={onClose}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="3" y1="3" x2="13" y2="13" />
                <line x1="13" y1="3" x2="3" y2="13" />
              </svg>
            </button>
          </div>
        </div>

        <div className="pedmodal-divider" />

        {/* Body */}
        {loading && <div className="pedmodal-body">Carregando...</div>}
        {error && <div className="pedmodal-body">{error}</div>}
        {data && (
          <div className="pedmodal-body">
            {statusError && (
              <p className="pedmodal-status-error">{statusError}</p>
            )}
            {/* Meta badges */}
            <div className="pedmodal-meta">
              <span className="pedmodal-badge pedmodal-badge--comanda">
                Comanda #{data.pedido.id}
              </span>
              <span
                className={`pedmodal-badge pedmodal-badge--${STATUS_TYPE[data.pedido.status_pedido]}`}
              >
                {STATUS_LABEL[data.pedido.status_pedido]}
              </span>
              <span className="pedmodal-meta-date">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="#8c7a76"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="12" height="11" rx="2" />
                  <line x1="2" y1="7" x2="14" y2="7" />
                  <line x1="5" y1="1.5" x2="5" y2="4" />
                  <line x1="11" y1="1.5" x2="11" y2="4" />
                </svg>
                {formatarData(data.pedido.criado_em)} · Retirada
              </span>
            </div>

            {/* Items */}
            <div className="pedmodal-items">
              <div className="pedmodal-items-header">
                <span className="pedmodal-section-label">Itens do pedido</span>
                <div className="pedmodal-items-header-actions">
                  <button
                    type="button"
                    className="pedmodal-btn-historico"
                    onClick={() => setHistoricoAberto(true)}
                  >
                    Histórico
                  </button>
                  {data.pedido.origem_pedido === "MANUAL" &&
                    data.pedido.status_comanda === "ABERTA" &&
                    (data.pedido.status_pedido === "NOVO" ||
                      data.pedido.status_pedido === "PREPARANDO") && (
                      <button
                        type="button"
                        className="pedmodal-btn-add-item"
                        onClick={() => setAdicionandoItem(true)}
                      >
                        + Adicionar produto
                      </button>
                    )}
                </div>
              </div>
              {itensAtuais.map((item) => (
                <div className="pedmodal-item-row" key={item.id}>
                  <div className="pedmodal-item-info">
                    <span className="pedmodal-item-name">
                      {item.produto_nome} {item.emoji ?? ""}
                    </span>
                    <span className="pedmodal-item-state">
                      {ITEM_STATUS_LABEL[item.status_item] ?? item.status_item} ·{" "}
                      {STOCK_STATUS_LABEL[item.estoque_estado] ?? item.estoque_estado}
                    </span>
                    {item.status_item === "TROCA_PENDENTE" && (
                      <span className="pedmodal-item-note">Fora do total até a troca ser concluída</span>
                    )}
                    <span className="pedmodal-item-qty">
                      {item.quantidade}x{" "}
                      {formatarPreco(item.valor_unitario_centavos)}
                    </span>
                  </div>
                  <div className="pedmodal-item-actions">
                    <span className="pedmodal-item-price">
                      {formatarPreco(item.valor_total_centavos)}
                    </span>
                    {item.cancelamento_id && (
                      <span className="pedmodal-item-qty">{FLOW_STATUS_LABEL[item.cancelamento_status ?? ""] ?? "Cancelamento em andamento"}</span>
                    )}
                    {item.troca_id && (
                      <span className="pedmodal-item-qty">{FLOW_STATUS_LABEL[item.troca_status ?? ""] ?? "Troca em andamento"}</span>
                    )}
                    {item.status_item === "ATIVO" &&
                      data.pedido.status_comanda === "ABERTA" &&
                      data.pedido.status_pedido !== "ENTREGUE" &&
                      data.pedido.status_pedido !== "CANCELADO" &&
                      (!item.troca_id || (item.troca_status === "CONCLUIDA" && item.troca_item_origem_id !== item.id)) && (
                        <>
                        <button
                          type="button"
                          className={`pedmodal-btn-cancel-item${item.cancelamento_id ? " pedmodal-btn-cancel-item--neutral" : ""}`}
                          onClick={() => setItemCancelamentoPreviewId(item.id)}
                        >
                          {item.cancelamento_id ? "Ver cancelamento" : "Cancelar item"}
                        </button>
                        {!item.cancelamento_id && (
                          <button type="button" className="pedmodal-btn-cancel-item pedmodal-btn-cancel-item--neutral" onClick={() => setItemTroca(item)}>
                            Trocar produto
                          </button>
                        )}
                        </>
                      )}
                    {item.cancelamento_id && item.status_item !== "ATIVO" && (
                      <button type="button" className="pedmodal-btn-cancel-item pedmodal-btn-cancel-item--neutral" onClick={() => setItemCancelamentoPreviewId(item.id)}>Ver cancelamento</button>
                    )}
                    {item.troca_id && item.troca_item_origem_id === item.id && (
                      <button type="button" className="pedmodal-btn-cancel-item pedmodal-btn-cancel-item--neutral" onClick={() => setItemTroca(item)}>Ver troca</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary */}
            <div className="pedmodal-summary">
              <div className="pedmodal-summary-row">
                <span className="pedmodal-summary-label">Subtotal</span>
                <span className="pedmodal-summary-value">
                  {formatarPreco(data.pedido.valor_total_centavos)}
                </span>
              </div>
              <div className="pedmodal-summary-row pedmodal-summary-row--total">
                <span className="pedmodal-total-label">Total</span>
                <span className="pedmodal-total-value">
                  {formatarPreco(data.pedido.valor_total_centavos)}
                </span>
              </div>
            </div>

            <div className="pedmodal-divider" />

            {/* Payment */}
            <div className="pedmodal-payment">
              <span className="pedmodal-section-label">Pagamento</span>
              <div className="pedmodal-payment-row">
                <span className={`pedmodal-badge pedmodal-badge--${financeiro!.cor}`}>
                  {financeiro!.badge}
                </span>
                {financeiro!.detalhe && (
                  <span className="pedmodal-payment-method">{financeiro!.detalhe}</span>
                )}
              </div>

              <div className="pedmodal-financial-grid">
                <div className="pedmodal-financial-row">
                  <span>Total</span>
                  <strong>{formatarPreco(data.financeiro.totalCentavos)}</strong>
                </div>
                <div className="pedmodal-financial-row">
                  <span>Pago</span>
                  <strong>{formatarPreco(data.financeiro.brutoPagoCentavos)}</strong>
                </div>
                {data.financeiro.reembolsadoCentavos > 0 && (
                  <div className="pedmodal-financial-row">
                    <span>Reembolsado</span>
                    <strong>- {formatarPreco(data.financeiro.reembolsadoCentavos)}</strong>
                  </div>
                )}
                <div className="pedmodal-financial-row">
                  <span>Líquido</span>
                  <strong>{formatarPreco(data.financeiro.liquidoCentavos)}</strong>
                </div>
                <div className="pedmodal-financial-row pedmodal-financial-row--balance">
                  <span>Saldo</span>
                  <strong>{formatarPreco(data.financeiro.saldoCentavos)}</strong>
                </div>
              </div>

              {/* B-3: cobrança cujo envio ao Mercado Pago ficou inconclusivo.
                  Reusa o mesmo bloco de aviso do caminho ambíguo, porque a
                  ação correta é idêntica: nunca tentar de novo às cegas, só
                  reler o que persistiu. A recuperação read-only roda sozinha
                  na carga da listagem; este bloco existe para o caso não
                  convergir. Nenhum estado é inventado aqui. */}
              {data.operacoesInconclusivas.length > 0 && (
                <div className="pedmodal-pix-aviso">
                  <span>
                    ⚠ {data.operacoesInconclusivas.length === 1 ? "Uma cobrança" : "Cobranças"} deste
                    pedido não teve confirmação do Mercado Pago. Verificamos automaticamente; não
                    gere outra sem conferir.
                  </span>
                  <button
                    type="button"
                    className="pedmodal-btn-edit"
                    onClick={() => void carregarPedido(true)}
                  >
                    Atualizar pedido
                  </button>
                </div>
              )}

              {pixError && <p className="pedmodal-status-error">{pixError}</p>}
              {pixAviso && (
                <div className="pedmodal-pix-aviso">
                  <span>⚠ {pixAviso}</span>
                  <button
                    type="button"
                    className="pedmodal-btn-edit"
                    onClick={() => {
                      setPixAviso(null);
                      void carregarPedido(true);
                    }}
                  >
                    Atualizar pedido
                  </button>
                </div>
              )}

              {data.pedido.status_comanda === "ABERTA" &&
                data.capacidadeCobravelCentavos > 0 && (
                  <div className="pedmodal-charge-action">
                    {trocaAguardandoCobranca && (
                      <div><strong>Troca aguardando pagamento</strong>
                        <span>Saldo: {formatarPreco(data.capacidadeCobravelCentavos)}.</span></div>
                    )}
                    <button
                    type="button"
                    className="pedmodal-btn-advance"
                    onClick={() =>
                      gerarPix(undefined, data.capacidadeCobravelCentavos)
                    }
                    disabled={gerando}
                  >
                    {gerando
                      ? "Gerando..."
                      : `Gerar Pix ${formatarPreco(data.capacidadeCobravelCentavos)}`}
                    </button>
                  </div>
                )}

              {data.pixAdminPendentes.map((pix) => {
                const expiraEmMs = pix.expiresAt ? Date.parse(pix.expiresAt) : null;
                const vencido = expiraEmMs !== null && expiraEmMs <= agora;
                const restanteS =
                  expiraEmMs !== null ? Math.max(0, Math.floor((expiraEmMs - agora) / 1000)) : null;
                const minutos =
                  restanteS !== null ? String(Math.floor(restanteS / 60)).padStart(2, "0") : null;
                const segundos = restanteS !== null ? String(restanteS % 60).padStart(2, "0") : null;

                return (
                  <div className="pedmodal-pix-card" key={pix.id}>
                    <span className="pedmodal-pix-valor">
                      Pix pendente · {formatarPreco(pix.valorCentavos)}
                    </span>

                    {pix.qrCodeBase64 && (
                      <div className="pedmodal-pix-qr">
                        <img
                          src={`data:image/png;base64,${pix.qrCodeBase64}`}
                          alt="QR Code Pix"
                        />
                      </div>
                    )}

                    {pix.qrCode && (
                      <>
                        <div className="pedmodal-pix-copy-row">
                          <span className="pedmodal-pix-copy-label">PIX COPIA E COLA</span>
                          <button
                            type="button"
                            className="pedmodal-pix-copy-btn"
                            onClick={() => copiarCodigo(pix.id, pix.qrCode!)}
                          >
                            {copiedId === pix.id ? "Copiado!" : "Copiar código"}
                          </button>
                        </div>
                        <div className="pedmodal-pix-code-box">{pix.qrCode}</div>
                      </>
                    )}

                    {vencido ? (
                      <div className="pedmodal-pix-vencido">
                        <span>Expiração informada pelo Mercado Pago atingida</span>
                        <button
                          type="button"
                          className="pedmodal-btn-edit"
                          onClick={() => void carregarPedido(true)}
                        >
                          Atualizar pedido
                        </button>
                      </div>
                    ) : (
                      restanteS !== null && (
                        <span className="pedmodal-pix-timer">
                          ⏱ Expira em {minutos}:{segundos}
                        </span>
                      )
                    )}

                    <button
                      type="button"
                      className="pedmodal-btn-edit"
                      onClick={() => gerarPix(pix.id)}
                      disabled={regenerandoId === pix.id}
                    >
                      {regenerandoId === pix.id ? "Regenerando..." : "Regenerar Pix"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {data && historicoAberto && (
        <HistoricoComandaModal
          orderId={orderId}
          onClose={() => setHistoricoAberto(false)}
          onVerCancelamento={verCancelamentoDoHistorico}
          onVerTroca={verTrocaDoHistorico}
        />
      )}
      {data && adicionandoItem && (
        <AdicionarItemModal
          orderId={orderId}
          onClose={() => setAdicionandoItem(false)}
          onAdded={async () => {
            await carregarPedido(true);
          }}
        />
      )}
      {itemCancelamentoPreviewId !== null && (
        <CancelamentoItemPreviewModal
          orderId={orderId}
          itemId={itemCancelamentoPreviewId}
          onClose={() => setItemCancelamentoPreviewId(null)}
          existingCancellationId={data?.itens.find((item) => item.id === itemCancelamentoPreviewId)?.cancelamento_id}
          onChanged={async () => { await carregarPedido(true); onStatusChanged?.(); }}
        />
      )}
      {itemTroca && (
        <TrocarItemModal orderId={orderId} item={itemTroca} existingExchangeId={itemTroca.troca_item_origem_id === itemTroca.id ? itemTroca.troca_id : null}
          onClose={() => setItemTroca(null)} onChanged={async () => { await carregarPedido(true); onStatusChanged?.(); }} />
      )}
    </div>,
    document.body,
  );
}
