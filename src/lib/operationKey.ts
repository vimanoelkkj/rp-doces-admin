// A1 — identidade lógica da operação, criada no CLIENTE antes do primeiro
// envio ao backend.
//
// Por que no cliente: o servidor não tem como distinguir "retry da mesma
// intenção" de "nova intenção" se a identidade só nasce quando o POST chega.
// Era exatamente o defeito A1 — cada tentativa gerava uma key nova e virava
// uma operação nova.
//
// Por que `sessionStorage` e não o carrinho: o carrinho representa a intenção
// de compra em construção, não uma operação de checkout. Dois clientes podem
// ter carrinhos idênticos, e a mesma pessoa pode finalizar duas vezes de
// propósito. A key vive por FINALIZAÇÃO: sobrevive a retry, abort,
// remontagem e recarga da mesma finalização, e uma finalização
// explicitamente nova recebe uma key nova.
//
// Todo acesso ao storage é protegido: em aba privada, com dados de site
// bloqueados ou em ambiente sem `sessionStorage`, a leitura pode falhar ou
// voltar vazia — a página precisa continuar funcionando.

export function novaOperationKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ambiente sem crypto.randomUUID — cai no fallback abaixo
  }
  const aleatorio = () => Math.random().toString(36).slice(2, 12);
  return `k-${Date.now().toString(36)}-${aleatorio()}${aleatorio()}`;
}

export function lerOperationKey(slot: string): string | null {
  try {
    return sessionStorage.getItem(slot);
  } catch {
    return null;
  }
}

export function gravarOperationKey(slot: string, key: string): void {
  try {
    sessionStorage.setItem(slot, key);
  } catch {
    // Sem persistência, a key ainda vale para o ciclo de vida em memória
    // (retry e remontagem dentro da mesma navegação).
  }
}

export function limparOperationKey(slot: string): void {
  try {
    sessionStorage.removeItem(slot);
  } catch {
    // nada a fazer
  }
}

/** Slot da finalização de checkout do site. */
export const SLOT_CHECKOUT = "rp:checkout:operationKey";
