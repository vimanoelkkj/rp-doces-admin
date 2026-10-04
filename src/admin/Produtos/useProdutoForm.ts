import { useCallback, useEffect, useState } from "react";
import { formatCentsAsBrlInput } from "../../lib/brl";
import type { ProdutoAdmin } from "./AdminProdutos";
import { EMOJI_OPTIONS } from "./EmojiIcons";
import {
  type Categoria,
  imageUrlFor,
  isoParaDatetimeLocal,
  validarProdutoForm
} from "./novoProdutoHelpers";

export interface ProdutoFormState {
  name: string;
  category: string;
  stock: string;
  selectedEmoji: number | null;
  price: string;
  description: string;
  pesoTexto: string;
  ingredientes: string;
  alergenicos: string;
  imagePreview: string | null;
  produtoAtivo: boolean;
  disponivelVenda: boolean;
  destaque: boolean;
  novo: boolean;
  promocao: boolean;
  promoPrice: string;
  promoInicio: string;
  promoFim: string;
}

const INITIAL_FORM_STATE: ProdutoFormState = {
  name: "",
  category: "",
  stock: "0",
  selectedEmoji: null,
  price: "0,00",
  description: "",
  pesoTexto: "",
  ingredientes: "",
  alergenicos: "",
  imagePreview: null,
  produtoAtivo: true,
  disponivelVenda: true,
  destaque: false,
  novo: false,
  promocao: false,
  promoPrice: "0,00",
  promoInicio: "",
  promoFim: ""
};

interface UseProdutoFormOptions {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  produto?: ProdutoAdmin | null;
}

export function useProdutoForm({ open, onClose, onSaved, produto }: UseProdutoFormOptions) {
  const isEdit = produto != null;
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [form, setForm] = useState<ProdutoFormState>(INITIAL_FORM_STATE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const setField = useCallback(
    <K extends keyof ProdutoFormState>(key: K, value: ProdutoFormState[K]) => {
      setForm(prev => ({ ...prev, [key]: value }));
    },
    []
  );

  const setImagePreview = useCallback((preview: string | null) => {
    setForm(prev => ({ ...prev, imagePreview: preview }));
  }, []);

  const resetForm = useCallback(() => {
    setForm({
      ...INITIAL_FORM_STATE,
      category: categorias[0]?.id ?? ""
    });
    setError(null);
  }, [categorias]);

  // Carrega lista de categorias ao abrir o modal
  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/categorias")
      .then(async response => {
        if (!response.ok) throw new Error("Falha ao carregar categorias");
        return response.json() as Promise<{ categorias: Categoria[] }>;
      })
      .then(data => {
        setCategorias(data.categorias);
        setForm(prev => ({
          ...prev,
          category: prev.category || data.categorias[0]?.id || ""
        }));
      })
      .catch(() => setCategorias([]));
  }, [open]);

  // Popula formulário ao abrir para edição ou reseta ao abrir para criação
  // biome-ignore lint/correctness/useExhaustiveDependencies: o efeito só roda ao abrir ou trocar de produto; resetForm nas deps apagaria o formulário digitado
  useEffect(() => {
    if (!open) return;
    if (!produto) {
      resetForm();
      return;
    }
    const emojiIndex = EMOJI_OPTIONS.findIndex(e => e.char === produto.emoji);
    setForm({
      name: produto.nome,
      category: produto.categoria,
      stock: String(produto.estoque),
      selectedEmoji: emojiIndex >= 0 ? emojiIndex : null,
      price: formatCentsAsBrlInput(produto.preco_centavos),
      description: produto.descricao,
      pesoTexto: produto.peso_texto ?? "",
      ingredientes: produto.ingredientes ?? "",
      alergenicos: produto.alergenicos ?? "",
      imagePreview: imageUrlFor(produto.image_key),
      produtoAtivo: produto.ativo === 1,
      disponivelVenda: produto.disponivel === 1,
      destaque: produto.destaque === 1,
      novo: produto.novo === 1,
      promocao: produto.promocao_ativa === 1,
      promoPrice:
        produto.preco_promocional_centavos != null
          ? formatCentsAsBrlInput(produto.preco_promocional_centavos)
          : "0,00",
      promoInicio: isoParaDatetimeLocal(produto.promocao_inicio),
      promoFim: isoParaDatetimeLocal(produto.promocao_fim)
    });
    setError(null);
  }, [open, produto]);

  // Métricas derivadas de estoque
  const estoqueReservado = isEdit ? Math.max(0, produto?.estoque_reservado ?? 0) : 0;
  const estoqueAtual = /^\d+$/.test(form.stock) ? Number(form.stock) : 0;
  const estoqueLivre = Math.max(0, estoqueAtual - estoqueReservado);
  const estoqueAbaixoDaReserva = isEdit && estoqueAtual < estoqueReservado;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const validacao = validarProdutoForm({
      price: form.price,
      stock: form.stock,
      promocao: form.promocao,
      promoPrice: form.promoPrice,
      promoInicio: form.promoInicio,
      promoFim: form.promoFim
    });

    if (!validacao.sucesso) {
      setError(validacao.erro);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const url = isEdit ? `/api/admin/produtos/${produto.id}` : "/api/admin/produtos";
      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: form.name,
          categoria: form.category,
          descricao: form.description,
          pesoTexto: form.pesoTexto.trim(),
          ingredientes: form.ingredientes.trim(),
          alergenicos: form.alergenicos.trim(),
          precoCentavos: validacao.dados.precoCentavos,
          estoque: validacao.dados.estoque,
          emoji: form.selectedEmoji != null ? EMOJI_OPTIONS[form.selectedEmoji].char : "",
          ativo: form.produtoAtivo,
          disponivel: form.disponivelVenda,
          destaque: form.destaque,
          novo: form.novo,
          promocaoAtiva: form.promocao,
          precoPromocionalCentavos: validacao.dados.promoCentavos,
          promocaoInicio: validacao.dados.promoInicioIso,
          promocaoFim: validacao.dados.promoFimIso
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Falha ao salvar produto");
      }
      resetForm();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar produto");
    } finally {
      setSaving(false);
    }
  };

  return {
    form,
    setField,
    categorias,
    isEdit,
    stockMetrics: {
      estoqueReservado,
      estoqueAtual,
      estoqueLivre,
      estoqueAbaixoDaReserva
    },
    saving,
    error,
    setError,
    uploadingImage,
    setUploadingImage,
    setImagePreview,
    handleSubmit
  };
}
