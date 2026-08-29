export function isOnline() {
  return navigator.onLine !== false;
}

export function watchNetwork(callback) {
  const handler = () => callback(isOnline());
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  return () => {
    window.removeEventListener("online", handler);
    window.removeEventListener("offline", handler);
  };
}
