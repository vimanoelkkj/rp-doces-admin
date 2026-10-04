import { useRef, useState } from "react";
import { useNotificacoes } from "../notificacoes/NotificacoesContext";

// Card "Pedido de produto de teste" (Admin > Loja): dispara um pedido fictício para conferir as
// notificações e os sons do painel. As classes vêm de AdminLoja.css.
export default function PushTestePanel() {
  const { revalidar: revalidarNotificacoes } = useNotificacoes();
  const [testeLoading, setTesteLoading] = useState(false);
  const [testeError, setTesteError] = useState<string | null>(null);
  const [testeEnviado, setTesteEnviado] = useState(false);
  const testeEmVooRef = useRef(false);

  const dispararPedidoTeste = async () => {
    if (testeEmVooRef.current) return;
    testeEmVooRef.current = true;
    setTesteLoading(true);
    setTesteError(null);
    try {
      const response = await fetch("/api/admin/diagnosticos/pedido-teste", {
        method: "POST"
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setTesteError(data?.error || "Não foi possível disparar o pedido de teste");
        return;
      }
      setTesteEnviado(true);
      revalidarNotificacoes();
      setTimeout(() => setTesteEnviado(false), 4000);
    } catch {
      setTesteError("Falha de conexão ao disparar o pedido de teste");
    } finally {
      testeEmVooRef.current = false;
      setTesteLoading(false);
    }
  };

  return (
    <div className="loj-diag-card">
      <div className="loj-diag-card-header">
        <span className="loj-diag-card-title">Pedido de produto de teste</span>
        <span className="loj-badge-test">TEST</span>
      </div>
      <p className="loj-diag-card-desc">
        Gera um fluxo simulado de pedido fictício de bolo para verificar se as notificações e sons
        do painel administrativo estão operando.
      </p>
      <button
        type="button"
        className="loj-diag-action"
        onClick={dispararPedidoTeste}
        disabled={testeLoading}
      >
        {testeLoading ? "Enviando..." : "Disparar pedido teste"}
      </button>
      {testeError && <p className="loj-diag-error">{testeError}</p>}
      {testeEnviado && (
        <p className="loj-diag-success">Evento de teste registrado — confira nas notificações.</p>
      )}
    </div>
  );
}
