import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { novaOperationKey } from "../../lib/operationKey";
import { useAdminModal } from "../components/useAdminModal";
import { reconciliarPedido } from "./reconciliarPedido";
import CancelamentoItemPreviewSection from "./CancelamentoItemPreviewSection";
import CancelamentoItemResultSection from "./CancelamentoItemResultSection";
import type { Perna } from "./cancelamentoItemHelpers";
import "./CancelamentoItemPreviewModal.css";

interface PreviewPagamento {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  reembolsoPropostoCentavos: number;
}
export interface CancelamentoPreview {
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
export interface Cancelamento {
  id: number;
  status: string;
  estoqueAcao: string;
  reembolsoPendenteCentavos: number;
  pernasPendentes: Perna[];
  estoqueEstado?: string;
  reembolsosConfirmados?: Array<{
    id: number;
    metodo: string;
    valorCentavos: number;
    origem: string;
    mpRefundId: string | null;
  }>;
  financeiro?: {
    status: string;
    totalCentavos: number;
    liquidoCentavos: number;
    saldoCentavos: number;
  };
}
interface Props {
  orderId: number;
  itemId: number;
  existingCancellationId?: number | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}
export default function CancelamentoItemPreviewModal({
  orderId,
  itemId,
  existingCancellationId,
  onClose,
  onChanged
}: Props) {
  const modalProps = useAdminModal(true, onClose);
  const [preview, setPreview] = useState<CancelamentoPreview | null>(null);
  const [cancelamento, setCancelamento] = useState<Cancelamento | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [acao, setAcao] = useState<string>("");
  const [acaoDropdownOpen, setAcaoDropdownOpen] = useState(false);
  const operationKey = useRef(novaOperationKey());
  const refundKeys = useRef(new Map<number, string>());
  useEffect(() => {
    let active = true;
    setLoading(true);
    const path = existingCancellationId
      ? `/api/admin/pedidos/${orderId}/itens/${itemId}/cancelamentos`
      : `/api/admin/pedidos/${orderId}/itens/${itemId}/cancelamento-preview`;
    // Cancelamento existente: o GET é somente leitura, então a retomada de
    // refund/finalização pendente é pedida antes, de forma explícita. Um
    // preview novo não depende disso.
    (existingCancellationId ? reconciliarPedido(orderId) : Promise.resolve())
      .then(() => fetch(path))
      .then(async r => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? "Falha ao carregar cancelamento");
        return b;
      })
      .then(body => {
        if (!active) return;
        if (existingCancellationId) setCancelamento(body.cancelamento as Cancelamento);
        else {
          const p = body as CancelamentoPreview;
          setPreview(p);
          setAcao(p.estoque.acaoPadrao);
        }
      })
      .catch(e => active && setError(e.message))
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
      const response = await fetch(`/api/admin/pedidos/${orderId}/itens/${itemId}/cancelamentos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationKey: operationKey.current,
          motivo,
          estoqueAcao: acao,
          previewFingerprint: preview.previewFingerprint
        })
      });
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
    let key = leg.refundRemoto?.operationKey ?? refundKeys.current.get(leg.pagamentoAlocacaoId);
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
            confirmacao: true
          })
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Falha ao registrar devolução");
      if (body.refundStatus === "CONFIRMADO" || !body.refundStatus)
        refundKeys.current.delete(leg.pagamentoAlocacaoId);
      setCancelamento(body.cancelamento);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao registrar devolução");
    } finally {
      setSaving(false);
    }
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
        {loading && <div className="cancelpreview-state">Calculando impacto...</div>}
        {error && <div className="cancelpreview-error">{error}</div>}
        {preview && !cancelamento && (
          <CancelamentoItemPreviewSection
            preview={preview}
            saving={saving}
            disabled={!preview.cancelamentoExecutavel || saving}
            motivo={motivo}
            acao={acao}
            acaoDropdownOpen={acaoDropdownOpen}
            setMotivo={setMotivo}
            setAcao={setAcao}
            setAcaoDropdownOpen={setAcaoDropdownOpen}
            confirmar={confirmar}
            onClose={onClose}
          />
        )}
        {cancelamento && (
          <CancelamentoItemResultSection
            cancelamento={cancelamento}
            saving={saving}
            refund={refund}
            onClose={onClose}
          />
        )}
      </section>
    </div>,
    document.body
  );
}
