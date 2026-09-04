import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { AuthSession } from "../auth/AuthGate";
import { AdminShell, type AdminV2Page } from "../layout/AdminShell";
import { useBackLayer } from "../shared/useBackLayer";
import { usePageScrollLock } from "../shared/usePageScrollLock";
import {
  createAdmin,
  listAdmins,
  resetAdminPassword,
  setAdminActive,
  setAdminRole
} from "./admin.api";
import type { AdminRole, AdminUser } from "./admin.types";
import styles from "./AdminsPage.module.css";

type Props = {
  session: AuthSession;
  onNavigate: (page: AdminV2Page) => void;
};

type ConfirmState =
  | { kind: "role"; user: AdminUser; nextRole: AdminRole }
  | { kind: "active"; user: AdminUser; nextActive: boolean };

let adminsCache: AdminUser[] | null = null;

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() || "")
      .join("") || "RP"
  );
}

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Modal({
  children,
  onClose,
  label,
  compact = false
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  compact?: boolean;
}) {
  usePageScrollLock(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <section
        className={`${styles.dialog} ${compact ? styles.dialogCompact : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={event => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

export function AdminsPage({ session, onNavigate }: Props) {
  const { user: viewer } = session;
  const isOwner = viewer.papel === "OWNER";
  const [users, setUsers] = useState<AdminUser[]>(() => adminsCache ?? []);
  const [loading, setLoading] = useState(() => adminsCache === null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [passwordOpenId, setPasswordOpenId] = useState<number | null>(null);
  const [passwordBusyId, setPasswordBusyId] = useState<number | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const closeCreate = useBackLayer(
    createOpen,
    () => setCreateOpen(false),
    "admin-create"
  );
  const closeConfirm = useBackLayer(
    confirm !== null,
    () => setConfirm(null),
    "admin-confirm"
  );

  const reload = useCallback(async () => {
    const foreground = adminsCache === null;
    if (foreground) setLoading(true);
    setError(null);
    try {
      const next = await listAdmins();
      adminsCache = next;
      setUsers(next);
    } catch (err) {
      setError(errorMessage(err, "Não foi possível carregar os administradores."));
    } finally {
      if (foreground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeCount = useMemo(() => users.filter(user => user.ativo).length, [users]);
  const ownerCount = useMemo(
    () => users.filter(user => user.ativo && user.papel === "OWNER").length,
    [users]
  );

  function openPassword(id: number) {
    setPasswordError(null);
    setPasswordOpenId(current => (current === id ? null : id));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createBusy) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const senha = String(data.get("senha") || "");
    const confirmacao = String(data.get("confirmacao") || "");
    if (senha !== confirmacao) {
      setCreateError("As senhas não coincidem.");
      return;
    }

    setCreateBusy(true);
    setCreateError(null);
    try {
      await createAdmin({
        nome: String(data.get("nome") || "").trim(),
        username: String(data.get("username") || "").trim().toLowerCase(),
        email: String(data.get("email") || "").trim().toLowerCase(),
        senha,
        papel: data.get("papel") === "OWNER" ? "OWNER" : "ADMIN"
      });
      closeCreate();
      setFeedback("Administrador criado com sucesso.");
      form.reset();
      await reload();
    } catch (err) {
      setCreateError(errorMessage(err, "Não foi possível criar o administrador."));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>, target: AdminUser) {
    event.preventDefault();
    if (passwordBusyId !== null) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    const senha = String(data.get("senha") || "");
    const confirmacao = String(data.get("confirmacao") || "");
    if (senha !== confirmacao) {
      setPasswordError("As senhas não coincidem.");
      return;
    }

    setPasswordBusyId(target.id);
    setPasswordError(null);
    try {
      await resetAdminPassword(target.id, senha);
      if (target.id === viewer.id) {
        window.location.reload();
        return;
      }
      setFeedback(`Senha de ${target.nome} alterada. As sessões anteriores foram encerradas.`);
      setPasswordOpenId(null);
      form.reset();
      await reload();
    } catch (err) {
      setPasswordError(errorMessage(err, "Não foi possível alterar a senha."));
    } finally {
      setPasswordBusyId(null);
    }
  }

  async function handleConfirmedAction() {
    if (!confirm || confirmBusy) return;
    setConfirmBusy(true);
    setError(null);

    try {
      if (confirm.kind === "role") {
        await setAdminRole(confirm.user.id, confirm.nextRole);
        setFeedback(
          `${confirm.user.nome} agora é ${confirm.nextRole === "OWNER" ? "Mestre" : "Administrador"}. As sessões anteriores foram encerradas.`
        );
      } else {
        await setAdminActive(confirm.user.id, confirm.nextActive);
        setFeedback(
          confirm.nextActive
            ? `${confirm.user.nome} foi reativado.`
            : `${confirm.user.nome} foi desativado e teve as sessões encerradas.`
        );
      }
      closeConfirm();
      await reload();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível concluir a alteração."));
      closeConfirm();
    } finally {
      setConfirmBusy(false);
    }
  }

  const confirmCopy = confirm
    ? confirm.kind === "role"
      ? {
          kicker: "Nível de acesso",
          title:
            confirm.nextRole === "OWNER"
              ? `Tornar ${confirm.user.nome} mestre?`
              : `Tornar ${confirm.user.nome} administrador?`,
          message:
            confirm.nextRole === "OWNER"
              ? "A conta passará a poder criar e gerenciar outros administradores. As sessões atuais dessa conta serão encerradas."
              : "A conta deixará de gerenciar outros administradores. As sessões atuais dessa conta serão encerradas.",
          label: confirm.nextRole === "OWNER" ? "Tornar mestre" : "Tornar administrador",
          danger: false
        }
      : {
          kicker: "Estado da conta",
          title: confirm.nextActive
            ? `Reativar ${confirm.user.nome}?`
            : `Desativar ${confirm.user.nome}?`,
          message: confirm.nextActive
            ? "A conta poderá voltar a acessar o painel normalmente."
            : "O acesso será bloqueado imediatamente e todas as sessões dessa conta serão encerradas.",
          label: confirm.nextActive ? "Reativar conta" : "Desativar conta",
          danger: !confirm.nextActive
        }
    : null;

  return (
    <>
      <AdminShell
        session={session}
        activePage="admins"
        title="Administradores"
        subtitle="Contas, níveis de acesso e segurança da equipe"
        onNavigate={onNavigate}
      >
        <section className={styles.toolbar}>
          <div className={styles.heading}>
            <p className={styles.kicker}>Controle de acesso</p>
            <h2>{isOwner ? "Equipe administrativa" : "Sua conta"}</h2>
            <p>
              {isOwner
                ? "Gerencie quem pode acessar e operar o painel da R&P Doces."
                : "Confira os dados do seu acesso e altere sua senha quando precisar."}
            </p>
          </div>
          {isOwner ? (
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              + Novo administrador
            </button>
          ) : null}
        </section>

        <section className={styles.summary} aria-label="Resumo das contas">
          <div className={styles.summaryCard}><span>Contas</span><strong>{loading ? "…" : users.length}</strong></div>
          <div className={styles.summaryCard}><span>Ativas</span><strong>{loading ? "…" : activeCount}</strong></div>
          <div className={styles.summaryCard}><span>Mestres ativos</span><strong>{loading ? "…" : ownerCount}</strong></div>
        </section>

        {feedback ? <div className={styles.feedback} role="status">{feedback}</div> : null}
        {error ? (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void reload()}>Tentar novamente</button>
          </div>
        ) : null}

        {loading && users.length === 0 ? <div className={styles.loading}>Carregando administradores…</div> : null}

        <section className={styles.grid}>
          {users.map(user => {
            const self = user.id === viewer.id;
            const canManage = isOwner && !self;
            const canResetPassword = isOwner || self;
            const nextRole: AdminRole = user.papel === "OWNER" ? "ADMIN" : "OWNER";
            const passwordOpen = passwordOpenId === user.id;

            return (
              <article key={user.id} className={`${styles.card} ${user.ativo ? "" : styles.cardDisabled}`}>
                <div className={styles.cardHead}>
                  {user.avatar_url ? (
                    <img className={styles.avatar} src={user.avatar_url} alt="" />
                  ) : (
                    <span className={styles.avatarFallback} aria-hidden="true">{initials(user.nome || user.username)}</span>
                  )}
                  <div className={styles.identity}>
                    <div className={styles.nameRow}>
                      <h3>{user.nome || user.username}</h3>
                      {self ? <span className={styles.you}>Você</span> : null}
                    </div>
                    <p>@{user.username}</p>
                  </div>
                  <span className={`${styles.badge} ${user.ativo ? styles.badgeActive : styles.badgeInactive}`}>
                    {user.ativo ? "Ativo" : "Inativo"}
                  </span>
                </div>

                <div className={styles.meta}>
                  <div><span>E-mail</span><strong title={user.email || undefined}>{user.email || "—"}</strong></div>
                  <div>
                    <span>Nível</span>
                    <strong>
                      <span className={`${styles.badge} ${user.papel === "OWNER" ? styles.badgeOwner : styles.badgeAdmin}`}>
                        {user.papel === "OWNER" ? "Mestre" : "Administrador"}
                      </span>
                    </strong>
                  </div>
                  <div><span>Desde</span><strong>{dateLabel(user.criado_em)}</strong></div>
                </div>

                <div className={styles.actions}>
                  {canResetPassword ? (
                    <button className={styles.secondaryButton} type="button" onClick={() => openPassword(user.id)}>
                      {passwordOpen ? "Fechar" : "Alterar senha"}
                    </button>
                  ) : null}
                  {canManage ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => setConfirm({ kind: "role", user, nextRole })}
                    >
                      {nextRole === "OWNER" ? "Tornar mestre" : "Tornar administrador"}
                    </button>
                  ) : null}
                  {canManage ? (
                    <button
                      className={user.ativo ? styles.dangerButton : styles.successButton}
                      type="button"
                      onClick={() => setConfirm({ kind: "active", user, nextActive: !user.ativo })}
                    >
                      {user.ativo ? "Desativar" : "Reativar"}
                    </button>
                  ) : null}
                </div>

                {passwordOpen ? (
                  <div className={styles.passwordPanel}>
                    <form onSubmit={event => void handlePassword(event, user)}>
                      <div className={styles.passwordHeading}>
                        <strong>Nova senha</strong>
                        <span>Mínimo de 8 caracteres, com pelo menos uma letra e um número.</span>
                      </div>
                      <div className={styles.passwordGrid}>
                        <label className={styles.field}>
                          <span>Senha</span>
                          <input name="senha" type="password" minLength={8} autoComplete="new-password" required autoFocus />
                        </label>
                        <label className={styles.field}>
                          <span>Confirmar</span>
                          <input name="confirmacao" type="password" minLength={8} autoComplete="new-password" required />
                        </label>
                      </div>
                      {passwordError ? <p className={styles.formError}>{passwordError}</p> : null}
                      <div className={styles.passwordActions}>
                        <button className={styles.secondaryButton} type="button" onClick={() => setPasswordOpenId(null)}>Cancelar</button>
                        <button className={styles.primaryButton} type="submit" disabled={passwordBusyId === user.id}>
                          {passwordBusyId === user.id ? "Salvando…" : "Salvar senha"}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

        {!loading && !error && users.length === 0 ? <div className={styles.empty}>Nenhuma conta encontrada.</div> : null}
      </AdminShell>

      {createOpen ? (
        <Modal label="Criar administrador" onClose={() => !createBusy && closeCreate()}>
          <form onSubmit={event => void handleCreate(event)}>
            <div className={styles.dialogHead}>
              <div><span>Novo acesso</span><h2>Criar administrador</h2></div>
              <button className={styles.closeButton} type="button" onClick={closeCreate} aria-label="Fechar" disabled={createBusy}>×</button>
            </div>
            <div className={styles.dialogBody}>
              <label className={styles.field}><span>Nome</span><input name="nome" minLength={2} maxLength={100} autoComplete="name" required autoFocus /></label>
              <label className={styles.field}><span>Usuário</span><input name="username" minLength={3} maxLength={30} pattern="[a-zA-Z0-9._-]+" autoComplete="off" placeholder="ex.: maria" required /></label>
              <label className={styles.field}><span>E-mail</span><input name="email" type="email" maxLength={254} autoComplete="email" required /></label>
              <label className={styles.field}><span>Senha inicial</span><input name="senha" type="password" minLength={8} autoComplete="new-password" required /></label>
              <label className={styles.field}><span>Confirmar senha</span><input name="confirmacao" type="password" minLength={8} autoComplete="new-password" required /></label>
              <fieldset className={styles.roleChoice}>
                <legend>Nível de acesso</legend>
                <label>
                  <input type="radio" name="papel" value="ADMIN" defaultChecked />
                  <span><strong>Administrador</strong><small>Opera a loja e gerencia a própria senha.</small></span>
                </label>
                <label>
                  <input type="radio" name="papel" value="OWNER" />
                  <span><strong>Mestre</strong><small>Pode criar e gerenciar outros administradores.</small></span>
                </label>
              </fieldset>
              {createError ? <p className={styles.formError}>{createError}</p> : null}
            </div>
            <div className={styles.dialogFooter}>
              <button className={styles.secondaryButton} type="button" onClick={closeCreate} disabled={createBusy}>Cancelar</button>
              <button className={styles.primaryButton} type="submit" disabled={createBusy}>{createBusy ? "Criando…" : "Criar administrador"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {confirm && confirmCopy ? (
        <Modal label={confirmCopy.title} compact onClose={() => !confirmBusy && closeConfirm()}>
          <div className={styles.dialogHead}>
            <div>
              <span>{confirmCopy.kicker}</span>
              <h2>{confirmCopy.title}</h2>
              <p>{confirmCopy.message}</p>
            </div>
            <button className={styles.closeButton} type="button" onClick={closeConfirm} aria-label="Fechar" disabled={confirmBusy}>×</button>
          </div>
          <div className={styles.dialogFooter}>
            <button className={styles.secondaryButton} type="button" onClick={closeConfirm} disabled={confirmBusy}>Cancelar</button>
            <button
              className={confirmCopy.danger ? styles.dangerButton : styles.primaryButton}
              type="button"
              onClick={() => void handleConfirmedAction()}
              disabled={confirmBusy}
            >
              {confirmBusy ? "Salvando…" : confirmCopy.label}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
