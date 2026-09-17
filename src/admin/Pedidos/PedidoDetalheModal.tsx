import { useEffect, useRef, useState } from "react";
import { novaOperationKey } from "../../lib/operationKey";
import { createPortal } from "react-dom";
import "./PedidoDetalheModal.css";
import { formatarFinanceiro, type FinanceiroPedido } from "./formatarFinanceiro";

/* ── Types (espelham o retorno de GET /api/admin/pedidos/:id) ── */
interface PedidoItemRow {
  produto_nome: string;
  emoji: string | null;
  quantidade: number;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
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
}

interface PedidoDetalheModalProps {
  orderId: number;
  onClose: () => void;
  onStatusChanged?: () => void;
  onEdit?: () => void;
}

/* ── Helpers ── */
const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const formatarData = (isoLike: string) =>
  new Date(isoLike.replace(" ", "T")).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

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

/* ── Component ── */
export default function PedidoDetalheModal({
  orderId,
  onClose,
  onStatusChanged,
  onEdit,
}: PedidoDetalheModalProps) {
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

  // A1: uma key por INTENÇÃO de cobrança. A identidade da ação já distingue
  // "gerar Pix novo" de "regenerar o Pix X", então o mapa é indexado por
  // ela. A key sobrevive a um retry da mesma ação (resposta perdida, erro de
  // rede) e é descartada quando a ação se resolve — assim uma regeneração
  // NOVA, iniciada explicitamente pelo operador depois, recebe key nova.
  // No caminho AMBÍGUO a key é preservada de propósito: repetir a ação nunca
  // pode nascer como uma segunda cobrança com outra identidade no MP.
  const pixKeysRef = useRef<Map<string, string>>(new Map());

  const carregarPedido = () => {
    setLoading(true);
    return fetch(`/api/admin/pedidos/${orderId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar pedido");
        return response.json() as Promise<PedidoDetalheResponse>;
      })
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    carregarPedido();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

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

  const gerarPix = (substituiId?: number) => {
    setPixError(null);
    setPixAviso(null);
    if (substituiId) setRegenerandoId(substituiId);
    else setGerando(true);

    const acao = substituiId ? `regen:${substituiId}` : "novo";
    let operationKey = pixKeysRef.current.get(acao);
    if (!operationKey) {
      operationKey = novaOperationKey();
      pixKeysRef.current.set(acao, operationKey);
    }

    fetch(`/api/admin/pedidos/${orderId}/pix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        substituiId ? { substituiId, operationKey } : { operationKey },
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
        return carregarPedido();
      })
      .catch((err) => setPixError(err.message))
      .finally(() => {
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

  return createPortal(
    <div className="pedmodal-overlay" onClick={onClose}>
      <div className="pedmodal-card" onClick={(e) => e.stopPropagation()}>
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
            {data && data.pedido.status_pedido !== "ENTREGUE" && (
              <button className="pedmodal-btn-edit" onClick={onEdit}>
                Editar pedido
              </button>
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
              <span className="pedmodal-section-label">Itens do pedido</span>
              {data.itens.map((item, i) => (
                <div className="pedmodal-item-row" key={i}>
                  <div className="pedmodal-item-info">
                    <span className="pedmodal-item-name">
                      {item.produto_nome} {item.emoji ?? ""}
                    </span>
                    <span className="pedmodal-item-qty">
                      {item.quantidade}x{" "}
                      {formatarPreco(item.valor_unitario_centavos)}
                    </span>
                  </div>
                  <span className="pedmodal-item-price">
                    {formatarPreco(item.valor_total_centavos)}
                  </span>
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

              {pixError && <p className="pedmodal-status-error">{pixError}</p>}
              {pixAviso && (
                <div className="pedmodal-pix-aviso">
                  <span>⚠ {pixAviso}</span>
                  <button
                    type="button"
                    className="pedmodal-btn-edit"
                    onClick={() => {
                      setPixAviso(null);
                      carregarPedido();
                    }}
                  >
                    Atualizar pedido
                  </button>
                </div>
              )}

              {/* "Gerar Pix" só aparece sem nenhum Pix administrativo vivo —
                  com Pix parciais aditivos já existentes, esta primeira
                  versão só oferece regenerar cada um, não criar mais um em
                  cima (o backend suporta; a UI não oferece isso ainda). */}
              {data.pixAdminPendentes.length === 0 &&
                data.pedido.status_comanda === "ABERTA" &&
                data.financeiro.totalCentavos > data.financeiro.pagoCentavos && (
                  <button
                    type="button"
                    className="pedmodal-btn-advance"
                    onClick={() => gerarPix()}
                    disabled={gerando}
                  >
                    {gerando ? "Gerando..." : "Gerar Pix"}
                  </button>
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
                          onClick={() => carregarPedido()}
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
    </div>,
    document.body,
  );
}
