export const CATALOG_STATUS = Object.freeze({ LOADING: "loading", READY: "ready", ERROR: "error" });
export function catalogReady(status) {
  return status === CATALOG_STATUS.READY;
}
