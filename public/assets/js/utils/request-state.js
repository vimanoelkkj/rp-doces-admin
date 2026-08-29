export function requestState(status = "idle", data = null, error = null) {
  return { status, data, error };
}
export function loadingRequest() {
  return requestState("loading");
}
export function successfulRequest(data) {
  return requestState("success", data);
}
export function failedRequest(error) {
  return requestState("error", null, error);
}
