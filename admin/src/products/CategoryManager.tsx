import { useEffect, useRef, useState } from "react";
import { usePageScrollLock } from "../shared/usePageScrollLock";
import {
  createCategory,
  listAllCategories,
  ProductApiError,
  type Category
} from "./product.api";
import styles from "./CategoryManager.module.css";

type Props = {
  onClose: () => void;
};

type FormState = {
  nome: string;
  emoji: string;
  descricao: string;
};

const EMOJI_OPTIONS = ["🍰", "🧁", "🍮", "🎂", "🍓", "🍫", "🥥", "🍋", "🍯", "🍪"];

const emptyForm = (): FormState => ({
  nome: "",
  emoji: "🍰",
  descricao: ""
});

export function CategoryManager({ onClose }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  usePageScrollLock(true);

  async function reload(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError(null);

    try {
      setCategories(await listAllCategories());
      setError(null);
    } catch (err) {
      if (!silent) {
        setError(
          err instanceof ProductApiError
            ? err.message
            : "Não foi possível carregar as categorias."
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (emojiOpen) {
        event.preventDefault();
        setEmojiOpen(false);
        return;
      }
      if (!saving) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [emojiOpen, onClose, saving]);

  useEffect(() => {
    if (!emojiOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!emojiPickerRef.current?.contains(target)) setEmojiOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [emojiOpen]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nome = form.nome.trim();
    const emoji = form.emoji.trim() || "🍰";
    const descricao = form.descricao.trim();

    if (nome.length < 2) {
      setError("Informe um nome com pelo menos 2 caracteres.");
      return;
    }

    if (nome.length > 60 || [...emoji].length > 16 || descricao.length > 240) {
      setError("Revise os dados da categoria.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await createCategory({ nome, emoji, descricao });
      setForm(emptyForm());
      setEmojiOpen(false);
      setMessage("Categoria criada.");
      await reload(true);
    } catch (err) {
      setError(
        err instanceof ProductApiError
          ? err.message
          : "Não foi possível criar a categoria."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="presentation">
      <button
        className={styles.backdrop}
        type="button"
        aria-label="Fechar categorias"
        onClick={() => !saving && onClose()}
      />

      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-manager-title"
      >
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>Catálogo</span>
            <h2 id="category-manager-title">Gerenciar categorias</h2>
            <p>Crie categorias e use-as imediatamente nos produtos do cardápio.</p>
          </div>
          <button
            className={styles.close}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            disabled={saving}
          >
            ×
          </button>
        </header>

        <form className={styles.create} onSubmit={submit}>
          <div className={styles.createCopy}>
            <strong>Nova categoria</strong>
            <span>O identificador é criado automaticamente a partir do nome.</span>
          </div>

          <div className={styles.createGrid}>
            <label>
              Nome
              <input
                value={form.nome}
                maxLength={60}
                required
                placeholder="Ex.: Brownies"
                autoComplete="off"
                onChange={event =>
                  setForm(current => ({ ...current, nome: event.target.value }))
                }
              />
            </label>

            <div className={styles.emojiField} ref={emojiPickerRef}>
              <span className={styles.emojiLabel}>Emoji</span>
              <button
                className={`${styles.emojiTrigger} ${emojiOpen ? styles.emojiTriggerOpen : ""}`}
                type="button"
                aria-label={`Selecionar emoji. Atual: ${form.emoji}`}
                aria-haspopup="listbox"
                aria-expanded={emojiOpen}
                onClick={() => setEmojiOpen(open => !open)}
                disabled={saving}
              >
                <span aria-hidden="true">{form.emoji}</span>
                <span className={styles.emojiChevron} aria-hidden="true">⌄</span>
              </button>

              {emojiOpen ? (
                <div className={styles.emojiPicker} role="listbox" aria-label="Escolher emoji da categoria">
                  {EMOJI_OPTIONS.map(option => {
                    const selected = form.emoji === option;
                    return (
                      <button
                        key={option}
                        className={`${styles.emojiOption} ${selected ? styles.emojiOptionSelected : ""}`}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={`Usar ${option}`}
                        onClick={() => {
                          setForm(current => ({ ...current, emoji: option }));
                          setEmojiOpen(false);
                        }}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <label className={styles.wide}>
              Descrição
              <input
                value={form.descricao}
                maxLength={240}
                placeholder="Ex.: Brownies artesanais da R&P"
                autoComplete="off"
                onChange={event =>
                  setForm(current => ({ ...current, descricao: event.target.value }))
                }
              />
            </label>
          </div>

          <div className={styles.createActions}>
            <span className={styles.message} aria-live="polite">
              {message ?? ""}
            </span>
            <button className={styles.primary} type="submit" disabled={saving}>
              {saving ? "Criando…" : "+ Criar categoria"}
            </button>
          </div>
        </form>

        {error ? (
          <div className={styles.error} role="alert">
            {error}
          </div>
        ) : null}

        <div className={styles.list}>
          {loading ? (
            <p>Carregando categorias…</p>
          ) : (
            categories.map(category => (
              <article
                className={`${styles.card} ${category.ativo ? "" : styles.inactive}`}
                key={category.id}
              >
                <div className={styles.icon} aria-hidden="true">
                  {category.emoji || "🍰"}
                </div>
                <div className={styles.copy}>
                  <div className={styles.titleRow}>
                    <div>
                      <strong>{category.nome}</strong>
                      <code>{category.id}</code>
                    </div>
                    <span
                      className={`${styles.badge} ${category.sistema ? "" : styles.customBadge}`}
                    >
                      {category.sistema ? "Sistema" : "Personalizada"}
                    </span>
                  </div>
                  <p>{category.descricao || "Categoria personalizada do cardápio."}</p>
                  <div className={styles.stats} aria-label={`Resumo da categoria ${category.nome}`}>
                    <span><strong>{category.produtos ?? 0}</strong> produtos</span>
                    <span><strong>{category.ativos ?? 0}</strong> ativos</span>
                    <span><strong>{category.arquivados ?? 0}</strong> arquivados</span>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <footer className={styles.footer}>
          <span>
            {categories.length} {categories.length === 1 ? "categoria" : "categorias"} no catálogo
          </span>
          <button className={styles.secondary} type="button" onClick={onClose} disabled={saving}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}
