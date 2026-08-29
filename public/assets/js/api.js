async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export const api = {
  getConfig: () => request("/api/config", { cache: "no-store" }),
  getProducts: () => request("/api/products", { cache: "no-store" })
};
