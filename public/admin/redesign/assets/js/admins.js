import { adminApi } from "./api.js";

const esc = value =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map(part => part[0])
      .join("") || "RP"
  ).toUpperCase();
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

function statusBadge(user) {
  return `<span class="admins-badge ${Number(user.ativo) === 1 ? "is-active" : "is-inactive"}">${Number(user.ativo) === 1 ? "Ativo" : "Inativo"}</span>`;
}

function roleBadge(user) {
  return `<span class="admins-badge ${user.papel === "OWNER" ? "is-owner" : "is-admin"}">${user.papel === "OWNER" ? "Mestre" : "Administrador"}</span>`;
}

function passwordPanel(user) {
  return `
    <div class="admins-password-panel" data-admin-password-panel="${user.id}" hidden>
      <form class="admins-password-inline" data-admin-password-form="${user.id}">
        <div class="admins-password-inline__heading">
          <strong>Nova senha</strong>
          <span>Mínimo de 8 caracteres, com letra e número.</span>
        </div>
        <label>
          <span>Senha</span>
          <input name="senha" required type="password" minlength="8" autocomplete="new-password" />
        </label>
        <label>
          <span>Confirmar</span>
          <input name="confirmacao" required type="password" minlength="8" autocomplete="new-password" />
        </label>
        <p class="admins-form-error" data-admin-password-error hidden></p>
        <div class="admins-password-inline__actions">
          <button type="button" class="admins-secondary" data-admin-password-cancel="${user.id}">Cancelar</button>
          <button type="submit" class="admins-primary">Salvar senha</button>
        </div>
      </form>
    </div>`;
}

function userCard(user, viewer) {
  const isViewer = Number(user.id) === Number(viewer?.id);
  const viewerIsOwner = viewer?.papel === "OWNER";
  const canManage = viewerIsOwner && !isViewer;
  const canResetPassword = viewerIsOwner || isViewer;
  const nextRole = user.papel === "OWNER" ? "ADMIN" : "OWNER";
  const nextRoleLabel = nextRole === "OWNER" ? "Tornar mestre" : "Tornar administrador";

  return `
    <article class="admins-card${Number(user.ativo) === 1 ? "" : " is-disabled"}" data-admin-card="${user.id}">
      <div class="admins-card__head">
        <span class="admins-avatar" aria-hidden="true">${esc(initials(user.nome || user.username))}</span>
        <div class="admins-card__identity">
          <div class="admins-card__name-row">
            <h3>${esc(user.nome || user.username || "Administrador")}</h3>
            ${isViewer ? '<span class="admins-you">Você</span>' : ""}
          </div>
          <p>@${esc(user.username || "—")}</p>
        </div>
        ${statusBadge(user)}
      </div>

      <div class="admins-card__meta">
        <div><span>E-mail</span><strong>${esc(user.email || "—")}</strong></div>
        <div><span>Nível</span><strong>${roleBadge(user)}</strong></div>
        <div><span>Desde</span><strong>${esc(dateLabel(user.criado_em))}</strong></div>
      </div>

      <div class="admins-card__actions">
        ${canResetPassword ? `<button type="button" class="admins-secondary" data-admin-password="${user.id}" aria-expanded="false">Alterar senha</button>` : ""}
        ${canManage ? `<button type="button" class="admins-secondary" data-admin-role="${user.id}" data-admin-next-role="${nextRole}">${nextRoleLabel}</button>` : ""}
        ${canManage ? `<button type="button" class="admins-secondary ${Number(user.ativo) === 1 ? "is-danger" : "is-success"}" data-admin-toggle="${user.id}" data-admin-active="${Number(user.ativo) === 1 ? "true" : "false"}">${Number(user.ativo) === 1 ? "Desativar" : "Reativar"}</button>` : ""}
      </div>
      ${canResetPassword ? passwordPanel(user) : ""}
    </article>`;
}

function dialogShell() {
  return `
    <dialog class="admins-dialog" data-admin-create-dialog>
      <form method="dialog" class="admins-dialog__card" data-admin-create-form>
        <div class="admins-dialog__head">
          <div><span>Novo acesso</span><h2>Criar administrador</h2></div>
          <button type="button" class="admins-dialog__close" data-admin-dialog-close aria-label="Fechar">×</button>
        </div>
        <div class="admins-dialog__body">
          <label><span>Nome</span><input name="nome" required minlength="2" maxlength="100" autocomplete="name" /></label>
          <label><span>Usuário</span><input name="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9._-]+" autocomplete="off" placeholder="ex.: maria" /></label>
          <label><span>E-mail</span><input name="email" required type="email" maxlength="254" autocomplete="email" /></label>
          <label><span>Senha inicial</span><input name="senha" required type="password" minlength="8" autocomplete="new-password" /><small>Mínimo de 8 caracteres, com pelo menos uma letra e um número.</small></label>
          <fieldset class="admins-role-choice"><legend>Nível de acesso</legend><label><input type="radio" name="papel" value="ADMIN" checked /><span><strong>Administrador</strong><small>Opera a loja e gerencia a própria senha.</small></span></label><label><input type="radio" name="papel" value="OWNER" /><span><strong>Mestre</strong><small>Pode criar e gerenciar outros administradores.</small></span></label></fieldset>
          <p class="admins-form-error" data-admin-create-error hidden></p>
        </div>
        <div class="admins-dialog__footer"><button type="button" class="admins-secondary" data-admin-dialog-close>Cancelar</button><button type="submit" class="admins-primary">Criar administrador</button></div>
      </form>
    </dialog>`;
}

function setPasswordPanel(root, id, open) {
  const panel = root.querySelector(`[data-admin-password-panel="${id}"]`);
  const button = root.querySelector(`[data-admin-password="${id}"]`);
  const card = root.querySelector(`[data-admin-card="${id}"]`);
  if (!panel || !button) return;

  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? "Fechar" : "Alterar senha";
  card?.classList.toggle("is-password-open", open);

  if (open) {
    requestAnimationFrame(() => panel.querySelector('input[name="senha"]')?.focus());
  } else {
    const form = panel.querySelector("form");
    form?.reset();
    const error = panel.querySelector("[data-admin-password-error]");
    if (error) error.hidden = true;
  }
}

export async function renderAdmins(root, { onUnauthorized, currentUser } = {}) {
  root.innerHTML = `<section class="admins-view"><div class="admins-loading">Carregando administradores…</div></section>`;

  let users = [];
  try {
    const payload = await adminApi.users();
    users = Array.isArray(payload?.usuarios) ? payload.usuarios : [];
  } catch (error) {
    if (error?.status === 401) return onUnauthorized?.();
    root.innerHTML = `<section class="admins-view"><div class="admins-empty"><strong>Não foi possível carregar os administradores.</strong><span>${esc(error?.message || "Tente novamente em instantes.")}</span></div></section>`;
    return;
  }

  const viewer =
    currentUser || users.find(user => Number(user.id) === Number(currentUser?.id)) || null;
  const isOwner = viewer?.papel === "OWNER";
  const active = users.filter(user => Number(user.ativo) === 1).length;
  const owners = users.filter(user => user.papel === "OWNER" && Number(user.ativo) === 1).length;

  root.innerHTML = `
    <section class="admins-view">
      <div class="admins-toolbar">
        <div><p class="admins-kicker">Controle de acesso</p><h2>${isOwner ? "Equipe administrativa" : "Sua conta"}</h2><p>${isOwner ? "Gerencie quem pode acessar e operar o painel da R&P Doces." : "Gerencie sua senha e confira os dados do seu acesso."}</p></div>
        ${isOwner ? '<button type="button" class="admins-primary" data-admin-create>+ Novo administrador</button>' : ""}
      </div>

      <div class="admins-summary">
        <div><span>Contas</span><strong>${users.length}</strong></div>
        <div><span>Ativas</span><strong>${active}</strong></div>
        <div><span>Mestres ativos</span><strong>${owners}</strong></div>
      </div>

      <div class="admins-grid">
        ${users.length ? users.map(user => userCard(user, viewer)).join("") : '<div class="admins-empty"><strong>Nenhum administrador encontrado.</strong></div>'}
      </div>
      ${dialogShell()}
    </section>`;

  const createDialog = root.querySelector("[data-admin-create-dialog]");
  const createForm = root.querySelector("[data-admin-create-form]");
  const createError = root.querySelector("[data-admin-create-error]");

  root
    .querySelector("[data-admin-create]")
    ?.addEventListener("click", () => createDialog?.showModal());
  root
    .querySelectorAll("[data-admin-dialog-close]")
    .forEach(button => button.addEventListener("click", () => createDialog?.close()));

  root.querySelectorAll("[data-admin-password]").forEach(button => {
    button.addEventListener("click", () => {
      const id = button.dataset.adminPassword;
      const open = button.getAttribute("aria-expanded") !== "true";
      root.querySelectorAll('[data-admin-password][aria-expanded="true"]').forEach(other => {
        if (other !== button) setPasswordPanel(root, other.dataset.adminPassword, false);
      });
      setPasswordPanel(root, id, open);
    });
  });

  root.querySelectorAll("[data-admin-password-cancel]").forEach(button => {
    button.addEventListener("click", () =>
      setPasswordPanel(root, button.dataset.adminPasswordCancel, false)
    );
  });

  root.querySelectorAll("[data-admin-password-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const id = form.dataset.adminPasswordForm;
      const errorBox = form.querySelector("[data-admin-password-error]");
      if (errorBox) errorBox.hidden = true;
      const data = Object.fromEntries(new FormData(form).entries());

      if (data.senha !== data.confirmacao) {
        if (errorBox) {
          errorBox.textContent = "As senhas não coincidem.";
          errorBox.hidden = false;
        }
        return;
      }

      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await adminApi.resetUserPassword(id, data.senha);
        if (Number(id) === Number(viewer?.id)) return onUnauthorized?.();
        await renderAdmins(root, { onUnauthorized, currentUser: viewer });
      } catch (error) {
        if (error?.status === 401) return onUnauthorized?.();
        if (errorBox) {
          errorBox.textContent = error?.message || "Não foi possível alterar a senha.";
          errorBox.hidden = false;
        }
        submit.disabled = false;
      }
    });
  });

  createForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (createError) createError.hidden = true;
    const submit = createForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(createForm).entries());
      data.username = String(data.username || "")
        .trim()
        .toLowerCase();
      await adminApi.createUser(data);
      createDialog?.close();
      await renderAdmins(root, { onUnauthorized, currentUser: viewer });
    } catch (error) {
      if (error?.status === 401) return onUnauthorized?.();
      if (createError) {
        createError.textContent = error?.message || "Não foi possível criar o administrador.";
        createError.hidden = false;
      }
      submit.disabled = false;
    }
  });

  root.querySelectorAll("[data-admin-toggle]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.adminToggle;
      const currentlyActive = button.dataset.adminActive === "true";
      if (!confirm(`${currentlyActive ? "Desativar" : "Reativar"} esta conta administrativa?`))
        return;
      button.disabled = true;
      try {
        await adminApi.toggleUser(id, !currentlyActive);
        await renderAdmins(root, { onUnauthorized, currentUser: viewer });
      } catch (error) {
        if (error?.status === 401) return onUnauthorized?.();
        alert(error?.message || "Não foi possível alterar o estado da conta.");
        button.disabled = false;
      }
    });
  });

  root.querySelectorAll("[data-admin-role]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.adminRole;
      const nextRole = button.dataset.adminNextRole;
      const label = nextRole === "OWNER" ? "Mestre" : "Administrador";
      if (
        !confirm(
          `Alterar o nível desta conta para ${label}? As sessões atuais dela serão encerradas.`
        )
      )
        return;
      button.disabled = true;
      try {
        await adminApi.changeUserRole(id, nextRole);
        await renderAdmins(root, { onUnauthorized, currentUser: viewer });
      } catch (error) {
        if (error?.status === 401) return onUnauthorized?.();
        alert(error?.message || "Não foi possível alterar o nível de acesso.");
        button.disabled = false;
      }
    });
  });
}
