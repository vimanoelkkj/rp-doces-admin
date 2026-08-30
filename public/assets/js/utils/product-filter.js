export function storefrontProducts(products = []) {
  return products.filter(product => product && product.ativo !== false);
}
export function availableStorefrontProducts(products = []) {
  return storefrontProducts(products).filter(
    product => product.disponivel !== false && Number(product.estoque) > 0
  );
}
