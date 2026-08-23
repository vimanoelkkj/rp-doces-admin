window.atualizarFooterWhatsapp = function(numeroBruto){
  const aplicar = () => {
    const el = document.getElementById('footerWhatsapp');
    if (!el) return;

    const numero = String(numeroBruto || '5533991285907').replace(/\D/g,'');
    const br = numero.startsWith('55') ? numero.slice(2) : numero;

    if (br.length >= 10) {
      const ddd = br.slice(0,2);
      const parte1 = br.length === 11 ? br.slice(2,7) : br.slice(2,6);
      const parte2 = br.length === 11 ? br.slice(7) : br.slice(6);
      el.textContent = `(${ddd}) ${parte1}-${parte2}`;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aplicar, {once:true});
  } else {
    aplicar();
  }
};

if (typeof window.atualizarFooterWhatsapp === 'function') {
  window.atualizarFooterWhatsapp(window.RP_WHATSAPP_NUMBER || '5533991285907');
}
