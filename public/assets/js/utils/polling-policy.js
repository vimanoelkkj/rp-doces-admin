export const ORDER_POLL_INTERVAL_MS = 3000;
export const ORDER_POLL_MAX_ATTEMPTS = 120;
export function pollingExhausted(attempts) {
  return Number(attempts) >= ORDER_POLL_MAX_ATTEMPTS;
}
