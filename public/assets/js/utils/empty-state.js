export function catalogEmptyCopy(products = []) {
  return Array.isArray(products) && products.length === 0
    ? {
        title: "Cardápio em atualização",
        body: "Os doces disponíveis vão aparecer aqui assim que o cardápio for atualizado."
      }
    : null;
}
