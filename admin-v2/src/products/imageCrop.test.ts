import { describe, expect, it } from "vitest";
import { calculateCropRect } from "./imageCrop";

describe("calculateCropRect", () => {
  it("recorta imagem horizontal para 4:3 centralizada", () => {
    const crop = calculateCropRect(1600, 900, 1, 0.5, 0.5);

    expect(crop.sw).toBeCloseTo(1200);
    expect(crop.sh).toBeCloseTo(900);
    expect(crop.sx).toBeCloseTo(200);
    expect(crop.sy).toBeCloseTo(0);
  });

  it("recorta imagem vertical para 4:3 centralizada", () => {
    const crop = calculateCropRect(900, 1600, 1, 0.5, 0.5);

    expect(crop.sw).toBeCloseTo(900);
    expect(crop.sh).toBeCloseTo(675);
    expect(crop.sx).toBeCloseTo(0);
    expect(crop.sy).toBeCloseTo(462.5);
  });

  it("aplica zoom reduzindo a área de origem", () => {
    const crop = calculateCropRect(1600, 900, 2, 0.5, 0.5);

    expect(crop.sw).toBeCloseTo(600);
    expect(crop.sh).toBeCloseTo(450);
    expect(crop.sx).toBeCloseTo(500);
    expect(crop.sy).toBeCloseTo(225);
  });

  it("usa o ponto focal para mover o enquadramento", () => {
    const left = calculateCropRect(1600, 900, 1, 0, 0.5);
    const right = calculateCropRect(1600, 900, 1, 1, 0.5);

    expect(left.sx).toBeCloseTo(0);
    expect(right.sx).toBeCloseTo(400);
  });

  it("limita zoom e ponto focal aos limites suportados", () => {
    const crop = calculateCropRect(1600, 900, 99, -4, 8);

    expect(crop.sw).toBeCloseTo(400);
    expect(crop.sh).toBeCloseTo(300);
    expect(crop.sx).toBeCloseTo(0);
    expect(crop.sy).toBeCloseTo(600);
  });

  it("rejeita dimensões inválidas", () => {
    expect(() => calculateCropRect(0, 900, 1, 0.5, 0.5)).toThrow();
  });
});
