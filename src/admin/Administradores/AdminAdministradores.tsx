import { useEffect, useState } from "react";
import "./AdminAdministradores.css";
import NovoAdminModal from "./NovoAdminModal";
import AlterarSenhaModal from "./AlterarSenhaModal";
import { useAdminAuth } from "../auth/AdminAuthContext";

/* ── Inline SVG icons ── */
const IconPlus = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
  >
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const IconMail = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="4" width="16" height="12" rx="2" />
    <path d="M2 6l8 5 8-5" />
  </svg>
);

const IconShield = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 2l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V5l7-3z" />
  </svg>
);

const IconCalendar = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="4" width="14" height="14" rx="2" />
    <path d="M7 2v4M13 2v4M3 9h14" />
  </svg>
);

/* ── Types (espelham o retorno de GET /api/admin/administradores) ── */
interface AdminRow {
  id: number;
  nome: string;
  username: string;
  email: string;
  ativo: number;
  papel: "OWNER" | "ADMIN";
  criado_em: string;
}

const AVATAR_COLORS = ["#f2d2d5", "#d5e3f2", "#f2e0d5", "#d9f2d5", "#e5d5f2"];

function avatarBg(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function initialsFor(nome: string) {
  const parts = nome.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : nome.slice(0, 2).toUpperCase();
}

function formatDesde(iso: string) {
  return new Date(iso.replace(" ", "T")).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function AdminAdministradores() {
  const { user, logout } = useAdminAuth();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [novoAdminOpen, setNovoAdminOpen] = useState(false);
  const [senhaAlvo, setSenhaAlvo] = useState<AdminRow | null>(null);

  const carregarAdmins = () => {
    setLoading(true);
    fetch("/api/admin/administradores")
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar administradores");
        return response.json() as Promise<{ administradores: AdminRow[] }>;
      })
      .then((data) => {
        setAdmins(data.administradores);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(carregarAdmins, []);

  const executarAcao = (
    id: number,
    body: Record<string, unknown>,
  ) => {
    setError(null);
    fetch(`/api/admin/administradores/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        if (!response.ok) {
          const respBody = await response.json().catch(() => ({}));
          throw new Error(respBody.error ?? "Falha ao executar ação");
        }
        carregarAdmins();
      })
      .catch((err) => setError(err.message));
  };

  const isOwner = user.papel === "OWNER";
  const totalContas = admins.length;
  const totalAtivas = admins.filter((a) => a.ativo === 1).length;
  const totalMestres = admins.filter(
    (a) => a.papel === "OWNER" && a.ativo === 1,
  ).length;

  return (
    <main className="adm-main">
      {/* ── Header ── */}
      <header className="adm-header">
        <div>
          <h1 className="adm-title">Administradores</h1>
          <p className="adm-subtitle">
            Contas, níveis de acesso e segurança da equipe
          </p>
        </div>
        {isOwner && (
          <button
            className="adm-btn-new"
            onClick={() => setNovoAdminOpen(true)}
          >
            <IconPlus />
            Novo administrador
          </button>
        )}
      </header>

      {/* ── KPI strip ── */}
      <div className="adm-kpi-strip">
        <div className="adm-kpi-card">
          <span className="adm-kpi-label">CONTAS</span>
          <span className="adm-kpi-value">{totalContas}</span>
        </div>
        <div className="adm-kpi-card">
          <span className="adm-kpi-label">ATIVAS</span>
          <span className="adm-kpi-value">{totalAtivas}</span>
        </div>
        <div className="adm-kpi-card">
          <span className="adm-kpi-label">MESTRES ATIVOS</span>
          <span className="adm-kpi-value">{totalMestres}</span>
        </div>
      </div>

      {error && <p className="adm-error">{error}</p>}
      {loading && <p className="adm-empty-message">Carregando…</p>}

      {/* ── Admin cards ── */}
      <div className="adm-cards-grid">
        {admins.map((admin) => {
          const isYou = admin.id === user.id;
          return (
            <div
              key={admin.id}
              className={`adm-card ${isYou ? "adm-card--full" : ""}`}
            >
              {/* Top row: avatar + name + status */}
              <div className="adm-card-top">
                <div className="adm-card-identity">
                  <div
                    className="adm-avatar"
                    style={{ background: avatarBg(admin.id) }}
                  >
                    <span>{initialsFor(admin.nome)}</span>
                  </div>
                  <div className="adm-card-name-group">
                    <div className="adm-card-name-row">
                      <span className="adm-card-name">{admin.nome}</span>
                      {isYou && <span className="adm-badge-you">VOCÊ</span>}
                    </div>
                    <span className="adm-card-handle">@{admin.username}</span>
                  </div>
                </div>
                <span
                  className={`adm-badge-status adm-badge-status--${admin.ativo ? "ativo" : "inativo"}`}
                >
                  {admin.ativo ? "Ativo" : "Inativo"}
                </span>
              </div>

              {/* Details row */}
              <div className="adm-card-details">
                <div className="adm-detail">
                  <span className="adm-detail-label">
                    <IconMail /> E-MAIL
                  </span>
                  <span className="adm-detail-value">{admin.email}</span>
                </div>
                <div className="adm-detail">
                  <span className="adm-detail-label">
                    <IconShield /> NÍVEL
                  </span>
                  <span className="adm-detail-value">
                    <span className="adm-badge-level">
                      {admin.papel === "OWNER" ? "Mestre" : "Administrador"}
                    </span>
                  </span>
                </div>
                <div className="adm-detail">
                  <span className="adm-detail-label">
                    <IconCalendar /> DESDE
                  </span>
                  <span className="adm-detail-value">
                    {formatDesde(admin.criado_em)}
                  </span>
                </div>
              </div>

              {/* Divider */}
              <div className="adm-card-divider" />

              {/* Actions row */}
              <div className="adm-card-actions">
                {(isYou || isOwner) && (
                  <button
                    className="adm-action-btn"
                    onClick={() => setSenhaAlvo(admin)}
                  >
                    Alterar senha
                  </button>
                )}
                {!isYou && isOwner && (
                  <>
                    <button
                      className="adm-action-btn"
                      onClick={() =>
                        executarAcao(admin.id, {
                          acao: "alterar_papel",
                          papel: admin.papel === "OWNER" ? "ADMIN" : "OWNER",
                        })
                      }
                    >
                      {admin.papel === "OWNER"
                        ? "Tornar administrador"
                        : "Tornar mestre"}
                    </button>
                    <button
                      className="adm-action-btn adm-action-btn--danger"
                      onClick={() =>
                        executarAcao(admin.id, {
                          acao: "toggle_ativo",
                          ativo: admin.ativo !== 1,
                        })
                      }
                    >
                      {admin.ativo ? "Desativar" : "Ativar"}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <NovoAdminModal
        open={novoAdminOpen}
        onClose={() => setNovoAdminOpen(false)}
        onSaved={carregarAdmins}
      />
      <AlterarSenhaModal
        adminId={senhaAlvo?.id ?? null}
        adminNome={senhaAlvo?.nome ?? ""}
        isSelf={senhaAlvo != null && senhaAlvo.id === user.id}
        onClose={() => setSenhaAlvo(null)}
        onSaved={() => {
          if (senhaAlvo?.id === user.id) {
            logout();
          } else {
            carregarAdmins();
          }
        }}
      />
    </main>
  );
}
