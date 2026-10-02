import { useState } from "react";
import { Link } from "react-router-dom";
import { IconBag } from "../admin/components/AdminSidebar";
import { lerUltimoPedido } from "../lib/ultimoPedido";
import "./UltimoPedidoLink.css";

interface UltimoPedidoLinkProps {
  className?: string;
}

// Leva ao acompanhamento do último pedido deste navegador (ver lib/ultimoPedido).
// Sem registro válido não renderiza nada. Lê uma vez ao montar: o registro só muda em outras
// rotas, e cada página do storefront monta o componente de novo.
export default function UltimoPedidoLink({ className = "" }: UltimoPedidoLinkProps) {
  const [tokenPublico] = useState(() => lerUltimoPedido());
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
