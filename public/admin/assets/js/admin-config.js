(() => {
  const $id = id => document.getElementById(id);
  const panel = $id("tab-config");
  if (!panel) return;

  const cfgSelect = document.getElementById("cfgEntregasSelect");
  const cfgLabels = {
    EM_BREVE: "Em breve",
    DISPONIVEL: "Disponíveis",
    INDISPONIVEL: "Indisponíveis"
  };

  function getCfgEntregas() {
    return cfgSelect?.dataset.value || "EM_BREVE";
  }

  function setCfgEntregas(value) {
    if (!cfgSelect) return;
    cfgSelect.dataset.value = value;
    const label = cfgLabels[value] || cfgLabels.EM_BREVE;
    cfgSelect.querySelector(".rp-select-value").textContent = label;
    cfgSelect.querySelectorAll('[role="option"]').forEach(opt => {
      opt.setAttribute("aria-selected", String(opt.dataset.value === value));
    });
  }

  if (cfgSelect) {
    const trigger = cfgSelect.querySelector(".rp-select-trigger");
    trigger.addEventListener("click", () => {
      const open = cfgSelect.classList.toggle("open");
      trigger.setAttribute("aria-expanded", String(open));
    });

    cfgSelect.querySelectorAll('[role="option"]').forEach(opt => {
      opt.addEventListener("click", () => {
        setCfgEntregas(opt.dataset.value);
        cfgSelect.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      });
    });

    document.addEventListener("click", e => {
      if (!cfgSelect.contains(e.target)) {
        cfgSelect.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        cfgSelect.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  const diaLabels = {
    seg: "Seg",
    ter: "Ter",
    qua: "Qua",
    qui: "Qui",
    sex: "Sex",
    sab: "Sáb",
    dom: "Dom"
  };
  const ordemDias = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];

  function formatarHoraHumana(h) {
    const [hh, mm] = h.split(":");
    return mm === "00" ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
  }

  function montarResumoHorario() {
    const ativos = [...document.querySelectorAll("#cfgDias button.active")].map(b => b.dataset.day);
    const abre = document.getElementById("cfgAbreSelect")?.dataset.value || "10:00";
    const fecha = document.getElementById("cfgFechaSelect")?.dataset.value || "19:00";

    let diasTexto = "Nenhum dia selecionado";
    if (ativos.length) {
      const indices = ativos.map(d => ordemDias.indexOf(d)).sort((a, b) => a - b);
      const consecutivos = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
      if (consecutivos && indices.length > 2) {
        diasTexto = `${diaLabels[ordemDias[indices[0]]]} a ${diaLabels[ordemDias[indices.at(-1)]].toLowerCase()}`;
      } else {
        diasTexto = indices.map(i => diaLabels[ordemDias[i]]).join(", ");
      }
    }

    const texto = `${diasTexto}, ${formatarHoraHumana(abre)} às ${formatarHoraHumana(fecha)}`;
    const hidden = document.getElementById("cfgHorario");
    const preview = document.getElementById("cfgHorarioPreview");
    if (hidden) hidden.value = texto;
    if (preview) preview.textContent = texto;
    return texto;
  }

  function setDiasFromTexto(texto) {
    document.querySelectorAll("#cfgDias button").forEach(b => b.classList.remove("active"));
    const t = String(texto || "").toLowerCase();

    const ranges = [
      {
        keys: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"],
        tests: ["seg a dom", "seg a domingo"]
      },
      { keys: ["seg", "ter", "qua", "qui", "sex", "sab"], tests: ["seg a sáb", "seg a sab"] },
      { keys: ["seg", "ter", "qua", "qui", "sex"], tests: ["seg a sex"] }
    ];
    let matched = false;
    for (const r of ranges) {
      if (r.tests.some(x => t.includes(x))) {
        r.keys.forEach(k =>
          document.querySelector(`#cfgDias button[data-day="${k}"]`)?.classList.add("active")
        );
        matched = true;
        break;
      }
    }
    if (!matched) {
      const aliases = {
        seg: ["seg"],
        ter: ["ter"],
        qua: ["qua"],
        qui: ["qui"],
        sex: ["sex"],
        sab: ["sáb", "sab"],
        dom: ["dom"]
      };
      for (const [k, als] of Object.entries(aliases)) {
        if (als.some(a => t.includes(a)))
          document.querySelector(`#cfgDias button[data-day="${k}"]`)?.classList.add("active");
      }
    }

    const horas = [...String(texto || "").matchAll(/(\d{1,2})h(?:(\d{2}))?/g)];
    if (horas[0])
      setTimeSelect(
        "cfgAbreSelect",
        `${String(horas[0][1]).padStart(2, "0")}:${horas[0][2] || "00"}`
      );
    if (horas[1])
      setTimeSelect(
        "cfgFechaSelect",
        `${String(horas[1][1]).padStart(2, "0")}:${horas[1][2] || "00"}`
      );
    montarResumoHorario();
  }

  function setTimeSelect(id, value) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.dataset.value = value;
    sel.querySelector(".rp-select-value").textContent = value;
    sel.querySelectorAll('[role="option"]').forEach(opt => {
      opt.setAttribute("aria-selected", String(opt.dataset.value === value));
    });
  }

  function initTimeSelect(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const menu = sel.querySelector(".rp-select-menu");
    const trigger = sel.querySelector(".rp-select-trigger");

    const opts = [];
    for (let h = 0; h <= 23; h++) {
      for (const m of [0, 30]) {
        const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        opts.push(`<button type="button" role="option" data-value="${value}" aria-selected="${value === sel.dataset.value}">
          <span><strong>${value}</strong></span><span class="rp-select-check">✓</span>
        </button>`);
      }
    }
    menu.innerHTML = opts.join("");

    trigger.addEventListener("click", e => {
      e.stopPropagation();
      document.querySelectorAll(".rp-select.open").forEach(x => {
        if (x !== sel) x.classList.remove("open");
      });
      const open = sel.classList.toggle("open");
      trigger.setAttribute("aria-expanded", String(open));
    });

    menu.querySelectorAll('[role="option"]').forEach(opt => {
      opt.addEventListener("click", () => {
        setTimeSelect(id, opt.dataset.value);
        sel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        montarResumoHorario();
      });
    });
  }

  document.querySelectorAll("#cfgDias button").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("active");
      montarResumoHorario();
    });
  });

  initTimeSelect("cfgAbreSelect");
  initTimeSelect("cfgFechaSelect");

  function formatarTelefone(v) {
    const d = String(v || "")
      .replace(/\D/g, "")
      .replace(/^55/, "")
      .slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  async function carregarConfig() {
    try {
      const r = await fetch("/api/admin/config", { credentials: "same-origin" });
      if (!r.ok) return;
      const c = await r.json();
      $id("cfgWhatsapp").value = formatarTelefone(c.whatsapp || "");
      $id("cfgLocal").value = c.local_retirada || "";
      $id("cfgEndereco").value = c.endereco || "";
      $id("cfgMapsUrl").value = c.maps_url || "";
      setCfgEntregas(c.entregas_status || "EM_BREVE");

      if (c.horario_dias) {
        document.querySelectorAll("#cfgDias button").forEach(b => b.classList.remove("active"));
        String(c.horario_dias)
          .split(",")
          .filter(Boolean)
          .forEach(d => {
            document.querySelector(`#cfgDias button[data-day="${d}"]`)?.classList.add("active");
          });
        setTimeSelect("cfgAbreSelect", c.horario_abre || "10:00");
        setTimeSelect("cfgFechaSelect", c.horario_fecha || "19:00");
        montarResumoHorario();
      } else {
        setDiasFromTexto(c.horario_atendimento || "Seg a sáb, 10h às 19h");
      }

      $id("cfgMensagem").value = c.mensagem_whatsapp || "";
    } catch (_) {}
  }

  document
    .querySelectorAll('[data-tab="config"]')
    .forEach(b => b.addEventListener("click", carregarConfig));
  $id("cfgWhatsapp").addEventListener("input", e => {
    const caret = e.target.selectionStart;
    e.target.value = formatarTelefone(e.target.value);
  });
  const salvarConfigBtn = $id("salvarConfig");
  if (salvarConfigBtn && !salvarConfigBtn.dataset.bound) {
    salvarConfigBtn.dataset.bound = "1";
    salvarConfigBtn.addEventListener("click", async () => {
      const status = $id("configStatus");
      status.textContent = "Salvando...";
      const body = {
        whatsapp: "55" + $id("cfgWhatsapp").value.replace(/\D/g, ""),
        local_retirada: $id("cfgLocal").value.trim(),
        endereco: $id("cfgEndereco").value.trim(),
        maps_url: $id("cfgMapsUrl").value.trim(),
        entregas_status: getCfgEntregas(),
        horario_atendimento: montarResumoHorario(),
        horario_dias: [...document.querySelectorAll("#cfgDias button.active")]
          .map(b => b.dataset.day)
          .join(","),
        horario_abre: document.getElementById("cfgAbreSelect")?.dataset.value || "10:00",
        horario_fecha: document.getElementById("cfgFechaSelect")?.dataset.value || "19:00",
        mensagem_whatsapp: $id("cfgMensagem").value.trim()
      };
      try {
        await api("/api/admin/config", {
          method: "PUT",
          body: JSON.stringify(body)
        });

        status.textContent = "";
        toast("Configurações salvas");

        // Atualiza também a cópia pública em memória, se existir.
        if (window.RP_CONFIG) Object.assign(window.RP_CONFIG, body);
      } catch (e) {
        status.textContent = e?.message || "Não foi possível salvar.";
        toast(status.textContent, "error");
      }
    });
  }
})();
