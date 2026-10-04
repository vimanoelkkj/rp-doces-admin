import type React from "react";

interface PedidosPaginacaoProps {
  startItem: number;
  endItem: number;
  total: number;
  currentPage: number;
  totalPages: number;
  onPageChange: React.Dispatch<React.SetStateAction<number>>;
}

export default function PedidosPaginacao({
  startItem,
  endItem,
  total,
  currentPage,
  totalPages,
  onPageChange
}: PedidosPaginacaoProps) {
  return (
    <div className="ped-pagination">
      <span className="ped-pagination-info">
        Mostrando {startItem}-{endItem} de {total} pedidos
      </span>
      <div className="ped-pagination-controls">
        <button
          type="button"
          className="ped-page-btn ped-page-arrow"
          aria-label="Página anterior"
          onClick={() => onPageChange(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9,2 4,7 9,12" />
          </svg>
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
          <button
            type="button"
            key={page}
            className={`ped-page-btn ped-page-num${currentPage === page ? " ped-page-num--active" : ""}`}
            onClick={() => onPageChange(page)}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          className="ped-page-btn ped-page-arrow"
          aria-label="Próxima página"
          onClick={() => onPageChange(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="5,2 10,7 5,12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
