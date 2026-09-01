export const PRODUCT_IMAGE_WIDTH = 1200;
export const PRODUCT_IMAGE_HEIGHT = 900;
export const PRODUCT_IMAGE_ASPECT = PRODUCT_IMAGE_WIDTH / PRODUCT_IMAGE_HEIGHT;

export type CropRect = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function calculateCropRect(
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  focalX: number,
  focalY: number
): CropRect {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Dimensões da imagem inválidas.");
  }

  const safeZoom = clamp(zoom, 1, 3);
  const safeFocalX = clamp(focalX, 0, 1);
  const safeFocalY = clamp(focalY, 0, 1);
  const imageAspect = imageWidth / imageHeight;

  let baseWidth: number;
  let baseHeight: number;

  if (imageAspect > PRODUCT_IMAGE_ASPECT) {
    baseHeight = imageHeight;
    baseWidth = baseHeight * PRODUCT_IMAGE_ASPECT;
  } else {
    baseWidth = imageWidth;
    baseHeight = baseWidth / PRODUCT_IMAGE_ASPECT;
  }

  const sw = baseWidth / safeZoom;
  const sh = baseHeight / safeZoom;
  const sx = (imageWidth - sw) * safeFocalX;
  const sy = (imageHeight - sh) * safeFocalY;

  return { sx, sy, sw, sh };
}
