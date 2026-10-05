import { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { novaOperationKey } from "../../lib/operationKey";
import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import { useAdminModal } from "../components/useAdminModal";
import { IconClose, IconPlus } from "../components/AdminIcons";
import { formatWhatsappBr, isValidWhatsappBr, normalizeWhatsappBr } from "../../../shared/whatsapp";
import {
  type OrderItem,
  type MetodoPagamento,
  type StatusPagamento,
  type NovoPedidoModalProps,
  MAX_ITENS_PEDIDO_MANUAL,
  newOrderItem,
  estoqueLivre
} from "./novoPedidoHelpers";
import ProductItemRow from "./NovoPedidoProductRow";
import NovoPedidoPagamentoSection from "./NovoPedidoPagamentoSection";
import "./NovoPedidoModal.css";

/* ── Component ── */
export default function NovoPedidoModal({ open, onClose, onCreated }: NovoPedidoModalProps) {
  const fieldId = useId();
  const [clientName, setClientName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [items, setItems] = useState<OrderItem[]>([newOrderItem()]);
  const [metodoPagamento, setMetodoPagamento] = useState<MetodoPagamento>("DINHEIRO");
  const [statusPagamento, setStatusPagamento] = useState<StatusPagamento>("PENDENTE");
  const [observation, setObservation] = useState("");

  const [produtos, setProdutos] = useState<ProdutoAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const modalProps = useAdminModal(open, onClose);

  // A1: identidade da intenção de registrar ESTA venda. Precisa existir
  // antes do primeiro POST e continuar a mesma enquanto o conteúdo do
  // formulário for o mesmo — um retry depois de erro de rede ou de resposta
  // perdida recupera o pedido original em vez de criar um segundo pedido
  // (que, nascendo PAGO, também produziria uma segunda baixa de estoque).
  // Se o operador ALTERA o formulário e envia de novo, isso é uma intenção
  // diferente e recebe uma key nova.
  const operationKeyRef = useRef<string | null>(null);
  const assinaturaRef = useRef<string | null>(null);

  // Reseta o formulário e recarrega o catálogo toda vez que o modal abre —
  // sem isso, o state da última venda registrada ficaria vazando pra
  // próxima abertura (o componente nunca desmonta, só alterna `open`).
  useEffect(() => {
    if (!open) return;
    setClientName("");
    setWhatsapp("");
    setItems([newOrderItem()]);
    setMetodoPagamento("DINHEIRO");
    setStatusPagamento("PENDENTE");
    setObservation("");
    setError(null);
    setSaving(false);
    setLoading(true);
    // Nova abertura do modal = nova intenção de venda.
    operationKeyRef.current = null;
    assinaturaRef.current = null;

    fetch("/api/admin/produtos")
      .then(async r => {
        if (!r.ok) throw new Error("Falha ao carregar produtos");
        return r.json() as Promise<{ produtos: ProdutoAdmin[] }>;
      })
      .then(catalogo => setProdutos(catalogo.produtos))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const produtosSelecionaveis = produtos.filter(
    p => p.ativo === 1 && p.disponivel === 1 && estoqueLivre(p) > 0
  );
  const produtoPorId = new Map(produtos.map(p => [p.id, p]));

  const updateItem = (index: number, field: keyof OrderItem, value: number | null) => {
    setItems(prev => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems(prev => (prev.length >= MAX_ITENS_PEDIDO_MANUAL ? prev : [...prev, newOrderItem()]));
  };

  const selecionarMetodo = (m: MetodoPagamento) => {
    setMetodoPagamento(m);
    // Regra simétrica: A_COMBINAR nunca convive com "Já pago", não importa
    // a ordem em que os dois campos são preenchidos.
    if (m === "A_COMBINAR") setStatusPagamento("PENDENTE");
  };

  const selecionarStatus = (s: StatusPagamento) => {
    setStatusPagamento(s);
    if (s === "PAGO" && metodoPagamento === "A_COMBINAR") {
      setMetodoPagamento("DINHEIRO");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (items.length === 0 || items.some(i => !i.produtoId)) {
      setError("Selecione um produto em todos os itens");
      return;
    }
    if (whatsapp && !isValidWhatsappBr(whatsapp)) {
      setError("Informe um WhatsApp brasileiro válido com DDD");
      return;
    }
    for (const item of items) {
      const produto = item.produtoId ? produtoPorId.get(item.produtoId) : null;
      if (produto && item.quantidade > estoqueLivre(produto)) {
        setError(`Quantidade acima do estoque disponível para "${produto.nome}"`);
        return;
      }
    }

    const payload = {
      itens: items.map(i => ({
        produtoId: i.produtoId,
        quantidade: i.quantidade
      })),
      clienteNome: clientName.trim(),
      clienteWhatsapp: normalizeWhatsappBr(whatsapp),
      observacao: observation.trim(),
      metodoPagamento,
      statusPagamento
    };

    // Mesmo conteúdo => mesma key (retry da mesma intenção).
    // Conteúdo alterado => key nova (intenção diferente).
    const assinatura = JSON.stringify(payload);
    if (assinaturaRef.current !== assinatura || !operationKeyRef.current) {
      operationKeyRef.current = novaOperationKey();
      assinaturaRef.current = assinatura;
    }

    setSaving(true);
    fetch("/api/admin/pedidos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, operationKey: operationKeyRef.current })
    })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao registrar pedido");
        }
        onCreated?.();
        onClose();
      })
      .catch(err => setError(err.message))
      .finally(() => setSaving(false));
  };

  if (!open) return null;

  return createPortal(
    <div className="nped-overlay" {...modalProps}>
      <div className="nped-modal">
        {/* ── Header ── */}
        <div className="nped-header">
          <div>
            <span className="nped-kicker">NOVO PEDIDO</span>
            <h2 className="nped-title">Registrar venda manual</h2>
            <p className="nped-subtitle">
              Balcão, WhatsApp, boca a boca ou pedido feito fora do site.
            </p>
          </div>
          <button
            type="button"
            className="nped-close"
            aria-label="Fechar novo pedido"
            onClick={onClose}
          >
            <IconClose />
          </button>
        </div>

        <div className="nped-divider" />

        {loading && <div className="nped-body">Carregando...</div>}

        {!loading && (
          <form className="nped-body" onSubmit={handleSubmit}>
            {error && <p className="nped-error">{error}</p>}

            {/* Cliente + WhatsApp */}
            <div className="nped-row-2">
              <div className="nped-field">
                <label htmlFor={`${fieldId}-cliente`}>
                  Cliente <span className="nped-optional">opcional</span>
                </label>
                <input
                  id={`${fieldId}-cliente`}
                  type="text"
                  placeholder="Nome do cliente"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                />
              </div>
              <div className="nped-field">
                <label htmlFor={`${fieldId}-whatsapp`}>
                  WhatsApp <span className="nped-optional">opcional</span>
                </label>
                <input
                  id={`${fieldId}-whatsapp`}
                  type="tel"
                  placeholder="(31) 99999-9999"
                  value={whatsapp}
                  onChange={e => setWhatsapp(formatWhatsappBr(e.target.value))}
                  inputMode="tel"
                  maxLength={15}
                />
              </div>
            </div>

            {/* Itens */}
            <div className="nped-items-card">
              <div className="nped-items-header">
                <div>
                  <span className="nped-items-title">Itens</span>
                  <span className="nped-items-hint">O estoque será reservado ao salvar.</span>
                </div>
                <button
                  type="button"
                  className="nped-btn-add-item"
                  onClick={addItem}
                  disabled={items.length >= MAX_ITENS_PEDIDO_MANUAL}
                >
                  <IconPlus /> Adicionar item
                </button>
              </div>

              {items.map((item, i) => (
                <ProductItemRow
                  key={item.id}
                  item={item}
                  produtos={produtosSelecionaveis}
                  onChangeProduct={id => updateItem(i, "produtoId", id)}
                  onChangeQty={qty => updateItem(i, "quantidade", qty)}
                  onRemove={() => removeItem(i)}
                  canRemove={items.length > 1}
                />
              ))}
            </div>

            {/* Pagamento */}
            <NovoPedidoPagamentoSection
              fieldId={fieldId}
              metodoPagamento={metodoPagamento}
              statusPagamento={statusPagamento}
              onSelectMetodo={selecionarMetodo}
              onSelectStatus={selecionarStatus}
            />

            {/* Observação */}
            <div className="nped-field">
              <label htmlFor={`${fieldId}-observacao`}>
                Observação <span className="nped-optional">opcional</span>
              </label>
              <textarea
                id={`${fieldId}-observacao`}
                placeholder="Ex.: buscar amanhã às 15h"
                value={observation}
                onChange={e => setObservation(e.target.value)}
                rows={3}
              />
            </div>

            {/* Footer */}
            <div className="nped-footer">
              <button type="button" className="nped-btn-cancel" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="nped-btn-save" disabled={saving}>
                Registrar pedido
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
