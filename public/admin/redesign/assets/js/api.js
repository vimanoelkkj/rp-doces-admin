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

function signalDataChanged(...pages) {
  window.dispatchEvent(
    new CustomEvent("rp-admin-data-changed", {
      detail: { pages: pages.flat().filter(Boolean) }
    })
  );
}

const PRODUCTS_CACHE_TTL_MS = 15000;
let productsCache = null;
let productsCacheAt = 0;
let productsRequest = null;

function invalidateProductsCache() {
  productsCache = null;
  productsCacheAt = 0;
}

async function getProductsCached() {
  const now = Date.now();
  if (productsCache && now - productsCacheAt < PRODUCTS_CACHE_TTL_MS) return productsCache;
  if (productsRequest) return productsRequest;

  productsRequest = request("/api/admin/products")
    .then(payload => {
      productsCache = payload;
      productsCacheAt = Date.now();
      return payload;
    })
    .finally(() => {
      productsRequest = null;
    });

  return productsRequest;
}

export const adminApi = {
  me() {
    return request("/api/auth/me");
  },
  logout() {
    return jsonRequest("/api/auth/logout", "POST", {});
  },
  passkeys() {
    return request("/api/admin/passkeys");
  },
  beginPasskeyRegistration() {
    return jsonRequest("/api/admin/passkeys", "POST", { acao: "opcoes" });
  },
  finishPasskeyRegistration(challengeId, response) {
    return jsonRequest("/api/admin/passkeys", "POST", {
      acao: "verificar",
      challenge_id: challengeId,
      response
    });
  },
  removePasskey(id) {
    return jsonRequest("/api/admin/passkeys", "DELETE", { id });
  },
  pushConfig() {
    return request("/api/admin/push/config");
  },
  subscribePush(subscription) {
    return jsonRequest("/api/admin/push/subscribe", "POST", subscription);
  },
  unsubscribePush(endpoint) {
    return jsonRequest("/api/admin/push/subscribe", "DELETE", { endpoint });
  },
  orders() {
    return request("/api/admin/orders");
  },
  createManualOrder(order) {
    return jsonRequest("/api/admin/orders", "POST", order).then(payload => {
      invalidateProductsCache();
      signalDataChanged("pedidos", "produtos", "dashboard");
      return payload;
    });
  },
  updateOrderStatus(id, status) {
    return jsonRequest(`/api/admin/orders/${id}`, "PUT", { status_pedido: status }).then(payload => {
      signalDataChanged("pedidos", "dashboard");
      return payload;
    });
  },
  updateManualPayment(id, status) {
    return jsonRequest(`/api/admin/orders/${id}`, "PUT", { status_pagamento: status }).then(payload => {
      invalidateProductsCache();
      signalDataChanged("pedidos", "produtos", "dashboard");
      return payload;
    });
  },
  products() {
    return getProductsCached();
  },
  categories() {
    return request("/api/admin/categories");
  },
  createCategory(category) {
    return jsonRequest("/api/admin/categories", "POST", category).then(payload => {
      signalDataChanged("produtos", "dashboard");
      return payload;
    });
  },
  createProduct(product) {
    return jsonRequest("/api/admin/products", "POST", product).then(payload => {
      invalidateProductsCache();
      signalDataChanged("produtos", "dashboard");
      return payload;
    });
  },
  updateProduct(id, product) {
    return jsonRequest(`/api/admin/products/${id}`, "PUT", product).then(payload => {
      invalidateProductsCache();
      signalDataChanged("produtos", "dashboard");
      return payload;
    });
  },
  archiveProduct(id) {
    return request(`/api/admin/products/${id}`, { method: "DELETE" }).then(payload => {
      invalidateProductsCache();
      signalDataChanged("produtos", "dashboard");
      return payload;
    });
  },
  deleteProductPermanently(id) {
    return request(`/api/admin/products/${id}?permanent=1`, { method: "DELETE" }).then(payload => {
      invalidateProductsCache();
      signalDataChanged("produtos", "dashboard");
      return payload;
    });
  },
  reactivateProduct(id, product) {
    return jsonRequest(`/api/admin/products/${id}`, "PUT", product).then(payload => {
      invalidateProductsCache();
      signalDataChanged("produtos", "dashboard");
      return payload;
    });
  },
  users() {
    return request("/api/admin/users");
  },
  createUser(user) {
    return jsonRequest("/api/admin/users", "POST", user).then(payload => {
      signalDataChanged("admins");
      return payload;
    });
  },
  resetUserPassword(id, password) {
    return jsonRequest(`/api/admin/users/${id}`, "PUT", {
      acao: "resetar_senha",
      senha: password
    }).then(payload => {
      signalDataChanged("admins");
      return payload;
    });
  },
  toggleUser(id, active) {
    return jsonRequest(`/api/admin/users/${id}`, "PUT", {
      acao: "toggle_ativo",
      ativo: Boolean(active)
    }).then(payload => {
      signalDataChanged("admins");
      return payload;
    });
  },
  changeUserRole(id, role) {
    return jsonRequest(`/api/admin/users/${id}`, "PUT", {
      acao: "alterar_papel",
      papel: role
    }).then(payload => {
      signalDataChanged("admins");
      return payload;
    });
  },
  storeConfig() {
    return request("/api/admin/config");
  },
  updateStoreConfig(config) {
    return jsonRequest("/api/admin/config", "PUT", config).then(payload => {
      signalDataChanged("loja", "dashboard");
      return payload;
    });
  }
};