import { Fragment } from "react";
import { etapasDaLinhaDoTempo, type EstadoEtapa, type StatusPedido } from "../lib/pedidoConfirmado";

interface ConfirmadoTimelineProps {
  statusPedido: StatusPedido;
}

const CLASSE_ETAPA: Record<EstadoEtapa, string> = {
  done: "tl-step--done",
  current: "tl-step--current",
  pending: ""
};

// A linha que antecede uma etapa acompanha o estado dela.
const CLASSE_LINHA: Record<EstadoEtapa, string> = {
  done: "tl-line--done",
  current: "tl-line--active",
  pending: ""
};

const SUFIXO: Record<EstadoEtapa, string | null> = {
  done: ": concluída",
  current: null,
  pending: ": pendente"
};

const ICONE_CONCLUIDA = (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path
      d="M5 13L9 17L19 7"
      stroke="#fff"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PONTOS = (
  <span className="tl-dots">
    <span />
    <span />
    <span />
  </span>
);

// Linha do tempo de preparo da tela de confirmação; as classes `tl-*` vêm de PedidoConfirmado.css.
export default function ConfirmadoTimeline({ statusPedido }: ConfirmadoTimelineProps) {
  return (
    <div className="confirmado-timeline">
      {etapasDaLinhaDoTempo(statusPedido).map((etapa, i) => (
        <Fragment key={etapa.id}>
          {i > 0 ? <div className={`tl-line ${CLASSE_LINHA[etapa.estado]}`} /> : null}
          <div
            className={`tl-step ${CLASSE_ETAPA[etapa.estado]}`}
            aria-current={etapa.estado === "current" ? "step" : undefined}
          >
            <div className="tl-dot">
              {etapa.estado === "done"
                ? ICONE_CONCLUIDA
                : etapa.estado === "current"
                  ? PONTOS
                  : null}
            </div>
            <span>{etapa.rotulo}</span>
            {SUFIXO[etapa.estado] ? (
              <span className="tl-status-label">{SUFIXO[etapa.estado]}</span>
            ) : null}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
