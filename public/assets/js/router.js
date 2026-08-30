export function createRouter() {
  const routes = new Map();
  return {
    register(name, handler) {
      routes.set(name, handler);
    },
    go(name, payload) {
      const handler = routes.get(name);
      if (handler) handler(payload);
    }
  };
}
