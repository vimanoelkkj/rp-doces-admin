import { useId } from "react";
import { createPortal } from "react-dom";
import { ALERGENICOS_MAX, INGREDIENTES_MAX, PESO_TEXTO_MAX } from "../../../shared/produtoDetalhes";
import { formatBrlInput } from "../../lib/brl";
import { IconClose } from "../components/AdminIcons";
import { useAdminModal } from "../components/useAdminModal";
import type { ProdutoAdmin } from "./AdminProdutos";
import { EMOJI_OPTIONS } from "./EmojiIcons";
import ProdutoClassificacaoRow from "./ProdutoClassificacaoRow";
import ProdutoFotoSection from "./ProdutoFotoSection";
import ProdutoPromocaoSection from "./ProdutoPromocaoSection";
import { imageUrlFor } from "./novoProdutoHelpers";
import { useProdutoForm } from "./useProdutoForm";
import "./NovoProdutoModal.css";

export { imageUrlFor };

interface NovoProdutoModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  produto?: ProdutoAdmin | null;
}

export default function NovoProdutoModal({
  open,
  onClose,
  onSaved,
  produto
}: NovoProdutoModalProps) {
  const fieldId = useId();
  const modalProps = useAdminModal(open, onClose);

  const {
    form,
    setField,
    categorias,
    isEdit,
    stockMetrics,
    saving,
    error,
    setError,
    uploadingImage,
    setUploadingImage,
    setImagePreview,
    handleSubmit
  } = useProdutoForm({ open, onClose, onSaved, produto });

  if (!open) return null;

  return createPortal(
    <div className="np-overlay" {...modalProps}>
      <div className="np-modal">
        <div className="np-header">
          <div>
            <span className="np-kicker">CATÁLOGO</span>
            <h2 className="np-title">{isEdit ? "Editar produto" : "Novo produto"}</h2>
            <p className="np-subtitle">
              {isEdit
                ? "Atualize as informações deste doce no catálogo."
                : "Cadastre um doce e ele já entra no catálogo administrativo."}
            </p>
          </div>
          <button type="button" className="np-close" aria-label="Fechar produto" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <form className="np-body" onSubmit={handleSubmit}>
          <div className="np-field np-field--full">
            <label htmlFor={`${fieldId}-nome`}>NOME</label>
            <input
              id={`${fieldId}-nome`}
              type="text"
              placeholder="Ex.: Bolo no pote de morango"
              value={form.name}
              onChange={e => setField("name", e.target.value)}
            />
          </div>

          <ProdutoClassificacaoRow
            fieldId={fieldId}
            category={form.category}
            categorias={categorias}
            onSelectCategory={catId => setField("category", catId)}
            stock={form.stock}
            onChangeStock={stock => setField("stock", stock)}
            isEdit={isEdit}
            stockMetrics={stockMetrics}
          />

          <fieldset className="np-field np-field--full np-emoji-fieldset">
            <legend>EMOJI</legend>
            <div className="np-emoji-grid">
              {EMOJI_OPTIONS.map((e, i) => (
                <div className="np-emoji-choice" key={e.char}>
                  <input
                    id={`${fieldId}-emoji-${i}`}
                    className="np-emoji-radio"
                    type="radio"
                    name={`${fieldId}-emoji`}
                    value={e.char}
                    checked={form.selectedEmoji === i}
                    onChange={() => setField("selectedEmoji", i)}
                  />
                  <label
                    htmlFor={`${fieldId}-emoji-${i}`}
                    className={`np-emoji-item${form.selectedEmoji === i ? " np-emoji-item--active" : ""}`}
                  >
                    <span className="np-emoji-icon">{e.icon}</span>
                    <span className="np-emoji-label">{e.label}</span>
                  </label>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="np-field np-field--full">
            <label htmlFor={`${fieldId}-preco`}>PREÇO</label>
            <input
              id={`${fieldId}-preco`}
              type="text"
              placeholder="0,00"
              value={form.price}
              onChange={e => setField("price", formatBrlInput(e.target.value))}
              inputMode="decimal"
            />
          </div>

          <ProdutoFotoSection
            fieldId={fieldId}
            isEdit={isEdit}
            produtoId={produto?.id}
            imagePreview={form.imagePreview}
            uploadingImage={uploadingImage}
            setUploadingImage={setUploadingImage}
            setImagePreview={setImagePreview}
            onError={setError}
            onSaved={onSaved}
          />

          <div className="np-field np-field--full">
            <label htmlFor={`${fieldId}-descricao`}>DESCRIÇÃO</label>
            <textarea
              id={`${fieldId}-descricao`}
              placeholder="Uma descrição curta do produto."
              value={form.description}
              onChange={e => setField("description", e.target.value)}
              rows={4}
            />
          </div>

          <div className="np-field np-field--full">
            <label htmlFor="np-peso">PESO / PORÇÃO</label>
            <input
              id="np-peso"
              type="text"
              placeholder="Ex.: 220 g"
              value={form.pesoTexto}
              onChange={e => setField("pesoTexto", e.target.value)}
              maxLength={PESO_TEXTO_MAX}
            />
          </div>

          <div className="np-field np-field--full">
            <label htmlFor="np-ingredientes">INGREDIENTES</label>
            <textarea
              id="np-ingredientes"
              placeholder="Ex.: leite condensado, creme de leite, frutas vermelhas…"
              value={form.ingredientes}
              onChange={e => setField("ingredientes", e.target.value)}
              maxLength={INGREDIENTES_MAX}
              rows={3}
            />
          </div>

          <div className="np-field np-field--full">
            <label htmlFor="np-alergenicos">ALÉRGENOS — OPCIONAL</label>
            <textarea
              id="np-alergenicos"
              placeholder="Ex.: contém leite e derivados. Pode conter traços de glúten."
              value={form.alergenicos}
              onChange={e => setField("alergenicos", e.target.value)}
              maxLength={ALERGENICOS_MAX}
              rows={2}
            />
          </div>

          <div className="np-checks-grid">
            <label className="np-check">
              <input
                type="checkbox"
                checked={form.produtoAtivo}
                onChange={e => setField("produtoAtivo", e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Produto ativo</strong>
                <span>Disponível para aparecer no catálogo.</span>
              </div>
            </label>
            <label className="np-check">
              <input
                type="checkbox"
                checked={form.destaque}
                onChange={e => setField("destaque", e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Marcar como destaque</strong>
                <span>Exibe o selo de destaque no produto.</span>
              </div>
            </label>
            <label className="np-check">
              <input
                type="checkbox"
                checked={form.novo}
                onChange={e => setField("novo", e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Marcar como novo</strong>
                <span>Exibe o selo de novidade no produto.</span>
              </div>
            </label>
            <label className="np-check">
              <input
                type="checkbox"
                checked={form.disponivelVenda}
                onChange={e => setField("disponivelVenda", e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Disponível para venda</strong>
                <span>Controla a disponibilidade sem arquivar.</span>
              </div>
            </label>
            <label className="np-check">
              <input
                type="checkbox"
                checked={form.promocao}
                onChange={e => setField("promocao", e.target.checked)}
              />
              <span className="np-check-box" />
              <div>
                <strong>Promoção</strong>
                <span>Ativa preço promocional e agendamento.</span>
              </div>
            </label>
          </div>

          {/* HUMAN-12: os campos da promoção só aparecem com o checkbox
              ligado — antes ele não configurava nada. Mesma linguagem visual
              do resto do formulário (np-field / np-row-2), sem modal novo. */}
          {form.promocao && (
            <ProdutoPromocaoSection
              fieldId={fieldId}
              price={form.price}
              promoPrice={form.promoPrice}
              setPromoPrice={val => setField("promoPrice", val)}
              promoInicio={form.promoInicio}
              setPromoInicio={val => setField("promoInicio", val)}
              promoFim={form.promoFim}
              setPromoFim={val => setField("promoFim", val)}
            />
          )}

          {error && <p className="np-error">{error}</p>}

          <div className="np-footer">
            <button type="button" className="np-btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="np-btn-save" disabled={saving}>
              {saving ? "Salvando…" : isEdit ? "Salvar alterações" : "Salvar produto"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
