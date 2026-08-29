import { api } from "./api.js";
import { setOrderState } from "./state.js";

let timer = null;
let attempts = 0;
const MAX_ATTEMPTS = 120;

export function stopOrderPolling() {
  if (timer) clearTimeout(timer);
  timer = null;
  attempts = 0;
}

export function startOrderPolling(token) {
  stopOrderPolling();
  if (!token) return;

  const poll = async () => {
    attempts += 1;
    try {
      const payload = await api.getOrder(token);
      const pedido = payload.pedido || {};
      const status = String(pedido.status || "").toUpperCase();

      if (status === "PAGO" || status === "APROVADO") {
        setOrderState({ phase: "paid", token, data: pedido, error: null });
        stopOrderPolling();
        return;
      }

      if (["CANCELADO", "REJEITADO", "EXPIRADO"].includes(status)) {
        setOrderState({
          phase: "error",
          token,
          data: pedido,
          error: "O pagamento não foi concluído."
        });
        stopOrderPolling();
        return;
      }

      setOrderState({ phase: "pending", token, data: pedido, error: null });
    } catch (error) {
      if (attempts >= MAX_ATTEMPTS) {
        setOrderState({
          phase: "error",
          token,
          error: "Não conseguimos confirmar o pagamento agora."
        });
        stopOrderPolling();
        return;
      }
    }

    if (attempts < MAX_ATTEMPTS) timer = setTimeout(poll, 3000);
  };

  timer = setTimeout(poll, 3000);
}
