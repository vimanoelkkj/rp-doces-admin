import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IconBag } from "../admin/components/AdminSidebar";
import { esquecerUltimoPedido, lerUltimoPedido, pedidoEncerrado } from "../lib/ultimoPedido";
import "./UltimoPedidoLink.css";

interface UltimoPedidoLinkProps {
  className?: string;
}

// Leva ao acompanhamento do último pedido deste navegador (ver lib/ultimoPedido).
// Sem registro válido não renderiza nada. Mostra o registro na hora e, ao montar, confirma o token
// com um GET somente leitura em /api/pedido-status (nunca POST: ele dispara a reconciliação com o
// Mercado Pago). 404 ou pedido encerrado: esquece o registro e esconde o link. Qualquer outra
// resposta ou falha mantém o link e o registro como estão.
export default function UltimoPedidoLink({ className = "" }: UltimoPedidoLinkProps) {
  const [tokenPublico, setTokenPublico] = useState(() => lerUltimoPedido());

  useEffect(() => {
    if (!tokenPublico) return;

    const controller = new AbortController();
    const validar = async () => {
      try {
        const response = await fetch(
          `/api/pedido-status?token=${encodeURIComponent(tokenPublico)}`,
          { cache: "no-store", signal: controller.signal }
        );
        const encerrado =
          response.status === 404 || (response.ok && pedidoEncerrado(await response.json()));
        if (!encerrado) return;
        esquecerUltimoPedido(tokenPublico);
        setTokenPublico(null);
      } catch {
        // Rede, cancelamento ou corpo inválido não provam nada: link e registro ficam como estão.
      }
    };
    void validar();

    return () => controller.abort();
  }, [tokenPublico]);

  if (!tokenPublico) return null;

  return (
    <Link
      to={`/pedido/${encodeURIComponent(tokenPublico)}`}
      className={`ultimo-pedido-link ${className}`.trim()}
    >
      <span className="ultimo-pedido-link-icon">
        <IconBag />
      </span>
      Acompanhar último pedido
      <svg
        className="ultimo-pedido-link-arrow"
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
