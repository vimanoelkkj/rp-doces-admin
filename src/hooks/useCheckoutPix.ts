import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { fetchProducts } from "../api/products";
import {
  gravarOperationKey,
  lerOperationKey,
  novaOperationKey,
  SLOT_CHECKOUT
} from "../lib/operationKey";
import { lembrarUltimoPedido } from "../lib/ultimoPedido";
import {
  classificarFalhaCheckout,
  duracaoAleatoria,
  type CheckoutResponse,
  type CheckoutState,
  type CorpoDeErroDoCheckout
} from "../lib/aguardandoPagamento";

export type FaseDoCheckout = "criando" | "pronto" | "erro";
export type EtapaDoLoading = 1 | 2;

// Cria o pedido e o Pix da tentativa (uma única operação financeira por visita, identificada pela key A1)
// e conduz a tela: `criando` (duas etapas de loading), `pronto` (QR Code) ou `erro`. Sem itens na
// tentativa, volta para o cardápio.
export function useCheckoutPix(tentativa: CheckoutState | null) {
  const navigate = useNavigate();
  const { reconcileWithProducts } = useCart();

  // A1: a MESMA identidade durante todo o ciclo de vida desta finalização.
  // `useRef` a resolve UMA vez por montagem e o `sessionStorage` a preserva
  // entre remontagens, StrictMode e retry — assim uma resposta HTTP perdida,
  // um abort ou um remount não viram um segundo pedido. Prioridade:
  // navegação (criada no Checkout) > sessão > geração local de último
  // recurso (mantém a página funcional mesmo sem storage disponível).
  const operationKeyRef = useRef<string | null>(null);
  if (operationKeyRef.current === null) {
    const resolvida =
      tentativa?.operationKey ?? lerOperationKey(SLOT_CHECKOUT) ?? novaOperationKey();
    gravarOperationKey(SLOT_CHECKOUT, resolvida);
    operationKeyRef.current = resolvida;
  }

  const [fase, setFase] = useState<FaseDoCheckout>("criando");
  const [etapa, setEtapa] = useState<EtapaDoLoading>(1);
  const [payment, setPayment] = useState<CheckoutResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isEstoqueError, setIsEstoqueError] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: o checkout usa de propósito a tentativa fixada na montagem (A1: uma operação por visita); mudanças posteriores de navigate ou reconcileWithProducts não devem recriar uma operação financeira
  useEffect(() => {
    if (!tentativa || tentativa.items.length === 0) {
      navigate("/cardapio");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const startedAt = Date.now();
    // Sorteados uma vez por visita: cada carregamento "varia" de verdade,
    // não é sempre o mesmo tempo fixo.
    const duracaoPasso1 = duracaoAleatoria();
    const duracaoPasso2 = duracaoAleatoria();

    const stepTimer = setTimeout(() => {
      if (!cancelled) setEtapa(2);
    }, duracaoPasso1);

    fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        items: tentativa.items.map(item => ({
          id: item.id,
          quantity: item.quantity
        })),
        cliente: tentativa.cliente,
        recado: tentativa.recado,
        // A1: mesma finalização, mesma key — em toda tentativa.
        operationKey: operationKeyRef.current
      })
    })
      .then(async response => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as CorpoDeErroDoCheckout;
          const falha = classificarFalhaCheckout(response.status, body);
          if (falha.tipo === "ACOMPANHAR") {
            // O pedido existe: guarda o token para reencontrá-lo mesmo se a aba for fechada.
            lembrarUltimoPedido(falha.tokenPublico);
            if (!cancelled) {
              navigate(`/pedido/${encodeURIComponent(falha.tokenPublico)}`);
            }
            return null;
          }

          if (falha.estoque) {
            // Reconcilia o carrinho com os dados mais recentes do estoque
            fetchProducts()
              .then(products => {
                reconcileWithProducts(products);
              })
              .catch(() => {});
          }

          const erro = new Error(falha.mensagem);
          (erro as unknown as { isEstoque: boolean }).isEstoque = falha.estoque;
          throw erro;
        }
        return response.json() as Promise<CheckoutResponse>;
      })
      .then(data => {
        // O pedido já existe no servidor: guarda o token antes do loading artificial,
        // para não perdê-lo se a aba for fechada nesse intervalo.
        if (data) lembrarUltimoPedido(data.tokenPublico);
        if (cancelled || !data) return;
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, duracaoPasso1 + duracaoPasso2 - elapsed);
        setTimeout(() => {
          if (cancelled) return;
          setPayment(data);
          setFase("pronto");
        }, remaining);
      })
      .catch(err => {
        if (controller.signal.aborted || cancelled) return;
        setErrorMessage(err.message);
        setIsEstoqueError(Boolean((err as unknown as { isEstoque?: boolean })?.isEstoque));
        setFase("erro");
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(stepTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { fase, etapa, payment, errorMessage, isEstoqueError };
}
