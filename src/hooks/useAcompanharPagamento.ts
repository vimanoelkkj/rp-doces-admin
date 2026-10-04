import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import {
  destinoDoResultado,
  duracaoAleatoria,
  POLL_INTERVAL_MS,
  statusTerminal,
  type CheckoutResponse,
  type CheckoutState,
  type PedidoStatusResponse
} from "../lib/aguardandoPagamento";

// Acompanha o Pix já criado: consulta o status a cada POLL_INTERVAL_MS enquanto `pronto` e, ao chegar
// a um estado terminal, devolve `resultado` e segue para a tela do resultado depois de uma pausa
// perceptível. `expiradoNoServidor` avisa que o servidor já encerrou o prazo do QR.
export function useAcompanharPagamento(
  payment: CheckoutResponse | null,
  pronto: boolean,
  tentativa: CheckoutState | null
) {
  const navigate = useNavigate();
  const { clearCart } = useCart();
  const [resultado, setResultado] = useState<string | null>(null);
  const [expiradoNoServidor, setExpiradoNoServidor] = useState(false);

  useEffect(() => {
    if (!pronto || resultado !== null || !payment) return;

    let cancelled = false;
    let inFlight = false;
    const controller = new AbortController();

    const goToResult = (statusPagamento: string) => {
      if (cancelled) return;
      cancelled = true;
      // Não navega direto: mostra a etapa "processando" por um instante
      // perceptível antes de revelar o resultado.
      setResultado(statusPagamento);
    };

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        // POST: o GET é somente leitura; a recuperação (MP, expiração) é
        // explícita e o servidor limita a consulta ao MP a uma por 15s.
        const response = await fetch(
          `/api/pedido-status?token=${encodeURIComponent(payment.tokenPublico)}`,
          { method: "POST", signal: controller.signal }
        );
        if (cancelled || !response.ok) return;
        const data = (await response.json()) as PedidoStatusResponse;
        if (cancelled) return;
        if (data.statusPagamento === "EXPIRADO") setExpiradoNoServidor(true);
        if (statusTerminal(data.statusPagamento)) {
          goToResult(data.statusPagamento);
        }
      } catch {
        // falha de rede pontual — tenta de novo no próximo ciclo
      } finally {
        inFlight = false;
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [pronto, resultado, payment]);

  useEffect(() => {
    if (!resultado || !payment || !tentativa) return;

    const timer = setTimeout(() => {
      const destino = destinoDoResultado(resultado, payment, tentativa.items);
      if (destino.limparCarrinho) clearCart();
      navigate(destino.para, destino.opcoes);
    }, duracaoAleatoria());

    return () => clearTimeout(timer);
  }, [resultado, payment, navigate, clearCart, tentativa]);

  return { resultado, expiradoNoServidor };
}
