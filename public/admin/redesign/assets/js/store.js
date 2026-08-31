import { adminApi } from "./api.js";

const DAYS = [
  ["seg", "Seg"],
  ["ter", "Ter"],
  ["qua", "Qua"],
  ["qui", "Qui"],
  ["sex", "Sex"],
  ["sab", "Sáb"],
  ["dom", "Dom"]
];

const DELIVERY = {
  EM_BREVE: "Em breve",
  DISPONIVEL: "Disponíveis",
  INDISPONIVEL: "Indisponíveis"
};

const esc = value =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function phoneDisplay(value = "") {
  const digits = String(value).replace(/\D/g, "").replace(/^55/, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function humanTime(value = "") {
  const [h = "0", m = "00"] = String(value).split(":");
  return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
}

function scheduleText(days, open, close) {
  const activeIndexes = DAYS.map(([key]) => key).reduce((list, key, index) => {
    if (days.includes(key)) list.push(index);
    return list;
  }, []);

  let dayText = "Nenhum dia selecionado";
  if (activeIndexes.length) {
    const consecutive = activeIndexes.every(
      (value, index) => index === 0 || value === activeIndexes[index - 1] + 1
    );
    if (consecutive && activeIndexes.length > 2) {
      dayText = `${DAYS[activeIndexes[0]][1]} a ${DAYS[activeIndexes.at(-1)][1].toLowerCase()}`;
    } else {
      dayText = activeIndexes.map(index => DAYS[index][1]).join(", ");
    }
  }
  return `${dayText}, ${humanTime(open)} às ${humanTime(close)}`;
}

function parseLegacySchedule(text = "") {
  const lower = String(text).toLowerCase();
  let days = [];
  if (lower.includes("seg a dom") || lower.includes("seg a domingo"))
    days = DAYS.map(([key]) => key);
  else if (lower.includes("seg a sáb") || lower.includes("seg a sab"))
    days = DAYS.slice(0, 6).map(([key]) => key);
  else if (lower.includes("seg a sex")) days = DAYS.slice(0, 5).map(([key]) => key);
  else
    days = DAYS.filter(
      ([key, label]) => lower.includes(key) || lower.includes(label.toLowerCase())
    ).map(([key]) => key);

  const times = [...String(text).matchAll(/(\d{1,2})h(?:(\d{2}))?/g)];
  const normalize = match => `${String(match?.[1] || "10").padStart(2, "0")}:${match?.[2] || "00"}`;
  return { days, open: normalize(times[0]), close: times[1] ? normalize(times[1]) : "19:00" };
}

function selectedDays(root) {
  return [...root.querySelectorAll("[data-store-day].is-active")].map(
    button => button.dataset.storeDay
  );
}

function currentSchedule(root) {
  const open = root.querySelector('[name="horario_abre"]')?.value || "10:00";
  const close = root.querySelector('[name="horario_fecha"]')?.value || "19:00";
  return scheduleText(selectedDays(root), open, close);
}

function updateSchedulePreview(root) {
  const preview = root.querySelector("[data-store-schedule-preview]");
  if (preview) preview.textContent = currentSchedule(root);
}

function updatePublicPreview(root, selectedDelivery) {
  const local =
    root.querySelector('[name="local_retirada"]')?.value.trim() || "Local não informado";
  const address = root.querySelector('[name="endereco"]')?.value.trim() || "Endereço não informado";
  const phone = root.querySelector('[name="whatsapp"]')?.value.trim() || "WhatsApp não informado";

  const localTarget = root.querySelector("[data-store-public-local]");
  const addressTarget = root.querySelector("[data-store-public-address]");
  const scheduleTarget = root.querySelector("[data-store-public-schedule]");
  const deliveryTarget = root.querySelector("[data-store-public-delivery]");
  const phoneTarget = root.querySelector("[data-store-public-phone]");

  if (localTarget) localTarget.textContent = local;
  if (addressTarget) addressTarget.textContent = address;
  if (scheduleTarget) scheduleTarget.textContent = currentSchedule(root);
  if (deliveryTarget) deliveryTarget.textContent = DELIVERY[selectedDelivery] || DELIVERY.EM_BREVE;
  if (phoneTarget) phoneTarget.textContent = phone;
}

function renderDelivery(current) {
  return Object.entries(DELIVERY)
    .map(
      ([value, label]) =>
        `<button type="button" class="store-choice${current === value ? " is-active" : ""}" data-store-delivery="${value}" aria-pressed="${current === value}">${label}</button>`
    )
    .join("");
}

export async function renderStore(root, { onUnauthorized } = {}) {
  root.innerHTML = `<section class="store-view"><div class="store-loading">Carregando configurações da loja…</div></section>`;

  let config;
  try {
    config = await adminApi.storeConfig();
  } catch (error) {
    if (error?.status === 401) return onUnauthorized?.();
    root.innerHTML = `<section class="store-view"><div class="store-error"><strong>Não foi possível carregar a loja.</strong><span>${esc(error?.message || "Tente novamente em instantes.")}</span></div></section>`;
    return;
  }

  const legacy = parseLegacySchedule(config.horario_atendimento || "Seg a sáb, 10h às 19h");
  const days = String(config.horario_dias || "")
    .split(",")
    .filter(Boolean);
  const initialDays = days.length ? days : legacy.days;
  const open = config.horario_abre || legacy.open || "10:00";
  const close = config.horario_fecha || legacy.close || "19:00";
  const delivery = DELIVERY[config.entregas_status] ? config.entregas_status : "EM_BREVE";
  const initialLocal = config.local_retirada || "Local não informado";
  const initialAddress = config.endereco || "Endereço não informado";
  const initialPhone = phoneDisplay(config.whatsapp || "") || "WhatsApp não informado";
  const initialSchedule = scheduleText(initialDays, open, close);

  root.innerHTML = `
    <section class="store-view">
      <div class="store-toolbar">
        <div>
          <p class="store-kicker">Operação da loja</p>
          <h2>Configurações públicas</h2>
          <p>Atualize atendimento, retirada, entregas e contato exibidos no site.</p>
        </div>
        <div class="store-toolbar__actions"><span data-store-status></span><button type="button" class="store-primary" data-store-save>Salvar alterações</button></div>
      </div>

      <div class="store-grid">
        <section class="store-card store-card--schedule">
          <div class="store-card__head"><span class="store-card__icon">◷</span><div><h3>Atendimento</h3><p>Dias e horário em que a R&P atende.</p></div></div>
          <div class="store-days" role="group" aria-label="Dias de atendimento">
            ${DAYS.map(([key, label]) => `<button type="button" class="store-day${initialDays.includes(key) ? " is-active" : ""}" data-store-day="${key}" aria-pressed="${initialDays.includes(key)}">${label}</button>`).join("")}
          </div>
          <div class="store-time-row">
            <label><span>Abre</span><input type="time" name="horario_abre" step="1800" value="${esc(open)}" /></label>
            <label><span>Fecha</span><input type="time" name="horario_fecha" step="1800" value="${esc(close)}" /></label>
          </div>
          <div class="store-preview"><small>Como aparece no site</small><strong data-store-schedule-preview>${esc(initialSchedule)}</strong></div>
        </section>

        <section class="store-card store-card--pickup">
          <div class="store-card__head"><span class="store-card__icon">⌖</span><div><h3>Retirada</h3><p>Local e endereço mostrados ao cliente.</p></div></div>
          <label class="store-field"><span>Nome do local</span><input name="local_retirada" value="${esc(config.local_retirada || "")}" placeholder="Ex.: Temponi Concept" /></label>
          <label class="store-field"><span>Endereço</span><input name="endereco" value="${esc(config.endereco || "")}" placeholder="Rua, número, bairro e cidade" /></label>
          <label class="store-field"><span>Link do Google Maps</span><input name="maps_url" type="url" value="${esc(config.maps_url || "")}" placeholder="https://maps.google.com/..." /></label>
        </section>

        <section class="store-card store-card--delivery">
          <div class="store-card__head"><span class="store-card__icon">↗</span><div><h3>Entregas</h3><p>Defina o estado exibido no cardápio.</p></div></div>
          <div class="store-choices" data-store-delivery-group>${renderDelivery(delivery)}</div>
          <div class="store-help"><strong data-store-delivery-label>${DELIVERY[delivery]}</strong><span>Essa alteração afeta a comunicação pública sobre entregas.</span></div>
        </section>

        <section class="store-card store-card--contact">
          <div class="store-card__head"><span class="store-card__icon">✆</span><div><h3>Contato</h3><p>WhatsApp e mensagem padrão do pedido.</p></div></div>
          <label class="store-field"><span>WhatsApp</span><input name="whatsapp" inputmode="tel" autocomplete="tel" value="${esc(phoneDisplay(config.whatsapp || ""))}" placeholder="(31) 99999-9999" /></label>
          <label class="store-field"><span>Mensagem padrão</span><textarea name="mensagem_whatsapp" rows="3" placeholder="Mensagem usada ao iniciar o contato pelo WhatsApp">${esc(config.mensagem_whatsapp || "")}</textarea></label>
        </section>

        <section class="store-card store-card--public-preview">
          <div class="store-card__head"><span class="store-card__icon">◉</span><div><h3>Prévia da loja</h3><p>Resumo do que o cliente encontra no site.</p></div></div>
          <div class="store-public-preview">
            <div class="store-public-preview__row"><span>⌖</span><div><small>Retirada</small><strong data-store-public-local>${esc(initialLocal)}</strong></div></div>
            <div class="store-public-preview__row"><span>⌂</span><div><small>Endereço</small><strong data-store-public-address>${esc(initialAddress)}</strong></div></div>
            <div class="store-public-preview__row"><span>◷</span><div><small>Atendimento</small><strong data-store-public-schedule>${esc(initialSchedule)}</strong></div></div>
            <div class="store-public-preview__row"><span>↗</span><div><small>Entregas</small><strong data-store-public-delivery>${esc(DELIVERY[delivery])}</strong></div></div>
            <div class="store-public-preview__row"><span>✆</span><div><small>WhatsApp</small><strong data-store-public-phone>${esc(initialPhone)}</strong></div></div>
          </div>
          <p class="store-public-preview__note">A prévia acompanha suas alterações antes de salvar. O site público só recebe os novos valores depois de clicar em “Salvar alterações”.</p>
        </section>
      </div>
    </section>`;

  const save = root.querySelector("[data-store-save]");
  const status = root.querySelector("[data-store-status]");
  const deliveryGroup = root.querySelector("[data-store-delivery-group]");
  let selectedDelivery = delivery;

  const refreshPreviews = () => {
    updateSchedulePreview(root);
    updatePublicPreview(root, selectedDelivery);
  };

  root.querySelectorAll("[data-store-day]").forEach(button => {
    button.addEventListener("click", () => {
      button.classList.toggle("is-active");
      button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
      refreshPreviews();
    });
  });

  root
    .querySelectorAll('input[name="horario_abre"],input[name="horario_fecha"]')
    .forEach(input => input.addEventListener("input", refreshPreviews));

  root.querySelector('[name="whatsapp"]')?.addEventListener("input", event => {
    event.target.value = phoneDisplay(event.target.value);
    updatePublicPreview(root, selectedDelivery);
  });

  root.querySelectorAll('[name="local_retirada"],[name="endereco"]').forEach(input => {
    input.addEventListener("input", () => updatePublicPreview(root, selectedDelivery));
  });

  deliveryGroup?.querySelectorAll("[data-store-delivery]").forEach(button => {
    button.addEventListener("click", () => {
      selectedDelivery = button.dataset.storeDelivery;
      deliveryGroup.querySelectorAll("[data-store-delivery]").forEach(item => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      const label = root.querySelector("[data-store-delivery-label]");
      if (label) label.textContent = DELIVERY[selectedDelivery] || DELIVERY.EM_BREVE;
      updatePublicPreview(root, selectedDelivery);
    });
  });

  save?.addEventListener("click", async () => {
    if (!save || save.disabled) return;
    save.disabled = true;
    if (status) {
      status.textContent = "Salvando…";
      status.className = "";
    }
    try {
      const selected = selectedDays(root);
      const payload = {
        local_retirada: root.querySelector('[name="local_retirada"]')?.value.trim() || "",
        endereco: root.querySelector('[name="endereco"]')?.value.trim() || "",
        maps_url: root.querySelector('[name="maps_url"]')?.value.trim() || "",
        whatsapp: root.querySelector('[name="whatsapp"]')?.value.trim() || "",
        mensagem_whatsapp:
          root.querySelector('[name="mensagem_whatsapp"]')?.value.trim() || "",
        horario_dias: selected.join(","),
        horario_abre: root.querySelector('[name="horario_abre"]')?.value || "10:00",
        horario_fecha: root.querySelector('[name="horario_fecha"]')?.value || "19:00",
        horario_atendimento: currentSchedule(root),
        entregas_status: selectedDelivery
      };
      await adminApi.updateStoreConfig(payload);
      if (status) {
        status.textContent = "Alterações salvas";
        status.className = "is-success";
      }
      window.dispatchEvent(new CustomEvent("rp-admin-data-changed", { detail: { pages: ["store"] } }));
    } catch (error) {
      if (error?.status === 401) return onUnauthorized?.();
      if (status) {
        status.textContent = error?.message || "Não foi possível salvar.";
        status.className = "is-error";
      }
    } finally {
      save.disabled = false;
    }
  });
}