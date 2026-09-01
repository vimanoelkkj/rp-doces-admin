import { useEffect, useRef, useState } from "react";
import { deleteProductImage, ProductApiError, uploadProductImage } from "./product.api";
import {
  calculateCropRect,
  PRODUCT_IMAGE_HEIGHT,
  PRODUCT_IMAGE_WIDTH
} from "./imageCrop";
import type { ProductId } from "./product.types";
import styles from "./ProductImageEditor.module.css";

interface Props {
  productId: ProductId | null;
  currentImageKey: string | null;
  onPreparedImage?: (file: File | null) => void;
}

type DragState = {
  pointerId: number;
  x: number;
  y: number;
  focalX: number;
  focalY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob);
        else reject(new Error("Não foi possível processar a imagem."));
      },
      "image/webp",
      0.9
    );
  });
}

export function ProductImageEditor({ productId, currentImageKey, onPreparedImage }: Props) {
  const [imageKey, setImageKey] = useState(currentImageKey);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focalX, setFocalX] = useState(0.5);
  const [focalY, setFocalY] = useState(0.5);
  const [dirty, setDirty] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const storedUrl = imageKey ? `/api/images/${encodeURIComponent(imageKey)}` : null;
  const activeUrl = selectedUrl ?? storedUrl;

  useEffect(() => {
    return () => {
      if (selectedUrl) URL.revokeObjectURL(selectedUrl);
    };
  }, [selectedUrl]);

  useEffect(() => {
    sourceImageRef.current = null;

    if (!activeUrl) {
      setLoadingImage(false);
      return;
    }

    let cancelled = false;
    const image = new Image();
    setLoadingImage(true);

    image.onload = () => {
      if (cancelled) return;
      sourceImageRef.current = image;
      setLoadingImage(false);
      setError(null);
    };

    image.onerror = () => {
      if (cancelled) return;
      sourceImageRef.current = null;
      setLoadingImage(false);
      setError("Não foi possível carregar a imagem para enquadramento.");
    };

    image.src = activeUrl;

    return () => {
      cancelled = true;
    };
  }, [activeUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = sourceImageRef.current;

    if (!canvas || !image || !image.complete || image.naturalWidth === 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const crop = calculateCropRect(image.naturalWidth, image.naturalHeight, zoom, focalX, focalY);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      canvas.width,
      canvas.height
    );
  }, [activeUrl, loadingImage, zoom, focalX, focalY]);

  function invalidatePreparedImage() {
    if (!prepared) return;
    setPrepared(false);
    onPreparedImage?.(null);
  }

  function changeImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Use JPG, PNG ou WebP com no máximo 5 MB.");
      event.target.value = "";
      return;
    }

    setError(null);
    setZoom(1);
    setFocalX(0.5);
    setFocalY(0.5);
    setDirty(true);
    setPrepared(false);
    onPreparedImage?.(null);
    setSelectedUrl(URL.createObjectURL(file));
    event.target.value = "";
  }

  function updateZoom(value: number) {
    invalidatePreparedImage();
    setZoom(clamp(value, 1, 3));
    setDirty(true);
  }

  function beginDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!sourceImageRef.current || busy) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      focalX,
      focalY
    };
  }

  function moveDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    invalidatePreparedImage();
    const deltaX = (event.clientX - drag.x) / rect.width;
    const deltaY = (event.clientY - drag.y) / rect.height;
    setFocalX(clamp(drag.focalX - deltaX / zoom, 0, 1));
    setFocalY(clamp(drag.focalY - deltaY / zoom, 0, 1));
    setDirty(true);
  }

  function endDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function saveCrop() {
    const image = sourceImageRef.current;
    if (!image) {
      setError("Escolha uma imagem antes de salvar o enquadramento.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const crop = calculateCropRect(image.naturalWidth, image.naturalHeight, zoom, focalX, focalY);
      const output = document.createElement("canvas");
      output.width = PRODUCT_IMAGE_WIDTH;
      output.height = PRODUCT_IMAGE_HEIGHT;

      const context = output.getContext("2d");
      if (!context) throw new Error("Canvas indisponível.");

      context.drawImage(
        image,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        0,
        0,
        PRODUCT_IMAGE_WIDTH,
        PRODUCT_IMAGE_HEIGHT
      );

      const blob = await canvasToBlob(output);
      const file = new File([blob], `product-${productId ?? "new"}.webp`, { type: "image/webp" });

      if (productId === null) {
        onPreparedImage?.(file);
        setPrepared(true);
        setDirty(false);
        return;
      }

      const result = await uploadProductImage(productId, file);
      setImageKey(result.image_key);
      setSelectedUrl(null);
      setZoom(1);
      setFocalX(0.5);
      setFocalY(0.5);
      setDirty(false);
      setPrepared(false);
      onPreparedImage?.(null);
    } catch (err) {
      setError(
        err instanceof ProductApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Falha ao salvar o enquadramento."
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    setError(null);

    if (productId === null) {
      setSelectedUrl(null);
      setZoom(1);
      setFocalX(0.5);
      setFocalY(0.5);
      setDirty(false);
      setPrepared(false);
      onPreparedImage?.(null);
      return;
    }

    setBusy(true);

    try {
      await deleteProductImage(productId);
      setImageKey(null);
      setSelectedUrl(null);
      setZoom(1);
      setFocalX(0.5);
      setFocalY(0.5);
      setDirty(false);
      setPrepared(false);
      onPreparedImage?.(null);
    } catch (err) {
      setError(err instanceof ProductApiError ? err.message : "Falha ao remover imagem.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.wrap}>
      <div className={styles.heading}>
        <div>
          <strong>Foto do produto</strong>
          <span>Moldura real do storefront · 4:3</span>
        </div>
        {activeUrl && <small>1200 × 900 px</small>}
      </div>

      <div className={styles.preview}>
        {activeUrl ? (
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="Prévia do enquadramento do produto. Arraste a imagem para reposicionar."
          />
        ) : (
          <span>Sem imagem</span>
        )}

        {(busy || loadingImage) && (
          <div className={styles.busy}>{busy ? "Salvando…" : "Carregando…"}</div>
        )}
      </div>

      {activeUrl && (
        <div className={styles.controls}>
          <label>
            <span>Zoom</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              disabled={busy || loadingImage}
              onChange={event => updateZoom(Number(event.target.value))}
            />
            <output>{zoom.toFixed(2)}×</output>
          </label>
          <small>
            {prepared
              ? "Enquadramento pronto. A foto será enviada ao salvar o produto."
              : "Arraste a foto dentro da moldura para escolher o foco."}
          </small>
        </div>
      )}

      <div className={styles.actions}>
        <label className={styles.fileButton}>
          {activeUrl ? "Trocar imagem" : "Escolher imagem"}
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={changeImage}
          />
        </label>

        {activeUrl && (
          <button type="button" disabled={busy || loadingImage || !dirty} onClick={saveCrop}>
            {prepared ? "Enquadramento pronto" : "Salvar enquadramento"}
          </button>
        )}

        {(imageKey || (productId === null && activeUrl)) && (
          <button className={styles.removeButton} type="button" disabled={busy} onClick={removeImage}>
            Remover
          </button>
        )}
      </div>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
