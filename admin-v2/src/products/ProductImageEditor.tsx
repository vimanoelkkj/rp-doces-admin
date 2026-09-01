import { useEffect, useRef, useState } from "react";
import { deleteProductImage, ProductApiError, uploadProductImage } from "./product.api";
import type { ProductId } from "./product.types";
import styles from "./ProductImageEditor.module.css";

interface Props { productId: ProductId; currentImageKey: string | null; }

export function ProductImageEditor({ productId, currentImageKey }: Props) {
  const [imageKey, setImageKey] = useState(currentImageKey);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function changeImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Use JPG, PNG ou WebP com no máximo 5 MB.");
      return;
    }
    setError(null);
    const local = URL.createObjectURL(file);
    setPreview(local);
    setUploading(true);
    try {
      const result = await uploadProductImage(productId, file);
      setImageKey(result.image_key);
    } catch (err) {
      setPreview(null);
      setError(err instanceof ProductApiError ? err.message : "Falha ao enviar imagem.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeImage() {
    setUploading(true); setError(null);
    try { await deleteProductImage(productId); setImageKey(null); setPreview(null); }
    catch (err) { setError(err instanceof ProductApiError ? err.message : "Falha ao remover imagem."); }
    finally { setUploading(false); }
  }

  const url = preview ?? (imageKey ? `/api/images/${encodeURIComponent(imageKey)}` : null);
  return <section className={styles.wrap}>
    <div className={styles.preview}>{url ? <img src={url} alt="Prévia do produto" /> : <span>Sem imagem</span>}{uploading && <div className={styles.busy}>Enviando…</div>}</div>
    <div className={styles.actions}><label>Trocar imagem<input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={changeImage} /></label>{imageKey && <button type="button" disabled={uploading} onClick={removeImage}>Remover</button>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
