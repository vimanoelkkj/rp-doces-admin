export function nowMs() {
  return Date.now();
}
export function seconds(ms = 0) {
  return Math.max(0, Number(ms) || 0) * 1000;
}
export function minutes(ms = 0) {
  return seconds(ms) * 60;
}
export function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
