import { api } from "./api.js";
import { state, notify } from "./state.js";

export async function bootstrapStorefront() {
  try {
    const payload = await api.getProducts();
    state.products = Array.isArray(payload.produtos) ? payload.produtos : [];
  } catch (error) {
    console.warn("R&P: não foi possível carregar produtos no bootstrap modular.", error);
  }
  notify();
}
