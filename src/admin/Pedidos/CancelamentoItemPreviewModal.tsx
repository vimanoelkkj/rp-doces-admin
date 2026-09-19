import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { novaOperationKey } from "../../lib/operationKey";
import { useAdminModal } from "../components/useAdminModal";
import "./CancelamentoItemPreviewModal.css";

interface PreviewPagamento {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  reembolsoPropostoCentavos: number;
}
interface CancelamentoPreview {
  previewFingerprint: string;
  pedidoId: number;
  item: {
    id: number;
    nome: string;
    quantidade: number;
    valorCentavos: number;
    statusItem: string;
    estoqueEstado: string;
  };
  financeiro: {
    valorItemCentavos: number;
    coberturaConfirmadaCentavos: number;
    valorNaoPagoCentavos: number;
    reembolsoNecessarioCentavos: number;
  };
  pagamentos: PreviewPagamento[];
  estoque: {
    estadoAtual: string;
    acaoPadrao: "LIBERAR_RESERVA" | "NAO_REPOR" | "NENHUMA";
  };
  bloqueios: Array<{ codigo: string; mensagem: string }>;
  cancelamentoExecutavel: boolean;
}
interface Perna {
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
  };
}
interface Cancelamento {
  id: number;
  status: string;
  estoqueAcao: string;
  reembolsoPendenteCentavos: number;
  pernasPendentes: Perna[];
}
interface Props {
  orderId: number;
  itemId: number;
  existingCancellationId?: number | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}
const dinheiro = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v / 100,
  );
const METODOS: Record<string, string> = {
  PIX_MP: "Pix Mercado Pago",
  PIX_EXTERNO: "Pix externo",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
};

export default function CancelamentoItemPreviewModal({
  orderId,
  itemId,
  existingCancellationId,
  onClose,
  onChanged,
}: Props) {
  const modalProps = useAdminModal(true, onClose);
  const [preview, setPreview] = useState<CancelamentoPreview | null>(null);
  const [cancelamento, setCancelamento] = useState<Cancelamento | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [acao, setAcao] = useState<string>("");
  const operationKey = useRef(novaOperationKey());
  const refundKeys = useRef(new Map<number, string>());
  useEffect(() => {
    let active = true;
    setLoading(true);
    const path = existingCancellationId
      ? `/api/admin/pedidos/${orderId}/itens/${itemId}/cancelamentos`
      : `/api/admin/pedidos/${orderId}/itens/${itemId}/cancelamento-preview`;
    fetch(path)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? "Falha ao carregar cancelamento");
        return b;
      })
      .then((body) => {
        if (!active) return;
        if (existingCancellationId)
          setCancelamento(body.cancelamento as Cancelamento);
        else {
          const p = body as CancelamentoPreview;
          setPreview(p);
          setAcao(p.estoque.acaoPadrao);
        }
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [existingCancellationId, itemId, orderId]);
  const confirmar = async () => {
    if (!preview || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/pedidos/${orderId}/itens/${itemId}/cancelamentos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationKey: operationKey.current,
            motivo,
            estoqueAcao: acao,
            previewFingerprint: preview.previewFingerprint,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.code === "PREVIEW_OBSOLETO" && body.preview) {
          setPreview(body.preview);
          setAcao(body.preview.estoque.acaoPadrao);
          operationKey.current = novaOperationKey();
        }
        throw new Error(body.error ?? "Falha ao cancelar item");
      }
      setCancelamento(body.cancelamento);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao cancelar item");
    } finally {
      setSaving(false);
    }
  };
  const refund = async (leg: Perna) => {
    if (!cancelamento || saving) return;
    let key = refundKeys.current.get(leg.pagamentoAlocacaoId);
    if (!key) {
      key = novaOperationKey();
      refundKeys.current.set(leg.pagamentoAlocacaoId, key);
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/pedidos/${orderId}/cancelamentos/${cancelamento.id}/reembolsos`,
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
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error ?? "Falha ao registrar devolução");
      if (["CONFIRMADO", "RECUSADO"].includes(body.refundStatus) || !body.refundStatus)
        refundKeys.current.delete(leg.pagamentoAlocacaoId);
      setCancelamento(body.cancelamento);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao registrar devolução");
    } finally {
      setSaving(false);
    }
  };
  const statusLabel = (s: string) =>
    ({
      SOLICITADO: "Solicitado",
      AGUARDANDO_REEMBOLSO: "Aguardando reembolso",
      CONCLUIDO: "Cancelamento concluído",
      INCONCLUSIVO: "Reconciliação pendente",
      FALHOU: "Falhou",
    })[s] ?? s;
  const remoteLabel = (leg: Perna) => {
    const status = leg.refundRemoto?.status;
    if (status === "PENDENTE") return "Aguardando envio";
    if (status === "PROCESSANDO") return "Processando";
    if (status === "CONFIRMADO") return "Confirmado";
    if (status === "RECUSADO") return "Recusado — tentar novamente";
    if (status === "INCONCLUSIVO") return "Inconclusivo — verificar novamente";
    return "Solicitar estorno";
  };
  return createPortal(
    <div className="cancelpreview-overlay" {...modalProps}>
      <section className="cancelpreview-card" role="dialog" aria-modal="true">
        <header className="cancelpreview-header">
          <div>
            <span className="cancelpreview-kicker">Comanda #{orderId}</span>
            <h3>Cancelar item</h3>
          </div>
          <button
            type="button"
            className="cancelpreview-close"
            onClick={onClose}
            aria-label="Fechar"
          >
            ×
          </button>
        </header>
        {loading && (
          <div className="cancelpreview-state">Calculando impacto...</div>
        )}
        {error && <div className="cancelpreview-error">{error}</div>}
        {preview && !cancelamento && (
          <div className="cancelpreview-content">
            <div className="cancelpreview-product">
              <strong>{preview.item.nome}</strong>
              <span>
                {preview.item.quantidade}x ·{" "}
                {dinheiro(preview.item.valorCentavos)}
              </span>
            </div>
            <div className="cancelpreview-values">
              <div>
                <span>Valor do item</span>
                <strong>
                  {dinheiro(preview.financeiro.valorItemCentavos)}
                </strong>
              </div>
              <div>
                <span>Valor já pago associado</span>
                <strong>
                  {dinheiro(preview.financeiro.coberturaConfirmadaCentavos)}
                </strong>
              </div>
              <div>
                <span>Valor ainda não pago</span>
                <strong>
                  {dinheiro(preview.financeiro.valorNaoPagoCentavos)}
                </strong>
              </div>
              <div className="cancelpreview-values-refund">
                <span>Valor a devolver</span>
                <strong>
                  {dinheiro(preview.financeiro.reembolsoNecessarioCentavos)}
                </strong>
              </div>
            </div>
            <div className="cancelpreview-section">
              <span className="cancelpreview-label">Pagamentos envolvidos</span>
              <div className="cancelpreview-payments">
                {preview.pagamentos
                  .filter((p) => p.reembolsoPropostoCentavos > 0)
                  .map((p) => (
                    <div key={p.pagamentoAlocacaoId}>
                      <span>{METODOS[p.metodo] ?? p.metodo}</span>
                      <strong>
                        {dinheiro(p.reembolsoPropostoCentavos)}{" "}
                        {p.metodo === "DINHEIRO" ? "a devolver" : "a estornar"}
                      </strong>
                    </div>
                  ))}
                {!preview.pagamentos.some(
                  (p) => p.reembolsoPropostoCentavos > 0,
                ) && (
                  <p className="cancelpreview-muted">
                    Nenhum pagamento confirmado cobre este item.
                  </p>
                )}
              </div>
            </div>
            <div className="cancelpreview-stock">
              <span className="cancelpreview-label">Estoque</span>
              <p>
                {preview.estoque.estadoAtual === "RESERVADO"
                  ? `A reserva de ${preview.item.quantidade} ${preview.item.quantidade === 1 ? "unidade" : "unidades"} será liberada.`
                  : preview.estoque.estadoAtual === "BAIXADO"
                    ? "O produto já foi baixado. A reposição depende da confirmação física abaixo."
                    : "Nenhum efeito físico é necessário."}
              </p>
            </div>
            {preview.item.estoqueEstado === "BAIXADO" && (
              <label className="cancelpreview-field">
                <span>Ação física confirmada</span>
                <select
                  value={acao}
                  onChange={(e) => setAcao(e.target.value)}
                  disabled={saving}
                >
                  <option value="NAO_REPOR">Não repor no estoque</option>
                  <option value="REPOR">
                    Produto devolvido: repor no estoque
                  </option>
                </select>
              </label>
            )}
            <label className="cancelpreview-field">
              <span>Motivo</span>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={300}
              />
            </label>
            {preview.bloqueios.map((b) => (
              <div className="cancelpreview-block" key={b.codigo}>
                {b.mensagem}
              </div>
            ))}
            <div className="cancelpreview-footer">
              <button type="button" onClick={onClose}>
                Voltar
              </button>
              <button
                type="button"
                className="cancelpreview-confirm"
                onClick={() => void confirmar()}
                disabled={!preview.cancelamentoExecutavel || saving}
              >
                {saving ? "Confirmando..." : "Confirmar cancelamento"}
              </button>
            </div>
          </div>
        )}
        {cancelamento && (
          <div className="cancelpreview-content">
            <div className="cancelpreview-success">
              <strong>{statusLabel(cancelamento.status)}</strong>
              {cancelamento.status !== "CONCLUIDO" && (
                <span>
                  O item continua ativo até todas as devoluções serem
                  resolvidas.
                </span>
              )}
            </div>
            {cancelamento.pernasPendentes.map((leg) => (
              <div
                className="cancelpreview-refund-leg"
                key={leg.pagamentoAlocacaoId}
              >
                <div>
                  <strong>{METODOS[leg.metodo] ?? leg.metodo}</strong>
                  <span>{dinheiro(leg.valorCentavos)}</span>
                </div>
                {leg.confirmacaoManualPermitida ? (
                  <button
                    type="button"
                    onClick={() => void refund(leg)}
                    disabled={saving}
                  >
                    Confirmar devolução
                  </button>
                ) : (
                  <button type="button" onClick={() => void refund(leg)} disabled={saving}>
                    {remoteLabel(leg)}
                  </button>
                )}
              </div>
            ))}
            <div className="cancelpreview-footer">
              <span>
                {cancelamento.reembolsoPendenteCentavos > 0
                  ? `Pendente: ${dinheiro(cancelamento.reembolsoPendenteCentavos)}`
                  : "Fluxo concluído"}
              </span>
              <button type="button" onClick={onClose}>
                Fechar
              </button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
