import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import "./HistoricoComandaModal.css";

type EventoTipo =
  | "ITEM_ADICIONADO"
  | "TROCA_SOLICITADA"
  | "TROCA_CONCLUIDA"
  | "CANCELAMENTO_SOLICITADO"
  | "CANCELAMENTO_CONCLUIDO"
  | "PAGAMENTO"
  | "REEMBOLSO";

interface ItemRef {
  id: number | null;
  nome: string;
  quantidade?: number;
  valorCentavos?: number;
  estoqueEstado?: string | null;
}

interface HistoricoEvento {
  id: string;
  tipo: EventoTipo;
  data: string;
  titulo: string;
  status?: string | null;
  item?: ItemRef;
  itemOrigem?: ItemRef;
  itemDestino?: ItemRef;
  diferencaCentavos?: number;
  tipoDiferenca?: string;
  metodo?: string | null;
  metodosReembolso?: string[];
  valorCentavos?: number;
  valorReembolsoCentavos?: number;
  estoqueAcao?: string | null;
  motivo?: string;
  usuario?: string | null;
  referenciaId?: number;
}

interface Props {
  orderId: number;
  onClose: () => void;
  onVerCancelamento: (itemId: number) => void;
  onVerTroca: (itemId: number) => void;
}

const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

const formatarData = (isoLike: string) => {
  const iso = isoLike.replace(" ", "T");
  const comFuso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  return new Date(comFuso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const METODO_LABEL: Record<string, string> = {
  PIX_MP: "Pix Mercado Pago",
  PIX_EXTERNO: "Pix externo",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
  A_COMBINAR: "A combinar",
};
const metodoLabel = (codigo: string) => METODO_LABEL[codigo] ?? codigo;
const metodosLabel = (codigos: string[]) => codigos.map(metodoLabel).join(" + ");

const ESTOQUE_ACAO_LABEL: Record<string, string> = {
  LIBERAR_RESERVA: "Liberou reserva",
  NAO_REPOR: "Não repôs estoque",
  REPOR: "Repôs estoque",
  NENHUMA: "Sem ação de estoque",
};

const ESTOQUE_ESTADO_LABEL: Record<string, string> = {
  RESERVADO: "reservado",
  BAIXADO: "baixado",
  LIBERADO: "liberado",
  REPOSTO: "reposto",
  SEM_RESERVA: "sem reserva",
};

interface Badge { label: string; cor: "green" | "orange" | "red" }
const STATUS_BADGE: Record<string, Badge> = {
  CONCLUIDA: { label: "Concluído", cor: "green" },
  CONCLUIDO: { label: "Concluído", cor: "green" },
  AGUARDANDO_COBRANCA: { label: "Aguardando pagamento", cor: "orange" },
  AGUARDANDO_REEMBOLSO: { label: "Aguardando devolução", cor: "orange" },
  INCONCLUSIVA: { label: "Inconclusivo", cor: "red" },
  INCONCLUSIVO: { label: "Inconclusivo", cor: "red" },
  FALHOU: { label: "Cancelado", cor: "red" },
};

function EventoBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const badge = STATUS_BADGE[status];
  if (!badge) return null;
  return <span className={`histmodal-badge histmodal-badge--${badge.cor}`}>{badge.label}</span>;
}

function VerDetalhesButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="histmodal-btn-detalhes" onClick={onClick}>
      Ver detalhes
    </button>
  );
}

function EventoCard({
  evento,
  onVerCancelamento,
  onVerTroca,
}: {
  evento: HistoricoEvento;
  onVerCancelamento: (itemId: number) => void;
  onVerTroca: (itemId: number) => void;
}) {
  return (
    <div className="histmodal-evento">
      <div className="histmodal-evento-head">
        <span className="histmodal-evento-titulo">{evento.titulo}</span>
        <EventoBadge status={evento.status} />
      </div>
      <div className="histmodal-evento-data">{formatarData(evento.data)}</div>

      {evento.tipo === "ITEM_ADICIONADO" && evento.item && (
        <div className="histmodal-evento-linha">
          {evento.item.quantidade}x {formatarPreco(evento.item.valorCentavos ?? 0)}
        </div>
      )}

      {(evento.tipo === "TROCA_SOLICITADA" || evento.tipo === "TROCA_CONCLUIDA") && (
        <>
          <div className="histmodal-troca-linha">
            <span>{evento.itemOrigem?.nome} · {formatarPreco(evento.itemOrigem?.valorCentavos ?? 0)}</span>
            <span className="histmodal-seta" aria-hidden="true">→</span>
            <span>{evento.itemDestino?.nome} · {formatarPreco(evento.itemDestino?.valorCentavos ?? 0)}</span>
          </div>
          {evento.tipoDiferenca && evento.tipoDiferenca !== "ZERO" && evento.diferencaCentavos != null && (
            <div className="histmodal-evento-linha">
              {evento.tipoDiferenca === "COBRAR" ? "Diferença cobrada" : "Diferença devolvida"}:{" "}
              {formatarPreco(Math.abs(evento.diferencaCentavos))}
              {evento.metodosReembolso && ` · ${metodosLabel(evento.metodosReembolso)}`}
            </div>
          )}
          <div className="histmodal-evento-linha">
            Estoque origem: {ESTOQUE_ACAO_LABEL[evento.estoqueAcao ?? ""] ?? evento.estoqueAcao}
            {evento.itemDestino?.estoqueEstado &&
              ` · Estado destino: ${ESTOQUE_ESTADO_LABEL[evento.itemDestino.estoqueEstado] ?? evento.itemDestino.estoqueEstado}`}
          </div>
          {evento.referenciaId != null && (
            <VerDetalhesButton onClick={() => onVerTroca(evento.referenciaId!)} />
          )}
        </>
      )}

      {(evento.tipo === "CANCELAMENTO_SOLICITADO" || evento.tipo === "CANCELAMENTO_CONCLUIDO") && evento.item && (
        <>
          <div className="histmodal-evento-linha">
            {evento.item.nome} · {formatarPreco(evento.item.valorCentavos ?? 0)}
          </div>
          {evento.valorReembolsoCentavos != null && (
            <div className="histmodal-evento-linha">
              Reembolso: {formatarPreco(evento.valorReembolsoCentavos)}
              {evento.metodosReembolso && ` · ${metodosLabel(evento.metodosReembolso)}`}
            </div>
          )}
          <div className="histmodal-evento-linha">
            Estoque: {ESTOQUE_ACAO_LABEL[evento.estoqueAcao ?? ""] ?? evento.estoqueAcao}
            {evento.item.estoqueEstado &&
              ` · Estado final: ${ESTOQUE_ESTADO_LABEL[evento.item.estoqueEstado] ?? evento.item.estoqueEstado}`}
          </div>
          {evento.referenciaId != null && (
            <VerDetalhesButton onClick={() => onVerCancelamento(evento.referenciaId!)} />
          )}
        </>
      )}

      {evento.tipo === "PAGAMENTO" && (
        <div className="histmodal-evento-linha">
          {metodoLabel(evento.metodo ?? "")} · {formatarPreco(evento.valorCentavos ?? 0)}
        </div>
      )}

      {evento.tipo === "REEMBOLSO" && (
        <div className="histmodal-evento-linha">
          {metodoLabel(evento.metodo ?? "")} · {formatarPreco(evento.valorReembolsoCentavos ?? 0)}
          {evento.motivo && <div className="histmodal-evento-motivo">{evento.motivo}</div>}
        </div>
      )}
    </div>
  );
}

export default function HistoricoComandaModal({
  orderId,
  onClose,
  onVerCancelamento,
  onVerTroca,
}: Props) {
  const modalProps = useAdminModal(true, onClose);
  const [eventos, setEventos] = useState<HistoricoEvento[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/admin/pedidos/${orderId}/historico`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Falha ao carregar histórico");
        return body as { eventos: HistoricoEvento[] };
      })
      .then((body) => {
        if (active) setEventos(body.eventos);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  return createPortal(
    <div className="histmodal-overlay" {...modalProps}>
      <div className="histmodal-card">
        <div className="histmodal-header">
          <h2 className="histmodal-title">Histórico da comanda</h2>
          <button type="button" className="histmodal-btn-close" onClick={onClose} aria-label="Fechar histórico">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        <div className="histmodal-body">
          {loading && <p className="histmodal-status">Carregando...</p>}
          {error && <p className="histmodal-status histmodal-status--error">{error}</p>}
          {!loading && !error && eventos && eventos.length === 0 && (
            <p className="histmodal-status">Nenhum evento registrado ainda.</p>
          )}
          {!loading && !error && eventos && eventos.length > 0 && (
            <div className="histmodal-timeline">
              {eventos.map((evento) => (
                <EventoCard
                  key={evento.id}
                  evento={evento}
                  onVerCancelamento={onVerCancelamento}
                  onVerTroca={onVerTroca}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
