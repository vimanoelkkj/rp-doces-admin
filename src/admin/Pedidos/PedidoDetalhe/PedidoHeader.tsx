import { useEffect, useRef, useState } from "react";
import type { PedidoRow, StatusPedido } from "./types";
import { STATUS_LABEL, STATUS_PEDIDO_OPCOES } from "./helpers";

interface PedidoHeaderProps {
  orderId: number;
  pedido: PedidoRow | null;
  anulado: boolean;
  editandoNome: boolean;
  clienteNome: string;
  salvandoNome: boolean;
  nomeError: string | null;
  alterando: boolean;
  arquivando: boolean;
  onIniciarEdicaoNome: () => void;
  onCancelarEdicaoNome: () => void;
  onSalvarNome: () => void;
  onClienteNomeChange: (nome: string) => void;
  onAlterarStatus: (status: StatusPedido) => void;
  onArquivar: () => void;
  onExcluir: () => void;
  onClose: () => void;
}

export default function PedidoHeader({
  orderId,
  pedido,
  anulado,
  editandoNome,
  clienteNome,
  salvandoNome,
  nomeError,
  alterando,
  arquivando,
  onIniciarEdicaoNome,
  onCancelarEdicaoNome,
  onSalvarNome,
  onClienteNomeChange,
  onAlterarStatus,
  onArquivar,
  onExcluir,
  onClose,
}: PedidoHeaderProps) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        statusMenuRef.current &&
        !statusMenuRef.current.contains(e.target as Node)
      ) {
        setStatusMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [statusMenuOpen]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const menu = moreMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) {
        menu.removeAttribute("open");
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div className="pedmodal-header">
      <div className="pedmodal-title-area">
        {editandoNome && pedido && !anulado ? (
          <form
            className="pedmodal-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSalvarNome();
            }}
          >
            <div className="pedmodal-name-controls">
              <span className="pedmodal-name-prefix">Pedido #{orderId} -</span>
              <input
                aria-label="Nome da cliente"
                value={clienteNome}
                onChange={(event) => onClienteNomeChange(event.target.value)}
                maxLength={200}
                autoFocus
                disabled={salvandoNome}
              />
              <button
                type="submit"
                className="pedmodal-btn-name-save"
                disabled={salvandoNome}
              >
                {salvandoNome ? "Salvando..." : "Salvar"}
              </button>
              <button
                type="button"
                className="pedmodal-btn-name-cancel"
                onClick={onCancelarEdicaoNome}
                disabled={salvandoNome}
              >
                Cancelar
              </button>
            </div>
            {nomeError && <span className="pedmodal-name-error">{nomeError}</span>}
          </form>
        ) : (
          <div className="pedmodal-title-row">
            <h2 className="pedmodal-title">
              Pedido #{orderId}
              {pedido ? ` - ${pedido.cliente_nome}` : ""}
            </h2>
            {pedido && !anulado && pedido.arquivado === 0 && (
              <button
                type="button"
                className="pedmodal-btn-name-edit"
                onClick={onIniciarEdicaoNome}
                aria-label="Editar nome da cliente"
              >
                Editar nome
              </button>
            )}
          </div>
        )}
      </div>
      <div className="pedmodal-header-actions">
        {pedido && !anulado && pedido.arquivado === 0 && (
          <div className="pedmodal-status-dropdown" ref={statusMenuRef}>
            <button
              type="button"
              className="pedmodal-btn-advance"
              onClick={() => setStatusMenuOpen((open) => !open)}
              disabled={alterando}
            >
              Alterar status
            </button>
            {statusMenuOpen && (
              <ul className="pedmodal-status-menu">
                {STATUS_PEDIDO_OPCOES.map((status) => (
                  <li key={status}>
                    <button
                      type="button"
                      className={`pedmodal-status-option${
                        status === pedido.status_pedido
                          ? " pedmodal-status-option--current"
                          : ""
                      }${status === "CANCELADO" ? " pedmodal-status-option--danger" : ""}`}
                      onClick={() => {
                        setStatusMenuOpen(false);
                        onAlterarStatus(status);
                      }}
                    >
                      {STATUS_LABEL[status]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {pedido &&
          !anulado &&
          (pedido.arquivado === 1 ||
            pedido.status_pedido === "ENTREGUE" ||
            pedido.status_pedido === "CANCELADO") && (
            <button
              type="button"
              className={
                pedido.arquivado === 1
                  ? "pedmodal-btn-edit"
                  : "pedmodal-btn-archive"
              }
              onClick={onArquivar}
              disabled={arquivando}
            >
              {arquivando
                ? "Salvando..."
                : pedido.arquivado === 1
                  ? "Restaurar"
                  : "Arquivar pedido"}
            </button>
          )}
        {pedido && !anulado && (
          <details ref={moreMenuRef} className="pedmodal-more">
            <summary aria-label="Mais ações do pedido">⋮</summary>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onExcluir();
              }}
            >
              Excluir pedido
            </button>
          </details>
        )}
        <button className="pedmodal-btn-close" onClick={onClose}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>
      </div>
    </div>
  );
}
