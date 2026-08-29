const LABELS = Object.freeze({ BOLO_NO_POTE: "Bolo no pote", MINI_PUDIM: "Mini pudim" });
export function productCategoryLabel(value = "") {
  return LABELS[String(value).toUpperCase()] || "Doce artesanal";
}
export function knownProductCategory(value = "") {
  return Object.hasOwn(LABELS, String(value).toUpperCase());
}
