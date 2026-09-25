import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { precoVigenteCentavos } from "../../../shared/promocao";
import { novaOperationKey } from "../../lib/operationKey";
import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import { useAdminModal } from "../components/useAdminModal";
import { reconciliarPedido } from "./reconciliarPedido";
import "./AdicionarItemModal.css";
import "./CancelamentoItemPreviewModal.css";

interface Item {
  id: number;
  produto_nome: string;
  valor_total_centavos: number;
  estoque_estado: string;
}
interface RefundLeg {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorCentavos: number;
  confirmacaoManualPermitida: boolean;
  refundRemoto?: {
    status: "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "RECUSADO" | "INCONCLUSIVO";
    tentativas: number;
    mpRefundId: string | null;
    ultimoErro: string | null;
    operationKey: string;
    atualizadoEm: string;
    podeVerificar: boolean;
  };
}
interface Preview {
  previewFingerprint: string;
  itemDestino: { nome: string; valorCentavos: number };
  financeiro: {
    totalProjetadoCentavos: number;
    diferencaCentavos: number;
    saldoProjetadoCentavos: number;
    excessoProjetadoCentavos: number;
  };
  refundsPropostos: RefundLeg[];
  estoque: { acaoOrigem: string; acoesOrigemPermitidas: string[] };
  bloqueios: Array<{ codigo: string; mensagem: string }>;
  trocaExecutavel: boolean;
}
interface Exchange {
  id: number;
  status: string;
  reembolsoPendenteCentavos: number;
  refundsPendentes: RefundLeg[];
  estoqueOrigemEstado?: string;
  estoqueDestinoEstado?: string | null;
  reembolsosConfirmados?: Array<{
    id: number; metodo: string; valorCentavos: number; origem: string; mpRefundId: string | null;
  }>;
  financeiro?: { status: string; totalCentavos: number; liquidoCentavos: number; saldoCentavos: number };
}
interface Props {
  orderId: number;
  item: Item;
  existingExchangeId?: number | null;
  existingExchangeStatus?: string | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}
const money = (v: number) => `R$ ${(v / 100).toFixed(2).replace(".", ",")}`;
const free = (p: ProdutoAdmin) => Math.max(0, p.estoque - p.estoque_reservado);
const labels: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  CARTAO: "Cartão",
  PIX_EXTERNO: "Pix externo",
  PIX_MP: "Pix Mercado Pago",
};

export default function TrocarItemModal({
  orderId,
  item,
  existingExchangeId,
  existingExchangeStatus,
  onClose,
  onChanged,
}: Props) {
  const modalProps = useAdminModal(true, onClose);
  const [products, setProducts] = useState<ProdutoAdmin[]>([]);
  const [productId, setProductId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [action, setAction] = useState(
    item.estoque_estado === "RESERVADO"
      ? "LIBERAR_RESERVA"
      : item.estoque_estado === "BAIXADO"
        ? "NAO_REPOR"
        : "NENHUMA",
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productDropdownOpen, setProductDropdownOpen] = useState(false);
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false);
  const keyRef = useRef(novaOperationKey());
  const signatureRef = useRef("");
  const refundKeys = useRef(new Map<number, string>());
  useEffect(() => {
    let active = true;
    if (existingExchangeId) {
      // O GET é somente leitura: a retomada de refund/finalização pendente é
      // pedida antes, de forma explícita.
      reconciliarPedido(orderId)
        .then(() => fetch(`/api/admin/pedidos/${orderId}/itens/${item.id}/trocas`))
        .then(async (r) => {
          const b = await r.json();
          if (!r.ok) throw new Error(b.error);
          return b;
        })
        .then((b) => {
          if (active) {
            setExchange(b.troca);
            setError(null);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }
    fetch("/api/admin/produtos")
      .then((r) => r.json())
      .then((b: { produtos: ProdutoAdmin[] }) => {
        if (active) {
          setProducts(
            b.produtos.filter((p) => p.ativo === 1 && p.disponivel === 1),
          );
        }
      })
      .catch(() => {
        if (active) setError("Falha ao carregar produtos");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [existingExchangeId, existingExchangeStatus, item.id, orderId]);
  const product = products.find((p) => p.id === productId) ?? null;
  const price = product ? precoVigenteCentavos(product) : 0;
  useEffect(() => {
    if (!product || quantity < 1) {
      setPreview(null);
      return;
    }
    let active = true;
    const query = new URLSearchParams({
      produtoDestinoId: String(product.id),
      quantidadeDestino: String(quantity),
      precoEsperadoCentavos: String(price),
      estoqueAcaoOrigem: action,
    });
    fetch(
      `/api/admin/pedidos/${orderId}/itens/${item.id}/troca-preview?${query}`,
    )
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? "Falha ao calcular troca");
        return b as Preview;
      })
      .then((p) => {
        if (active) {
          setPreview(p);
          setError(null);
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [action, item.id, orderId, price, product, quantity]);
  const confirm = async () => {
    if (!preview || !product || saving) return;
    const signature = JSON.stringify({
      productId: product.id,
      quantity,
      price,
      action,
      preview: preview.previewFingerprint,
    });
    if (signatureRef.current !== signature) {
      keyRef.current = novaOperationKey();
      signatureRef.current = signature;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/pedidos/${orderId}/itens/${item.id}/trocas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationKey: keyRef.current,
            produtoDestinoId: product.id,
            quantidadeDestino: quantity,
            precoEsperadoCentavos: price,
            estoqueAcaoOrigem: action,
            previewFingerprint: preview.previewFingerprint,
          }),
        },
      );
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? "Falha ao executar troca");
      setExchange(b.troca);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao executar troca");
    } finally {
      setSaving(false);
    }
  };
  const refund = async (leg: RefundLeg) => {
    if (!exchange || saving) return;
    let key = leg.refundRemoto?.operationKey ?? refundKeys.current.get(leg.pagamentoAlocacaoId);
    if (!key) {
      key = novaOperationKey();
      refundKeys.current.set(leg.pagamentoAlocacaoId, key);
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/pedidos/${orderId}/trocas/${exchange.id}/reembolsos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationKey: key,
            pagamentoId: leg.pagamentoId,
            pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
            valorCentavos: leg.valorCentavos,
            confirmacao: true,
          }),
        },
      );
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? "Falha ao registrar devolução");
      if (b.refundStatus === "CONFIRMADO" || !b.refundStatus)
        refundKeys.current.delete(leg.pagamentoAlocacaoId);
      setExchange(b.troca);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao registrar devolução");
    } finally {
      setSaving(false);
    }
  };
  const remoteLabel = (leg: RefundLeg) => {
    const status = leg.refundRemoto?.status;
    if (status === "PENDENTE") return "Aguardando envio";
    if (status === "PROCESSANDO") return "Processando";
    if (status === "CONFIRMADO") return "Confirmado";
    if (status === "RECUSADO") return "Recusado pelo provedor";
    if (status === "INCONCLUSIVO") return "Verificar novamente";
    return "Solicitar estorno";
  };
  const remoteCanRun = (leg: RefundLeg) => {
    const remote = leg.refundRemoto;
    if (!remote) return true;
    if (["RECUSADO", "CONFIRMADO"].includes(remote.status)) return false;
    return remote.podeVerificar;
  };
  return createPortal(
    <div className="additem-overlay" {...modalProps}>
      <section className="additem-card" role="dialog" aria-modal="true">
        <header className="additem-header">
          <div>
            <span className="additem-kicker">Comanda #{orderId}</span>
            <h2>Trocar produto</h2>
            <p>
              {item.produto_nome} · {money(item.valor_total_centavos)}
            </p>
          </div>
          <button className="additem-close" onClick={onClose}>
            ×
          </button>
        </header>
        {loading && <div className="additem-loading">Carregando...</div>}
        {error && <p className="additem-error">{error}</p>}
        {!exchange && !loading && (
          <div className="additem-form">
            <label className="additem-field">
              <span>Novo produto</span>
              <div className={`additem-dropdown${productDropdownOpen ? " additem-dropdown--open" : ""}`}>
                <button
                  type="button"
                  className="additem-dropdown-trigger"
                  onClick={() => setProductDropdownOpen((open) => !open)}
                  onBlur={() => setTimeout(() => setProductDropdownOpen(false), 150)}
                >
                  <span>
                    {(() => {
                      const selected = products.find((p) => p.id === productId);
                      return selected
                        ? `${selected.nome} · ${money(precoVigenteCentavos(selected))} · ${free(selected)} disponíveis`
                        : "Selecione";
                    })()}
                  </span>
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path d="M1 1.5L6 6.5L11 1.5" stroke="#634738" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {productDropdownOpen && (
                  <ul className="additem-dropdown-list">
                    {products.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className={`additem-dropdown-option${productId === p.id ? " additem-dropdown-option--active" : ""}`}
                          onClick={() => {
                            setProductId(p.id);
                            setQuantity(1);
                            setProductDropdownOpen(false);
                          }}
                        >
                          {p.nome} · {money(precoVigenteCentavos(p))} · {free(p)} disponíveis
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
            <label className="additem-field">
              <span>Quantidade</span>
              <input
                type="number"
                min="1"
                max="50"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            {item.estoque_estado === "BAIXADO" && (
              <label className="additem-field">
                <span>Produto atual</span>
                <div className={`additem-dropdown${actionDropdownOpen ? " additem-dropdown--open" : ""}`}>
                  <button
                    type="button"
                    className="additem-dropdown-trigger"
                    onClick={() => setActionDropdownOpen((open) => !open)}
                    onBlur={() => setTimeout(() => setActionDropdownOpen(false), 150)}
                  >
                    <span>{action === "REPOR" ? "Voltou fisicamente ao estoque" : "Não voltou ao estoque"}</span>
                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                      <path d="M1 1.5L6 6.5L11 1.5" stroke="#634738" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {actionDropdownOpen && (
                    <ul className="additem-dropdown-list">
                      {[
                        { value: "NAO_REPOR", label: "Não voltou ao estoque" },
                        { value: "REPOR", label: "Voltou fisicamente ao estoque" },
                      ].map((option) => (
                        <li key={option.value}>
                          <button
                            type="button"
                            className={`additem-dropdown-option${action === option.value ? " additem-dropdown-option--active" : ""}`}
                            onClick={() => {
                              setAction(option.value);
                              setActionDropdownOpen(false);
                            }}
                          >
                            {option.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </label>
            )}
            {preview && (
              <>
                <div className="cancelpreview-values">
                  <div>
                    <span>Valor atual</span>
                    <strong>{money(item.valor_total_centavos)}</strong>
                  </div>
                  <div>
                    <span>Novo valor</span>
                    <strong>{money(preview.itemDestino.valorCentavos)}</strong>
                  </div>
                  <div>
                    <span>Diferença</span>
                    <strong>
                      {preview.financeiro.diferencaCentavos > 0
                        ? "+ "
                        : preview.financeiro.diferencaCentavos < 0
                          ? "- "
                          : ""}
                      {money(Math.abs(preview.financeiro.diferencaCentavos))}
                    </strong>
                  </div>
                  <div>
                    <span>Saldo após troca</span>
                    <strong>
                      {money(preview.financeiro.saldoProjetadoCentavos)}
                    </strong>
                  </div>
                  {preview.financeiro.excessoProjetadoCentavos > 0 && (
                    <div>
                      <span>Será necessário devolver</span>
                      <strong>
                        {money(preview.financeiro.excessoProjetadoCentavos)}
                      </strong>
                    </div>
                  )}
                </div>
                {preview.bloqueios.map((b) => (
                  <div className="cancelpreview-block" key={b.codigo}>
                    {b.mensagem}
                  </div>
                ))}
              </>
            )}
            <footer className="additem-actions">
              <button className="additem-cancel" onClick={onClose}>
                Voltar
              </button>
              <button
                className="additem-confirm"
                onClick={() => void confirm()}
                disabled={!preview?.trocaExecutavel || saving}
              >
                {saving ? "Confirmando..." : "Confirmar troca"}
              </button>
            </footer>
          </div>
        )}
        {exchange && (
          <div className="cancelpreview-content">
            <div className="cancelpreview-success">
              <strong>{exchange.status.replace(/_/g, " ")}</strong>
              <span>
                {exchange.status === "AGUARDANDO_COBRANCA"
                  ? "A troca foi aplicada. A diferença pode ser cobrada pelo Pix da comanda."
                  : exchange.status === "AGUARDANDO_REEMBOLSO"
                    ? "O produto atual permanece ativo até as devoluções terminarem."
                    : "Troca concluída."}
              </span>
            </div>
            {exchange.financeiro && (
              <div className="cancelpreview-values">
                <div><span>Total atual</span><strong>{money(exchange.financeiro.totalCentavos)}</strong></div>
                <div><span>Pago líquido</span><strong>{money(exchange.financeiro.liquidoCentavos)}</strong></div>
                <div><span>Saldo</span><strong>{money(exchange.financeiro.saldoCentavos)}</strong></div>
                <div><span>Estoque origem</span><strong>{exchange.estoqueOrigemEstado}</strong></div>
              </div>
            )}
            {(exchange.reembolsosConfirmados?.length ?? 0) > 0 && (
              <div className="cancelpreview-section">
                <span className="cancelpreview-label">Devoluções confirmadas</span>
                {exchange.reembolsosConfirmados?.map((refund) => (
                  <div className="cancelpreview-refund-leg" key={refund.id}>
                    <div><strong>{labels[refund.metodo] ?? refund.metodo}</strong><span>{money(refund.valorCentavos)}</span></div>
                    <span>Confirmado</span>
                  </div>
                ))}
              </div>
            )}
            {exchange.refundsPendentes.map((leg) => (
              <div
                className="cancelpreview-refund-leg"
                key={leg.pagamentoAlocacaoId}
              >
                <div>
                  <strong>{labels[leg.metodo] ?? leg.metodo}</strong>
                  <span>{money(leg.valorCentavos)}</span>
                </div>
                {leg.confirmacaoManualPermitida ? (
                  <button onClick={() => void refund(leg)} disabled={saving}>
                    Confirmar devolução
                  </button>
                ) : (
                  <div>
                    {leg.refundRemoto?.status === "INCONCLUSIVO" && (
                      <span>Não foi possível confirmar o resultado do estorno.</span>
                    )}
                    {leg.refundRemoto?.status === "RECUSADO" && (
                      <span>O Mercado Pago recusou esta tentativa. Revise antes de iniciar outra operação.</span>
                    )}
                    {remoteCanRun(leg) ? (
                      <button onClick={() => void refund(leg)} disabled={saving}>{remoteLabel(leg)}</button>
                    ) : (
                      <span>{remoteLabel(leg)}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="cancelpreview-footer">
              <span>
                {exchange.reembolsoPendenteCentavos
                  ? `Pendente: ${money(exchange.reembolsoPendenteCentavos)}`
                  : "Sem devoluções pendentes"}
              </span>
              <button onClick={onClose}>Fechar</button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
