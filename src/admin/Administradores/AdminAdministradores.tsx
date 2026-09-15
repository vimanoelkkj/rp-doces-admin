import { useState } from "react";
import AdminSidebar from "../components/AdminSidebar";
import AdminWave from "../components/AdminWave";
import "./AdminAdministradores.css";
import NovoAdminModal from "./NovoAdminModal";

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

/* ── Types ── */
interface Admin {
  id: number;
  name: string;
  handle: string;
  email: string;
  level: "Mestre" | "Administrador";
  since: string;
  status: "Ativo" | "Inativo";
  avatarInitial: string;
  avatarBg: string;
  avatarImg?: string;
  isYou?: boolean;
}

/* ── Mock data ── */
const ADMINS: Admin[] = [
  {
    id: 1,
    name: "Paula",
    handle: "@paula",
    email: "paulatemponi@gmail.com",
    level: "Mestre",
    since: "20 de ago. de 2026",
    status: "Ativo",
    avatarInitial: "P",
    avatarBg: "#f2d2d5",
  },
  {
    id: 2,
    name: "Rhayelle",
    handle: "@rhayelle11",
    email: "rhayelle@gmail.com",
    level: "Mestre",
    since: "10 de ago. de 2026",
    status: "Ativo",
    avatarInitial: "R",
    avatarBg: "#d5e3f2",
    avatarImg: "/avatars/rhayelle.jpg",
  },
  {
    id: 3,
    name: "Vitor Manoel",
    handle: "@vitor",
    email: "vitormanoelalmeida2024@gmail.com",
    level: "Mestre",
    since: "30 de ago. de 2026",
    status: "Ativo",
    avatarInitial: "VM",
    avatarBg: "#f2e0d5",
    avatarImg: "/avatars/vitor.jpg",
    isYou: true,
  },
];
export default function AdminAdministradores() {
  const [admins] = useState<Admin[]>(ADMINS);

  const [novoAdminOpen, setNovoAdminOpen] = useState(false);

  const totalContas = admins.length;
  const totalAtivas = admins.filter((a) => a.status === "Ativo").length;
  const totalMestres = admins.filter(
    (a) => a.level === "Mestre" && a.status === "Ativo",
  ).length;

  return (
    <div className="adm-layout">
      <AdminWave />
      <AdminSidebar />

      <main className="adm-main">
        {/* ── Header ── */}
        <header className="adm-header">
          <div>
            <h1 className="adm-title">Administradores</h1>
            <p className="adm-subtitle">
              Contas, níveis de acesso e segurança da equipe
            </p>
          </div>
          <button
            className="adm-btn-new"
            onClick={() => setNovoAdminOpen(true)}
          >
            <IconPlus />
            Novo administrador
          </button>
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

        {/* ── Admin cards ── */}
        <div className="adm-cards-grid">
          {admins.map((admin) => (
            <div
              key={admin.id}
              className={`adm-card ${admin.isYou ? "adm-card--full" : ""}`}
            >
              {/* Top row: avatar + name + status */}
              <div className="adm-card-top">
                <div className="adm-card-identity">
                  <div
                    className="adm-avatar"
                    style={{ background: admin.avatarBg }}
                  >
                    {admin.avatarImg ? (
                      <img src={admin.avatarImg} alt={admin.name} />
                    ) : (
                      <span>{admin.avatarInitial}</span>
                    )}
                  </div>
                  <div className="adm-card-name-group">
                    <div className="adm-card-name-row">
                      <span className="adm-card-name">{admin.name}</span>
                      {admin.isYou && (
                        <span className="adm-badge-you">VOCÊ</span>
                      )}
                    </div>
                    <span className="adm-card-handle">{admin.handle}</span>
                  </div>
                </div>
                <span className="adm-badge-status adm-badge-status--ativo">
                  Ativo
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
                    <span className="adm-badge-level">{admin.level}</span>
                  </span>
                </div>
                <div className="adm-detail">
                  <span className="adm-detail-label">
                    <IconCalendar /> DESDE
                  </span>
                  <span className="adm-detail-value">{admin.since}</span>
                </div>
              </div>

              {/* Divider */}
              <div className="adm-card-divider" />

              {/* Actions row */}
              <div className="adm-card-actions">
                <button className="adm-action-btn">Alterar senha</button>
                {!admin.isYou && (
                  <>
                    <button className="adm-action-btn">
                      Tornar administrador
                    </button>
                    <button className="adm-action-btn adm-action-btn--danger">
                      Desativar
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <NovoAdminModal
          open={novoAdminOpen}
          onClose={() => setNovoAdminOpen(false)}
        />
      </main>
    </div>
  );
}
