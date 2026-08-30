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

function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export const adminApi = {
  me() {
    return request("/api/auth/me");
  },
  orders() {
    return request("/api/admin/orders");
  },
  updateOrderStatus(id, status) {
    return jsonRequest(`/api/admin/orders/${id}`, "PUT", { status_pedido: status });
  },
  products() {
    return request("/api/admin/products");
  },
  categories() {
    return request("/api/admin/categories");
  },
  createCategory(category) {
    return jsonRequest("/api/admin/categories", "POST", category);
  },
  createProduct(product) {
    return jsonRequest("/api/admin/products", "POST", product);
  },
  updateProduct(id, product) {
    return jsonRequest(`/api/admin/products/${id}`, "PUT", product);
  },
  archiveProduct(id) {
    return request(`/api/admin/products/${id}`, { method: "DELETE" });
  },
  reactivateProduct(id, product) {
    return jsonRequest(`/api/admin/products/${id}`, "PUT", product);
  },
  users() {
    return request("/api/admin/users");
  },
  createUser(user) {
    return jsonRequest("/api/admin/users", "POST", user);
  },
  resetUserPassword(id, password) {
    return jsonRequest(`/api/admin/users/${id}`, "PUT", {
      acao: "resetar_senha",
      senha: password
    });
  },
  toggleUser(id, active) {
    return jsonRequest(`/api/admin/users/${id}`, "PUT", {
      acao: "toggle_ativo",
      ativo: Boolean(active)
    });
  },
  changeUserRole(id, role) {
    return jsonRequest(`/api/admin/users/${id}`, "PUT", {
      acao: "alterar_papel",
      papel: role
    });
  },
  storeConfig() {
    return request("/api/admin/config");
  },
  updateStoreConfig(config) {
    return jsonRequest("/api/admin/config", "PUT", config);
  }
};
