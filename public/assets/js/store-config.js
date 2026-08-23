window.RP_CONFIG = {
  whatsapp: (window.RP_WHATSAPP_NUMBER || "5533991285907"),
  local_retirada: "Temponi Concept",
  endereco: "",
  maps_url: "",
  horario_dias: "",
  horario_abre: "",
  horario_fecha: "",
  entregas_status: "EM_BREVE",
  horario_atendimento: "",
  mensagem_whatsapp: "Olá! Gostaria de fazer um pedido na R&P Doces."
};
(async () => {
  try {
    const r = await fetch('/api/config', {cache:'no-store'});
    if (!r.ok) return;
    const cfg = await r.json();
    Object.assign(window.RP_CONFIG, cfg);
    if (cfg.whatsapp) {
      const numero = String(cfg.whatsapp).replace(/\D/g,'');
      window.RP_WHATSAPP_NUMBER = numero;
      try { WHATSAPP_NUMBER = numero; } catch (_) {}
      if (typeof window.atualizarFooterWhatsapp === 'function') {
        window.atualizarFooterWhatsapp(numero);
    if (typeof window.rpMarkMenuReady === 'function') window.rpMarkMenuReady();
      }

      const footerWhatsapp = document.getElementById('footerWhatsapp');
      if (footerWhatsapp) {
        const br = numero.startsWith('55') ? numero.slice(2) : numero;
        const ddd = br.slice(0, 2);
        const parte1 = br.slice(2, 7);
        const parte2 = br.slice(7);
        footerWhatsapp.textContent = ddd && parte1 && parte2
          ? `(${ddd}) ${parte1}-${parte2}`
          : String(cfg.whatsapp);
      }
    }
  } catch (_) {}
})();
