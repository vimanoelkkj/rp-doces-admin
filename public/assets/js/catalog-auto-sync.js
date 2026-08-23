(function(){
  let ultimoSyncCardapio = 0;
  async function sincronizarCardapio(){
    if (document.hidden || typeof carregarCardapioDinamico !== 'function') return;
    const agora = Date.now();
    if (agora - ultimoSyncCardapio < 700) return;
    ultimoSyncCardapio = agora;
    try { await carregarCardapioDinamico(); } catch (_) {}
  }
  
  
  setInterval(() => {
  if (!document.hidden) sincronizarCardapio();
}, 1000);
})();
