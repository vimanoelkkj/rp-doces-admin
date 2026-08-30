async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(payload?.erro || payload?.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export const adminApi = {
  me() {
    return request("/api/auth/me");
  },
  orders() {
    return request("/api/admin/orders");
  },
  products() {
    return request("/api/admin/products");
  },
  createProduct(product) {
    return request("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product)
    });
  },
  updateProduct(id, product) {
    return request(`/api/admin/products/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product)
    });
  },
  archiveProduct(id) {
    return request(`/api/admin/products/${id}`, {
      method: "DELETE"
    });
  }
};
