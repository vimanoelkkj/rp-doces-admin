(() => {
  const diaMap = ['dom','seg','ter','qua','qui','sex','sab'];

  function minutos(hora){
    const [h,m] = String(hora||'').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h*60+m;
  }

  function atualizarLocalizacao(cfg){
    if (!cfg) return;
    const localNome = document.getElementById('rpLocalNome');
    const horario = document.getElementById('rpHorarioTexto');
    const endereco = document.getElementById('rpEnderecoTexto');
    const maps = document.getElementById('rpMapsLink');
    const status = document.getElementById('rpOpenStatus');
    const dot = document.getElementById('rpOpenDot');

    if (localNome && cfg.local_retirada) localNome.textContent = cfg.local_retirada;
    if (horario) horario.textContent = cfg.horario_atendimento || 'Consulte nossos horários';

    if (endereco) {
      if (cfg.endereco) { endereco.textContent = cfg.endereco; endereco.classList.remove('hidden'); }
      else endereco.classList.add('hidden');
    }

    if (maps) {
      if (cfg.maps_url) { maps.href = cfg.maps_url; maps.classList.remove('hidden'); }
      else maps.classList.add('hidden');
    }

    const dias = String(cfg.horario_dias||'').split(',').filter(Boolean);
    const abre = minutos(cfg.horario_abre);
    const fecha = minutos(cfg.horario_fecha);
    let aberto = null;

    if (dias.length && abre !== null && fecha !== null) {
      const agora = new Date();
      const dia = diaMap[agora.getDay()];
      const minAgora = agora.getHours()*60 + agora.getMinutes();
      aberto = dias.includes(dia) && minAgora >= abre && minAgora < fecha;
    }

    if (status && dot) {
      dot.classList.remove('is-open','is-closed');
      if (aberto === true) { status.textContent = 'Aberto agora'; dot.classList.add('is-open'); }
      else if (aberto === false) { status.textContent = 'Fechado agora'; dot.classList.add('is-closed'); }
      else status.textContent = 'Horário de atendimento';
    }
  }

  window.rpAtualizarLocalizacao = atualizarLocalizacao;

  async function carregar(){
    try{
      const r = await fetch(`/api/config?_=${Date.now()}`, {cache:'no-store'});
      if(!r.ok) return;
      const cfg = await r.json();
      Object.assign(window.RP_CONFIG || {}, cfg);
      atualizarLocalizacao(cfg);
    }catch(_){}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', carregar, {once:true});
  else carregar();

  setInterval(() => { if (window.RP_CONFIG) atualizarLocalizacao(window.RP_CONFIG); }, 60000);
})();
