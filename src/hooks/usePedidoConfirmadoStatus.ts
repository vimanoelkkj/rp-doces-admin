import { useCallback, useEffect, useState } from "react";
import {
  confirmacaoEncerrada,
  type PedidoStatusResponse,
  type StatusPedido
} from "../lib/pedidoConfirmado";

// Acompanha o pedido da tela de confirmação: consulta `GET /api/pedido` ao montar, a cada 10 s, ao
// focar a janela e ao voltar a ficar visível, e para ao chegar em ENTREGUE ou CANCELADO.
// `encerrado` avisa que a tela deixou de valer (ver `confirmacaoEncerrada`).
export function usePedidoConfirmadoStatus(tokenPublico: string | undefined) {
  const [statusPedido, setStatusPedido] = useState<StatusPedido>("PREPARANDO");
  const [encerrado, setEncerrado] = useState(false);

  const atualizarStatus = useCallback(async () => {
    if (!tokenPublico) return;

    try {
      const response = await fetch(`/api/pedido?token=${encodeURIComponent(tokenPublico)}`, {
        cache: "no-store"
      });
      // Anulado ("excluído") ou inexistente: o acompanhamento mostra "Pedido não encontrado".
      if (response.status === 404) {
        setEncerrado(true);
        return;
      }
      if (!response.ok) return;
      const pedido = (await response.json()) as PedidoStatusResponse;
      setStatusPedido(pedido.statusPedido);
      if (confirmacaoEncerrada(pedido)) setEncerrado(true);
    } catch {
      // Falha pontual de rede não muda a tela; tenta novamente no próximo ciclo.
    }
  }, [tokenPublico]);

  useEffect(() => {
    if (!tokenPublico) return;

    void atualizarStatus();

    if (statusPedido === "ENTREGUE" || statusPedido === "CANCELADO") return;

    const interval = window.setInterval(() => void atualizarStatus(), 10_000);
    const aoFocar = () => void atualizarStatus();
    const aoFicarVisivel = () => {
      if (document.visibilityState === "visible") void atualizarStatus();
    };

    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoFicarVisivel);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
    };
  }, [tokenPublico, statusPedido, atualizarStatus]);

  return { statusPedido, encerrado };
}
