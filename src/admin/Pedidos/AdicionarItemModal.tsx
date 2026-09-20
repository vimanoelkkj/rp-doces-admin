import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { precoVigenteCentavos } from "../../../shared/promocao";
import { novaOperationKey } from "../../lib/operationKey";
import type { ProdutoAdmin } from "../Produtos/AdminProdutos";
import { useAdminModal } from "../components/useAdminModal";
import "./AdicionarItemModal.css";

interface AdicionarItemModalProps {
  orderId: number;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}

interface PrecoAlterado {
  anteriorCentavos: number;
  atualCentavos: number;
}

interface ErroApi {
  error?: string;
  code?: string;
  precoAtualCentavos?: number;
}

const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const estoqueLivre = (produto: ProdutoAdmin) =>
  Math.max(0, produto.estoque - produto.estoque_reservado);

export default function AdicionarItemModal({
  orderId,
  onClose,
  onAdded,
}: AdicionarItemModalProps) {
  const modalProps = useAdminModal(true, onClose);
  const [produtos, setProdutos] = useState<ProdutoAdmin[]>([]);
  const [produtoId, setProdutoId] = useState<number | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [precoAlterado, setPrecoAlterado] = useState<PrecoAlterado | null>(null);
  const [produtoDropdownAberto, setProdutoDropdownAberto] = useState(false);
  const savingRef = useRef(false);
  const operationKeyRef = useRef<string | null>(null);
  const assinaturaRef = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/produtos")
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({})) as ErroApi;
          throw new Error(body.error ?? "Falha ao carregar produtos");
        }
        return response.json() as Promise<{ produtos: ProdutoAdmin[] }>;
      })
      .then(({ produtos: catalogo }) => {
        setProdutos(catalogo.filter(
          (produto) => produto.ativo === 1
            && produto.disponivel === 1
            && estoqueLivre(produto) > 0,
        ));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar produtos"))
      .finally(() => setLoading(false));
  }, []);

  const produto = produtos.find((item) => item.id === produtoId) ?? null;
  const precoCentavos = produto ? precoVigenteCentavos(produto) : 0;
  const quantidadeValida = Number.isInteger(quantidade)
    && quantidade >= 1
    && quantidade <= 50
    && !!produto
    && quantidade <= estoqueLivre(produto);

  const selecionarProduto = (id: number | null) => {
    setProdutoId(id);
    setQuantidade(1);
    setError(null);
    setPrecoAlterado(null);
  };

  const enviar = async (precoEsperadoCentavos: number, novaIntencao = false) => {
    if (savingRef.current || !produto || !quantidadeValida) return;
    const assinatura = JSON.stringify({
      pedidoId: orderId,
      produtoId: produto.id,
      quantidade,
      precoEsperadoCentavos,
    });
    if (novaIntencao || assinaturaRef.current !== assinatura || !operationKeyRef.current) {
      operationKeyRef.current = novaOperationKey();
      assinaturaRef.current = assinatura;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    if (novaIntencao) setPrecoAlterado(null);
    try {
      const response = await fetch(`/api/admin/pedidos/${orderId}/itens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationKey: operationKeyRef.current,
          produtoId: produto.id,
          quantidade,
          precoEsperadoCentavos,
        }),
      });
      const body = await response.json().catch(() => ({})) as ErroApi;
      if (!response.ok) {
        if (response.status === 409
            && body.code === "PRECO_ALTERADO"
            && Number.isSafeInteger(body.precoAtualCentavos)) {
          setPrecoAlterado({
            anteriorCentavos: precoEsperadoCentavos,
            atualCentavos: Number(body.precoAtualCentavos),
          });
          // A confirmacao explicita abaixo representa uma nova intencao.
          // A nova key so nasce no clique, nunca automaticamente aqui.
          operationKeyRef.current = null;
          assinaturaRef.current = null;
          return;
        }
        throw new Error(body.error ?? "Não foi possível adicionar o produto");
      }

      await onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha de rede ao adicionar produto");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!produto) {
      setError("Selecione um produto");
      return;
    }
    if (!quantidadeValida) {
      setError(`Informe uma quantidade entre 1 e ${Math.min(50, estoqueLivre(produto))}`);
      return;
    }
    void enviar(precoCentavos);
  };

  return createPortal(
    <div className="additem-overlay" {...modalProps}>
      <section className="additem-card" role="dialog" aria-modal="true" aria-labelledby="additem-title">
        <header className="additem-header">
          <div>
            <span className="additem-kicker">COMANDA #{orderId}</span>
            <h2 id="additem-title">Adicionar produto</h2>
            <p>O preço e o estoque serão confirmados pelo servidor.</p>
          </div>
          <button type="button" className="additem-close" onClick={onClose} disabled={saving} aria-label="Fechar">
            ×
          </button>
        </header>

        {loading ? (
          <div className="additem-loading">Carregando produtos...</div>
        ) : (
          <form className="additem-form" onSubmit={handleSubmit}>
            {error && <p className="additem-error" role="alert">{error}</p>}

            <label className="additem-field">
              <span>Produto</span>
              <div className={`additem-dropdown${produtoDropdownAberto ? " additem-dropdown--open" : ""}`}>
                <button
                  type="button"
                  className="additem-dropdown-trigger"
                  onClick={() => setProdutoDropdownAberto((open) => !open)}
                  onBlur={() => setTimeout(() => setProdutoDropdownAberto(false), 150)}
                  disabled={saving}
                >
                  <span>
                    {produto
                      ? `${produto.emoji ? `${produto.emoji} ` : ""}${produto.nome} · ${formatarPreco(precoVigenteCentavos(produto))}`
                      : "Selecione um produto"}
                  </span>
                  <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
                    <path d="M1 1.5L6 6.5L11 1.5" stroke="#634738" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {produtoDropdownAberto && (
                  <ul className="additem-dropdown-list">
                    {produtos.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`additem-dropdown-option${produtoId === item.id ? " additem-dropdown-option--active" : ""}`}
                          onClick={() => {
                            selecionarProduto(item.id);
                            setProdutoDropdownAberto(false);
                          }}
                        >
                          {item.emoji ? `${item.emoji} ` : ""}{item.nome} · {formatarPreco(precoVigenteCentavos(item))}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>

            {produto && (
              <div className="additem-product-summary">
                <div>
                  <span>Preço atual</span>
                  <strong>{formatarPreco(precoCentavos)}</strong>
                </div>
                <div>
                  <span>Disponível</span>
                  <strong>{estoqueLivre(produto)}</strong>
                </div>
              </div>
            )}

            <label className="additem-field">
              <span>Quantidade</span>
              <input
                type="number"
                min="1"
                max={produto ? Math.min(50, estoqueLivre(produto)) : 50}
                value={quantidade}
                onChange={(event) => {
                  setQuantidade(Number(event.target.value));
                  setError(null);
                  setPrecoAlterado(null);
                }}
                disabled={!produto || saving}
              />
            </label>

            <div className="additem-subtotal" aria-live="polite">
              <span>Subtotal</span>
              <strong>{formatarPreco(quantidadeValida ? precoCentavos * quantidade : 0)}</strong>
            </div>

            {precoAlterado && (
              <div className="additem-price-change" role="alert">
                <strong>O preço mudou</strong>
                <span>
                  Antes: {formatarPreco(precoAlterado.anteriorCentavos)} · Agora: {formatarPreco(precoAlterado.atualCentavos)}
                </span>
                <button
                  type="button"
                  onClick={() => void enviar(precoAlterado.atualCentavos, true)}
                  disabled={saving}
                >
                  Confirmar por {formatarPreco(precoAlterado.atualCentavos)}
                </button>
              </div>
            )}

            <footer className="additem-actions">
              <button type="button" className="additem-cancel" onClick={onClose} disabled={saving}>
                Voltar
              </button>
              <button type="submit" className="additem-confirm" disabled={!quantidadeValida || saving || !!precoAlterado}>
                {saving ? "Adicionando..." : "Adicionar à comanda"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>,
    document.body,
  );
}
