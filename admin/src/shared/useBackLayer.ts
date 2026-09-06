import { useCallback, useEffect, useRef } from "react";

const HISTORY_KEY = "__rp_admin_layers";

type HistoryState = Record<string, unknown> & {
  [HISTORY_KEY]?: string[];
};

type CloseHandler = () => void | boolean;

function stateObject(): HistoryState {
  const current = window.history.state;
  return current && typeof current === "object" ? current as HistoryState : {};
}

function stateLayers(state: unknown = window.history.state): string[] {
  if (!state || typeof state !== "object") return [];
  const layers = (state as HistoryState)[HISTORY_KEY];
  return Array.isArray(layers) ? layers.filter(value => typeof value === "string") : [];
}

function tokenFor(name: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${name}:${suffix}`;
}

function restoreLayer(token: string) {
  const currentState = stateObject();
  const layers = stateLayers(currentState);
  if (layers.includes(token)) return;

  window.history.pushState(
    { ...currentState, [HISTORY_KEY]: [...layers, token] },
    "",
    window.location.href
  );
}

/**
 * Se existe uma camada temporária no topo do histórico, consome primeiro essa
 * camada e impede que uma navegação de aba deixe modal/drawer órfão para trás.
 */
export function closeTopBackLayer(): boolean {
  if (stateLayers().length === 0) return false;
  window.history.back();
  return true;
}

/**
 * Faz dialogs/drawers participarem do histórico do navegador como uma camada
 * temporária. No Android/browser, Voltar fecha a camada antes de navegar para
 * outra tela. Fechar pelo X/backdrop também consome a entrada temporária.
 *
 * O callback pode retornar false para recusar o fechamento, por exemplo quando
 * há alterações não salvas. Nesse caso a entrada de histórico é restaurada.
 */
export function useBackLayer(open: boolean, onClose: CloseHandler, name: string) {
  const tokenRef = useRef<string | null>(null);
  const closeRef = useRef<CloseHandler>(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || tokenRef.current) return;

    const token = tokenFor(name);
    tokenRef.current = token;
    const currentState = stateObject();
    const layers = stateLayers(currentState);

    window.history.pushState(
      { ...currentState, [HISTORY_KEY]: [...layers, token] },
      "",
      window.location.href
    );

    const handlePopState = (event: PopStateEvent) => {
      if (tokenRef.current !== token) return;
      if (stateLayers(event.state).includes(token)) return;

      const accepted = closeRef.current() !== false;
      if (!accepted) {
        tokenRef.current = token;
        restoreLayer(token);
        return;
      }

      tokenRef.current = null;
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [open, name]);

  return useCallback(() => {
    const token = tokenRef.current;
    if (!token) {
      closeRef.current();
      return;
    }

    const accepted = closeRef.current() !== false;
    if (!accepted) return;

    const layers = stateLayers();
    const isTopLayer = layers[layers.length - 1] === token;
    tokenRef.current = null;

    if (isTopLayer) {
      window.history.back();
      return;
    }

    if (layers.includes(token)) {
      const currentState = stateObject();
      window.history.replaceState(
        { ...currentState, [HISTORY_KEY]: layers.filter(value => value !== token) },
        "",
        window.location.href
      );
    }
  }, []);
}
