(() => {
  const menuOverlay=document.getElementById('rpMobileMenuOverlay');
  const menuSheet=document.getElementById('rpMobileMenuSheet');
  const partyOverlay=document.getElementById('rpPartyOverlay');
  const partySheet=document.getElementById('rpPartySheet');
  const menuButton=document.getElementById('rpMobileMenu');
  const partyButton=document.getElementById('rpMobileParty');
  const flavorsButton=document.querySelector('[data-mobile-target="sabores"]');
  const cartButton=document.getElementById('rpMobileCart');
  const menuClose=document.getElementById('rpMobileMenuClose');
  const partyClose=document.getElementById('rpPartyClose');
  const partyOptions=document.getElementById('rpPartyOptions');
  const partyPlan=document.getElementById('rpPartyPlan');
  const partyWhatsapp=document.getElementById('rpPartyWhatsapp');
  if(!menuOverlay||!menuSheet||!partyOverlay||!partySheet||!menuButton||!menuClose||!partyClose)return;

  const navItems=[flavorsButton,partyButton,cartButton,menuButton].filter(Boolean);
  function limparAtivos(){navItems.forEach(item=>item.classList.remove('active'))}
  function atualizarSecaoAtiva(){
    if(innerWidth>700||menuOverlay.classList.contains('open')||partyOverlay.classList.contains('open')||document.body.classList.contains('rp-modal-open'))return;
    const ponto=innerHeight*.45;
    const sabores=document.getElementById('sabores')?.getBoundingClientRect();
    const secoesMenu=['sobre','onde-encontrar','contato'].map(id=>document.getElementById(id)?.getBoundingClientRect()).filter(Boolean);
    limparAtivos();
    if(sabores&&sabores.top<=ponto&&sabores.bottom>=ponto)flavorsButton?.classList.add('active');
    else if(secoesMenu.some(secao=>secao.top<=ponto&&secao.bottom>=ponto))menuButton.classList.add('active');
  }

  function bloquearPagina(){document.body.classList.add('rp-mobile-menu-open')}
  function liberarPagina(){
    if(!menuOverlay.classList.contains('open')&&!partyOverlay.classList.contains('open'))document.body.classList.remove('rp-mobile-menu-open');
  }
  let trocaTimer=0;
  function trocarPainel(abrirProximo){
    const cartOverlay=document.getElementById('pedidoOverlay');
    const haviaPainel=menuOverlay.classList.contains('open')||partyOverlay.classList.contains('open')||cartOverlay?.classList.contains('open');
    clearTimeout(trocaTimer);
    if(menuOverlay.classList.contains('open'))fecharMenu();
    if(partyOverlay.classList.contains('open'))fecharFestas();
    if(cartOverlay?.classList.contains('open'))dispatchEvent(new Event('rp-close-cart-sheet'));
    if(haviaPainel)trocaTimer=setTimeout(abrirProximo,230);
    else abrirProximo();
  }
  function abrirMenu(){
    if(innerWidth>700)return;
    dispatchEvent(new Event('rp-close-cart-sheet'));
    menuOverlay.classList.add('open');
    menuOverlay.setAttribute('aria-hidden','false');
    limparAtivos();menuButton.classList.add('active');
    menuButton.setAttribute('aria-expanded','true');
    bloquearPagina();menuClose.focus({preventScroll:true});
  }
  function fecharMenu(){
    menuOverlay.classList.remove('open');
    menuOverlay.setAttribute('aria-hidden','true');
    limparAtivos();
    menuButton.setAttribute('aria-expanded','false');
    menuSheet.style.transform='';liberarPagina();atualizarSecaoAtiva();
  }
  function abrirFestas(){
    if(innerWidth>700)return;
    dispatchEvent(new Event('rp-close-cart-sheet'));
    if(menuOverlay.classList.contains('open'))fecharMenu();
    partyOverlay.classList.add('open');
    partyOverlay.setAttribute('aria-hidden','false');
    limparAtivos();partyButton?.classList.add('active');
    bloquearPagina();partyClose.focus({preventScroll:true});
  }
  function fecharFestas(){
    partyOverlay.classList.remove('open');
    partyOverlay.setAttribute('aria-hidden','true');
    limparAtivos();partySheet.style.transform='';liberarPagina();atualizarSecaoAtiva();
  }

  menuButton.addEventListener('click',()=>menuOverlay.classList.contains('open')?fecharMenu():trocarPainel(abrirMenu));
  partyButton?.addEventListener('click',()=>partyOverlay.classList.contains('open')?fecharFestas():trocarPainel(abrirFestas));
  cartButton?.addEventListener('click',event=>{
    if(!menuOverlay.classList.contains('open')&&!partyOverlay.classList.contains('open'))return;
    event.preventDefault();event.stopImmediatePropagation();
    trocarPainel(()=>cartButton.click());
  },true);
  menuClose.addEventListener('click',fecharMenu);partyClose.addEventListener('click',fecharFestas);
  menuOverlay.addEventListener('click',event=>{if(event.target===menuOverlay)fecharMenu()});
  partyOverlay.addEventListener('click',event=>{if(event.target===partyOverlay)fecharFestas()});
  document.querySelectorAll('[data-mobile-menu-link]').forEach(link=>link.addEventListener('click',fecharMenu));
  document.querySelector('[data-mobile-party]')?.addEventListener('click',()=>trocarPainel(abrirFestas));
  flavorsButton?.addEventListener('click',()=>trocarPainel(()=>{document.getElementById('sabores')?.scrollIntoView({behavior:'smooth'});limparAtivos();flavorsButton.classList.add('active')}));
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(partyOverlay.classList.contains('open'))fecharFestas();else if(menuOverlay.classList.contains('open'))fecharMenu()});
  addEventListener('scroll',atualizarSecaoAtiva,{passive:true});
  addEventListener('rp-mobile-nav-refresh',atualizarSecaoAtiva);
  addEventListener('rp-close-mobile-sheets',()=>{if(menuOverlay.classList.contains('open'))fecharMenu();if(partyOverlay.classList.contains('open'))fecharFestas()});
  addEventListener('resize',()=>{if(innerWidth>700){if(menuOverlay.classList.contains('open'))fecharMenu();if(partyOverlay.classList.contains('open'))fecharFestas()}else atualizarSecaoAtiva()});

  function habilitarArraste(sheet,fechar){
    const handle=sheet.querySelector('.rp-mobile-menu-handle');let inicio=0,distancia=0,ponteiro=null;
    if(!handle)return;
    handle.addEventListener('pointerdown',event=>{
      ponteiro=event.pointerId;inicio=event.clientY;distancia=0;
      handle.setPointerCapture?.(ponteiro);sheet.style.transition='none';
    });
    handle.addEventListener('pointermove',event=>{
      if(event.pointerId!==ponteiro)return;
      distancia=Math.max(0,event.clientY-inicio);
      sheet.style.transform=`translateY(${distancia}px)`;
    });
    const terminar=event=>{
      if(event.pointerId!==ponteiro)return;
      handle.releasePointerCapture?.(ponteiro);ponteiro=null;sheet.style.transition='';
      if(distancia>70)fechar();else sheet.style.transform='';
      distancia=0;
    };
    handle.addEventListener('pointerup',terminar);
    handle.addEventListener('pointercancel',terminar);
  }
  habilitarArraste(menuSheet,fecharMenu);habilitarArraste(partySheet,fecharFestas);

  let ocasiao='Aniversário';
  partyOptions?.addEventListener('click',event=>{const option=event.target.closest('[data-party-occasion]');if(!option)return;ocasiao=option.dataset.partyOccasion;partyOptions.querySelectorAll('.rp-party-option').forEach(item=>item.classList.toggle('active',item===option))});
  function falarSobreFesta(){
    const texto=`Olá! 🎂 Vim pelo site da R&P Doces e gostaria de planejar uma encomenda para festa.\n\nOcasião: ${ocasiao}\nAntecedência mínima: 7 dias.\n\nGostaria de conhecer as opções de bolos no pote, mini pudins e combinações.`;
    if(typeof window.abrirWhatsApp==='function')window.abrirWhatsApp(texto);
    else window.open(`https://wa.me/${String(window.RP_WHATSAPP_NUMBER||'5533991285907').replace(/\D/g,'')}?text=${encodeURIComponent(texto)}`,'_blank','noopener,noreferrer');
  }
  partyPlan?.addEventListener('click',falarSobreFesta);partyWhatsapp?.addEventListener('click',falarSobreFesta);
  atualizarSecaoAtiva();
})();
