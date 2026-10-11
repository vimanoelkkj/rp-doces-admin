import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { precoVigenteCentavos } from "../../../shared/promocao";
import { novaOperationKey } from "../../lib/operationKey";
import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import { useAdminModal } from "../components/useAdminModal";
import { reconciliarPedido } from "./reconciliarPedido";
import TrocarItemFormSection from "./TrocarItemFormSection";
import TrocarItemExchangeSection from "./TrocarItemExchangeSection";
import {
  money,
  type Exchange,
  type Preview,
  type RefundLeg,
  type TrocarItemModalProps
} from "./trocarItemHelpers";
import "./AdicionarItemModal.css";
import "./CancelamentoItemPreviewModal.css";

const TROCA_INCERTA =
  "Não foi possível confirmar o resultado da troca. Confira o pedido antes de tentar de novo.";
const ERRO_TELA =
  "Erro inesperado na tela ao concluir a operação. Atualize o pedido e confira o resultado antes de tentar de novo.";
const DEVOLUCAO_INCERTA =
  "Não foi possível confirmar a devolução. Tente de novo: a mesma operação é reaproveitada, sem duplicar.";

export default function TrocarItemModal({
  orderId,
  item,
  existingExchangeId,
  existingExchangeStatus,
  onClose,
  onChanged
}: TrocarItemModalProps) {
  const modalProps = useAdminModal(true, onClose);
  const [products, setProducts] = useState<ProdutoAdmin[]>([]);
  const [productId, setProductId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [action, setAction] = useState(
    item.estoque_estado === "RESERVADO"
      ? "LIBERAR_RESERVA"
      : item.estoque_estado === "BAIXADO"
        ? "NAO_REPOR"
        : "NENHUMA"
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: existingExchangeStatus é gatilho deliberado: a mudança do status da troca (ex.: AGUARDANDO_COBRANCA para CONCLUIDA) exige nova releitura
  useEffect(() => {
    let active = true;
    if (existingExchangeId) {
      // O GET é somente leitura: a retomada de refund/finalização pendente é
      // pedida antes, de forma explícita.
      reconciliarPedido(orderId)
        .then(() => fetch(`/api/admin/pedidos/${orderId}/itens/${item.id}/trocas`))
        .then(async r => {
          const b = await r.json().catch(() => null);
          if (!r.ok) throw new Error(b?.error || "Falha ao carregar a troca");
          if (!b?.troca) throw new Error("Resposta inesperada ao carregar a troca");
          return b;
        })
        .then(b => {
          if (active) {
            setExchange(b.troca);
            setError(null);
          }
        })
        .catch(e => {
          if (active) setError(e instanceof TypeError ? "Falha ao carregar a troca" : e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }
    fetch("/api/admin/produtos")
      .then(async r => {
        const b = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(b?.produtos)) throw new Error("Falha ao carregar produtos");
        return b as { produtos: ProdutoAdmin[] };
      })
      .then(b => {
        if (active) {
          setProducts(b.produtos.filter(p => p.ativo === 1 && p.disponivel === 1));
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
  const product = products.find(p => p.id === productId) ?? null;
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
      estoqueAcaoOrigem: action
    });
    fetch(`/api/admin/pedidos/${orderId}/itens/${item.id}/troca-preview?${query}`)
      .then(async r => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error ?? "Falha ao calcular troca");
        return b as Preview;
      })
      .then(p => {
        if (active) {
          setPreview(p);
          setError(null);
        }
      })
      .catch(
        e => active && setError(e instanceof TypeError ? "Falha ao calcular troca" : e.message)
      );
    return () => {
      active = false;
    };
  }, [action, item.id, orderId, price, product, quantity]);
  // O fato financeiro ja foi aplicado quando isto roda: falha ao atualizar a lista nao pode
  // virar "resultado incerto" nem reabrir a operacao.
  const notificarMudanca = async (rotulo: string) => {
    try {
      await onChanged();
    } catch (err) {
      console.error(`Falha ao atualizar apos ${rotulo}`, err);
    }
  };
  const confirm = async () => {
    if (!preview || !product || saving) return;
    const signature = JSON.stringify({
      productId: product.id,
      quantity,
      price,
      action,
      preview: preview.previewFingerprint
    });
    if (signatureRef.current !== signature) {
      keyRef.current = novaOperationKey();
      signatureRef.current = signature;
    }
    setSaving(true);
    setError(null);
    try {
      // Perda de rede: a requisicao pode ter chegado. Nao e falha definitiva.
      const r = await fetch(`/api/admin/pedidos/${orderId}/itens/${item.id}/trocas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationKey: keyRef.current,
          produtoDestinoId: product.id,
          quantidadeDestino: quantity,
          precoEsperadoCentavos: price,
          estoqueAcaoOrigem: action,
          previewFingerprint: preview.previewFingerprint
        })
      }).catch(() => {
        throw new Error(TROCA_INCERTA);
      });
      // 5xx ou corpo ilegivel (HTML de gateway): a troca pode ter sido aplicada.
      const b = await r.json().catch(() => null);
      if (!r.ok) {
        const incerto = b === null || r.status >= 500;
        throw new Error(incerto ? TROCA_INCERTA : (b.error ?? "Falha ao executar troca"));
      }
      if (!b?.troca) throw new Error(TROCA_INCERTA);
      setExchange(b.troca);
      // Fato ja aplicado: falha ao atualizar a lista nao pode virar "resultado incerto".
      await notificarMudanca("troca");
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : ERRO_TELA);
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
      const r = await fetch(`/api/admin/pedidos/${orderId}/trocas/${exchange.id}/reembolsos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationKey: key,
          pagamentoId: leg.pagamentoId,
          pagamentoAlocacaoId: leg.pagamentoAlocacaoId,
          valorCentavos: leg.valorCentavos,
          confirmacao: true
        })
      }).catch(() => {
        throw new Error(DEVOLUCAO_INCERTA);
      });
      const b = await r.json().catch(() => null);
      if (!r.ok) {
        const incerto = b === null || r.status >= 500;
        throw new Error(incerto ? DEVOLUCAO_INCERTA : (b.error ?? "Falha ao registrar devolução"));
      }
      if (!b?.troca) throw new Error(DEVOLUCAO_INCERTA);
      if (b.refundStatus === "CONFIRMADO" || !b.refundStatus)
        refundKeys.current.delete(leg.pagamentoAlocacaoId);
      setExchange(b.troca);
      await notificarMudanca("devolucao");
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : ERRO_TELA);
    } finally {
      setSaving(false);
    }
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
          <button type="button" className="additem-close" onClick={onClose}>
            ×
          </button>
        </header>
        {loading && <div className="additem-loading">Carregando...</div>}
        {error && <p className="additem-error">{error}</p>}
        {!exchange && !loading && (
          <TrocarItemFormSection
            item={item}
            products={products}
            productId={productId}
            quantity={quantity}
            action={action}
            preview={preview}
            saving={saving}
            disabled={!preview?.trocaExecutavel || saving}
            productDropdownOpen={productDropdownOpen}
            actionDropdownOpen={actionDropdownOpen}
            setProductId={setProductId}
            setQuantity={setQuantity}
            setAction={setAction}
            setProductDropdownOpen={setProductDropdownOpen}
            setActionDropdownOpen={setActionDropdownOpen}
            onClose={onClose}
            onConfirm={confirm}
          />
        )}
        {exchange && (
          <TrocarItemExchangeSection
            exchange={exchange}
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
