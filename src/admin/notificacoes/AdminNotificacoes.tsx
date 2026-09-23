import { useNavigate } from "react-router-dom";
import { useNotificacoes, type Notificacao } from "./NotificacoesContext";
import PushNotificationCard from "./PushNotificationCard";
import "./AdminNotificacoes.css";

// HUMAN-14 — página de notificações.
//
// Superfície escolhida: a rota `/admin/notificacoes`, que JÁ existia no menu
// lateral e apontava para lugar nenhum. Resolver aqui trata a rota antiga e
// evita inventar um header com sino que este admin não tem — a navegação
// atual foi preservada.
//
// A referência do Figma entrou como comportamento (marcar todas, lida/não
// lida, ícone por tipo, tempo relativo, estado vazio), adaptada à linguagem
// visual do admin (mesmos painéis, tipografia e tokens das outras páginas).

const ICONES: Record<Notificacao["tipo"], React.ReactNode> = {
  PEDIDO: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h10l-1 8H4L3 5z" />
      <path d="M6 5V3.5a2 2 0 014 0V5" />
    </svg>
  ),
  PAGAMENTO: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 8.2l1.8 1.8L10.8 6.4" />
    </svg>
  ),
  ESTOQUE: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.2l6 10.6H2L8 2.2z" />
      <path d="M8 6.6v3M8 11.4v.2" />
    </svg>
  ),
  OPERACAO: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.4M8 10.8v.2" />
    </svg>
  ),
  TESTE: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h4M8 2v3.5l3.2 6a1.6 1.6 0 01-1.4 2.5H6.2a1.6 1.6 0 01-1.4-2.5L8 5.5" />
    </svg>
  ),
};

// Tempo relativo simples e honesto: nunca inventa precisão que não temos.
function tempoRelativo(iso: string): string {
  const instante = Date.parse(
    /[TZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${String(iso).replace(" ", "T")}Z`,
  );
  if (!Number.isFinite(instante)) return "";
  const segundos = Math.max(0, Math.round((Date.now() - instante) / 1000));
  if (segundos < 60) return "agora";
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? "ontem" : `há ${dias} dias`;
}

export default function AdminNotificacoes() {
  const navigate = useNavigate();
  const { notificacoes, naoLidas, loading, error, marcarComoLidas, marcarTodasComoLidas } =
    useNotificacoes();

  const abrir = async (notificacao: Notificacao) => {
    if (!notificacao.lida) await marcarComoLidas([notificacao.chave]);
    if (notificacao.destino) navigate(notificacao.destino);
  };

  return (
    <main className="admin-main">
      <div className="notif-header-row">
        <div>
          <h1 className="notif-title">Notificações</h1>
          <p className="notif-subtitle">
            Pedidos, pagamentos, estoque e cobranças que pedem atenção.
          </p>
        </div>
        <button
          type="button"
          className="notif-mark-all"
          onClick={() => marcarTodasComoLidas()}
          disabled={naoLidas === 0}
        >
          Marcar todas como lidas
        </button>
      </div>

      <PushNotificationCard />

      <section className="notif-panel">
        {error && <p className="notif-error">{error}</p>}

        {!error && loading && notificacoes.length === 0 && (
          <p className="notif-loading">Carregando…</p>
        )}

        {!error && !loading && notificacoes.length === 0 && (
          <div className="notif-empty">
            <div className="notif-empty-icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 106 8c0 6-3 7-3 7h18s-3-1-3-7" />
                <path d="M13.7 21a2 2 0 01-3.4 0" />
              </svg>
            </div>
            <span className="notif-empty-title">Tudo em dia</span>
            <span className="notif-empty-subtitle">Você não tem notificações no momento.</span>
          </div>
        )}

        {notificacoes.map((notificacao) => (
          <button
            key={notificacao.chave}
            type="button"
            className={`notif-row${notificacao.lida ? "" : " notif-row--unread"}`}
            onClick={() => abrir(notificacao)}
          >
            <span className="notif-row-icon" aria-hidden="true">
              {ICONES[notificacao.tipo]}
            </span>
            <span className="notif-row-text">
              <span className="notif-row-title">{notificacao.titulo}</span>
              <span className="notif-row-desc">{notificacao.descricao}</span>
              <span className="notif-row-time">{tempoRelativo(notificacao.em)}</span>
            </span>
            {!notificacao.lida && <span className="notif-row-dot" aria-label="Não lida" />}
          </button>
        ))}
      </section>
    </main>
  );
}
