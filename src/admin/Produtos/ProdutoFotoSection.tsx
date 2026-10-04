import { useRef } from "react";

interface ProdutoFotoSectionProps {
  fieldId: string;
  isEdit: boolean;
  produtoId?: number;
  imagePreview: string | null;
  uploadingImage: boolean;
  setUploadingImage: (uploading: boolean) => void;
  setImagePreview: (preview: string | null) => void;
  onError: (error: string | null) => void;
  onSaved?: () => void;
}

export default function ProdutoFotoSection({
  fieldId,
  isEdit,
  produtoId,
  imagePreview,
  uploadingImage,
  setUploadingImage,
  setImagePreview,
  onError,
  onSaved
}: ProdutoFotoSectionProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isEdit || !produtoId) {
      // Sem id ainda (produto novo): só preview local, upload de verdade
      // só é possível depois que o produto existir (mesmo padrão do backend).
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
      return;
    }

    setUploadingImage(true);
    onError(null);
    const formData = new FormData();
    formData.append("image", file);
    fetch(`/api/admin/produtos/${produtoId}/imagem`, {
      method: "POST",
      body: formData
    })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao enviar imagem");
        }
        return response.json() as Promise<{ imageUrl: string }>;
      })
      .then(result => {
        setImagePreview(result.imageUrl);
        onSaved?.();
      })
      .catch(err => {
        onError(err instanceof Error ? err.message : "Falha ao enviar imagem");
      })
      .finally(() => setUploadingImage(false));
  };

  const handleRemoveImage = () => {
    if (!isEdit || !produtoId || uploadingImage) return;
    setUploadingImage(true);
    onError(null);
    fetch(`/api/admin/produtos/${produtoId}/imagem`, { method: "DELETE" })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao remover imagem");
        }
        setImagePreview(null);
        onSaved?.();
      })
      .catch(err => {
        onError(err instanceof Error ? err.message : "Falha ao remover imagem");
      })
      .finally(() => setUploadingImage(false));
  };

  return (
    <div className="np-field np-field--full">
      <label htmlFor={`${fieldId}-foto`}>FOTO DO PRODUTO</label>
      <div className="np-photo-row">
        <button
          type="button"
          className="np-photo-preview"
          onClick={() => fileRef.current?.click()}
          aria-label="Escolher foto do produto"
        >
          {imagePreview ? (
            <img src={imagePreview} alt="Preview" />
          ) : (
            <span className="np-photo-empty">{uploadingImage ? "Enviando…" : "Sem foto"}</span>
          )}
        </button>
        <div className="np-photo-info">
          <button
            type="button"
            className="np-photo-btn"
            onClick={() => fileRef.current?.click()}
            disabled={uploadingImage}
          >
            {uploadingImage ? "ENVIANDO…" : "ESCOLHER FOTO"}
          </button>
          {isEdit && imagePreview && (
            <button
              type="button"
              className="np-photo-remove"
              onClick={handleRemoveImage}
              disabled={uploadingImage}
            >
              REMOVER FOTO
            </button>
          )}
          <p className="np-photo-hint">
            {isEdit
              ? "JPG, PNG ou WebP, até 5 MB."
              : "Salve o produto primeiro para poder enviar uma foto."}
          </p>
        </div>
        <input
          id={`${fieldId}-foto`}
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleImageChange}
          hidden
        />
      </div>
    </div>
  );
}
