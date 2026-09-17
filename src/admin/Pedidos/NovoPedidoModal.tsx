import { useState, useRef, useEffect } from "react";
import { novaOperationKey } from "../../lib/operationKey";
import { createPortal } from "react-dom";
import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import "./NovoPedidoModal.css";

/* ── Icons ── */
const IconClose = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </svg>
);

const IconPlus = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <line x1="7" y1="2" x2="7" y2="12" />
    <line x1="2" y1="7" x2="12" y2="7" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="8"
    viewBox="0 0 12 8"
    fill="none"
    style={{
      transition: "transform 0.15s",
      transform: open ? "rotate(180deg)" : "rotate(0)",
    }}
  >
    <path
      d="M1 1.5L6 6.5L11 1.5"
      stroke="#634738"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconRemove = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <line x1="3" y1="3" x2="11" y2="11" />
    <line x1="11" y1="3" x2="3" y2="11" />
  </svg>
);

/* ── Types ── */
interface OrderItem {
  produtoId: number | null;
  quantidade: number;
}

type MetodoPagamento = "DINHEIRO" | "CARTAO" | "PIX_EXTERNO" | "A_COMBINAR";
type StatusPagamento = "PENDENTE" | "PAGO";

const METODO_OPTIONS: { value: MetodoPagamento; label: string }[] = [
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "CARTAO", label: "Cartão" },
  { value: "PIX_EXTERNO", label: "Pix externo" },
  { value: "A_COMBINAR", label: "A combinar" },
];

const STATUS_OPTIONS: { value: StatusPagamento; label: string }[] = [
  { value: "PENDENTE", label: "Aguardando pagamento" },
  { value: "PAGO", label: "Já pago" },
];

const MAX_ITENS_PEDIDO_MANUAL = 20;

const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const estoqueLivre = (p: ProdutoAdmin) => Math.max(0, p.estoque - p.estoque_reservado);

interface NovoPedidoModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

/* ── Custom Dropdown Hook ── */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return { open, setOpen, ref };
}

/* ── Component ── */
export default function NovoPedidoModal({
  open,
  onClose,
  onCreated,
}: NovoPedidoModalProps) {
  const [clientName, setClientName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [items, setItems] = useState<OrderItem[]>([
    { produtoId: null, quantidade: 1 },
  ]);
  const [metodoPagamento, setMetodoPagamento] = useState<MetodoPagamento>("DINHEIRO");
  const [statusPagamento, setStatusPagamento] = useState<StatusPagamento>("PENDENTE");
  const [observation, setObservation] = useState("");

  const [produtos, setProdutos] = useState<ProdutoAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A1: identidade da intenção de registrar ESTA venda. Precisa existir
  // antes do primeiro POST e continuar a mesma enquanto o conteúdo do
  // formulário for o mesmo — um retry depois de erro de rede ou de resposta
  // perdida recupera o pedido original em vez de criar um segundo pedido
  // (que, nascendo PAGO, também produziria uma segunda baixa de estoque).
  // Se o operador ALTERA o formulário e envia de novo, isso é uma intenção
  // diferente e recebe uma key nova.
  const operationKeyRef = useRef<string | null>(null);
  const assinaturaRef = useRef<string | null>(null);

  // Dropdowns for payment
  const payMethodDd = useDropdown();
  const payStatusDd = useDropdown();

  // Reseta o formulário e recarrega o catálogo toda vez que o modal abre —
  // sem isso, o state da última venda registrada ficaria vazando pra
  // próxima abertura (o componente nunca desmonta, só alterna `open`).
  useEffect(() => {
    if (!open) return;
    setClientName("");
    setWhatsapp("");
    setItems([{ produtoId: null, quantidade: 1 }]);
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
      .then(async (r) => {
        if (!r.ok) throw new Error("Falha ao carregar produtos");
        return r.json() as Promise<{ produtos: ProdutoAdmin[] }>;
      })
      .then((catalogo) => setProdutos(catalogo.produtos))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open]);

  const produtosSelecionaveis = produtos.filter(
    (p) => p.ativo === 1 && p.disponivel === 1 && estoqueLivre(p) > 0,
  );
  const produtoPorId = new Map(produtos.map((p) => [p.id, p]));

  const updateItem = (
    index: number,
    field: keyof OrderItem,
    value: number | null,
  ) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems((prev) =>
      prev.length >= MAX_ITENS_PEDIDO_MANUAL
        ? prev
        : [...prev, { produtoId: null, quantidade: 1 }],
    );
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

    if (items.length === 0 || items.some((i) => !i.produtoId)) {
      setError("Selecione um produto em todos os itens");
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
      itens: items.map((i) => ({
        produtoId: i.produtoId,
        quantidade: i.quantidade,
      })),
      clienteNome: clientName.trim(),
      clienteWhatsapp: whatsapp.trim(),
      observacao: observation.trim(),
      metodoPagamento,
      statusPagamento,
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
      body: JSON.stringify({ ...payload, operationKey: operationKeyRef.current }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao registrar pedido");
        }
        onCreated?.();
        onClose();
      })
      .catch((err) => setError(err.message))
      .finally(() => setSaving(false));
  };

  if (!open) return null;

  return createPortal(
    <div className="nped-overlay" onClick={onClose}>
      <div className="nped-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="nped-header">
          <div>
            <span className="nped-kicker">NOVO PEDIDO</span>
            <h2 className="nped-title">Registrar venda manual</h2>
            <p className="nped-subtitle">
              Balcão, WhatsApp, boca a boca ou pedido feito fora do site.
            </p>
          </div>
          <button className="nped-close" onClick={onClose}>
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
                <label>
                  Cliente <span className="nped-optional">opcional</span>
                </label>
                <input
                  type="text"
                  placeholder="Nome do cliente"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </div>
              <div className="nped-field">
                <label>
                  WhatsApp <span className="nped-optional">opcional</span>
                </label>
                <input
                  type="text"
                  placeholder="(31) 99999-9999"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                />
              </div>
            </div>

            {/* Itens */}
            <div className="nped-items-card">
              <div className="nped-items-header">
                <div>
                  <span className="nped-items-title">Itens</span>
                  <span className="nped-items-hint">
                    O estoque será reservado ao salvar.
                  </span>
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
                  key={i}
                  item={item}
                  produtos={produtosSelecionaveis}
                  onChangeProduct={(id) => updateItem(i, "produtoId", id)}
                  onChangeQty={(qty) => updateItem(i, "quantidade", qty)}
                  onRemove={() => removeItem(i)}
                  canRemove={items.length > 1}
                />
              ))}
            </div>

            {/* Pagamento */}
            <div className="nped-row-2">
              <div className="nped-field">
                <label>Forma de pagamento</label>
                <div
                  className={`nped-dropdown ${payMethodDd.open ? "nped-dropdown--open" : ""}`}
                  ref={payMethodDd.ref}
                >
                  <button
                    type="button"
                    className="nped-dropdown-trigger"
                    onClick={() => payMethodDd.setOpen(!payMethodDd.open)}
                  >
                    <span>
                      {METODO_OPTIONS.find((m) => m.value === metodoPagamento)?.label}
                    </span>
                    <IconChevron open={payMethodDd.open} />
                  </button>
                  {payMethodDd.open && (
                    <ul className="nped-dropdown-list">
                      {METODO_OPTIONS.filter(
                        (m) => statusPagamento !== "PAGO" || m.value !== "A_COMBINAR",
                      ).map((m) => (
                        <li key={m.value}>
                          <button
                            type="button"
                            className={`nped-dropdown-option ${metodoPagamento === m.value ? "nped-dropdown-option--active" : ""}`}
                            onClick={() => {
                              selecionarMetodo(m.value);
                              payMethodDd.setOpen(false);
                            }}
                          >
                            {m.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="nped-field">
                <label>Situação do pagamento</label>
                <div
                  className={`nped-dropdown ${payStatusDd.open ? "nped-dropdown--open" : ""}`}
                  ref={payStatusDd.ref}
                >
                  <button
                    type="button"
                    className="nped-dropdown-trigger"
                    onClick={() => payStatusDd.setOpen(!payStatusDd.open)}
                  >
                    <span>
                      {STATUS_OPTIONS.find((s) => s.value === statusPagamento)?.label}
                    </span>
                    <IconChevron open={payStatusDd.open} />
                  </button>
                  {payStatusDd.open && (
                    <ul className="nped-dropdown-list">
                      {STATUS_OPTIONS.filter(
                        (s) => metodoPagamento !== "A_COMBINAR" || s.value !== "PAGO",
                      ).map((s) => (
                        <li key={s.value}>
                          <button
                            type="button"
                            className={`nped-dropdown-option ${statusPagamento === s.value ? "nped-dropdown-option--active" : ""}`}
                            onClick={() => {
                              selecionarStatus(s.value);
                              payStatusDd.setOpen(false);
                            }}
                          >
                            {s.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Observação */}
            <div className="nped-field">
              <label>
                Observação <span className="nped-optional">opcional</span>
              </label>
              <textarea
                placeholder="Ex.: buscar amanhã às 15h"
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
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
    document.body,
  );
}

/* ── Product Item Row (sub-component) ── */
interface ProductItemRowProps {
  item: OrderItem;
  produtos: ProdutoAdmin[];
  onChangeProduct: (id: number | null) => void;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ProductItemRow({
  item,
  produtos,
  onChangeProduct,
  onChangeQty,
  onRemove,
  canRemove,
}: ProductItemRowProps) {
  const dd = useDropdown();
  const selected = item.produtoId
    ? produtos.find((p) => p.id === item.produtoId)
    : null;

  const formatProduct = (p: ProdutoAdmin) =>
    `${p.nome} ${p.emoji} · ${formatarPreco(p.preco_centavos)} · ${estoqueLivre(p)} disp.`;

  return (
    <div className="nped-item-row">
      <div className="nped-item-row-labels">
        <span className="nped-item-label nped-item-label--product">
          Produto
        </span>
        <span className="nped-item-label nped-item-label--qty">Qtd.</span>
      </div>
      <div className="nped-item-row-fields">
        {/* Product dropdown */}
        <div
          className={`nped-dropdown nped-dropdown--product ${dd.open ? "nped-dropdown--open" : ""}`}
          ref={dd.ref}
        >
          <button
            type="button"
            className="nped-dropdown-trigger"
            onClick={() => dd.setOpen(!dd.open)}
          >
            <span className={selected ? "" : "nped-placeholder"}>
              {selected ? formatProduct(selected) : "Selecionar produto..."}
            </span>
            <IconChevron open={dd.open} />
          </button>
          {dd.open && (
            <ul className="nped-dropdown-list nped-dropdown-list--products">
              {produtos.length === 0 && (
                <li>
                  <div className="nped-dropdown-option nped-placeholder">
                    Nenhum produto disponível
                  </div>
                </li>
              )}
              {produtos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`nped-dropdown-option ${item.produtoId === p.id ? "nped-dropdown-option--active" : ""}`}
                    onClick={() => {
                      onChangeProduct(p.id);
                      dd.setOpen(false);
                    }}
                  >
                    {formatProduct(p)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Qty */}
        <input
          type="number"
          className="nped-qty-input"
          min={1}
          max={selected ? estoqueLivre(selected) : undefined}
          value={item.quantidade}
          onChange={(e) => {
            const parsed = Math.max(1, parseInt(e.target.value) || 1);
            const limite = selected ? estoqueLivre(selected) : parsed;
            onChangeQty(Math.min(parsed, limite || 1));
          }}
        />

        {/* Remove */}
        <button
          type="button"
          className="nped-btn-remove"
          onClick={onRemove}
          disabled={!canRemove}
        >
          <IconRemove />
        </button>
      </div>
    </div>
  );
}
