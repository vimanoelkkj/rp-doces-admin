(() => {
  let observerBusy=false;

  function texto(el){ return (el?.textContent||'').trim(); }
  function categoriaDoCard(card){
    const raw=(card.dataset.categoria||card.dataset.category||'').toLowerCase();
    const all=(raw+' '+texto(card)).toLowerCase();
    if(all.includes('pudim')) return 'pudins';
    return 'bolos';
  }
  function destaque(card){
    const v=String(card.dataset.destaque||card.dataset.featured||'').toLowerCase();
    return v==='1'||v==='true'||card.classList.contains('destaque')||!!card.querySelector('[data-destaque],.badge-destaque,.destaque');
  }
  function disponivel(card){
    const v=String(card.dataset.disponivel||card.dataset.available||'').toLowerCase();
    if(v==='0'||v==='false') return false;
    return !/esgotado/i.test(texto(card));
  }
  function nome(card){
    return texto(card.querySelector('h3,h4,.product-name,.produto-nome,.card-title')) || texto(card);
  }
  function cardSelector(){
    return '.product-card,.produto-card,.flavor-card,.card-produto,[data-product-id],[data-produto-id]';
  }
  function cardsOriginais(){
    const seen=new Set(), out=[];
    document.querySelectorAll(cardSelector()).forEach(c=>{
      if(c.closest('#rpAllOverlay')||c.closest('#queridinhosSection')) return;
      if(c.classList.contains('flavor-card-skeleton')) return;
      if(c.closest('.is-loading')) return;
      if(seen.has(c)) return;
      seen.add(c);
      out.push(c);
    });
    return out;
  }
  function enhanceTrack(track){
    if(!track || track.dataset.rpTrack==='1' || track.closest('#sabores')) return;
    track.dataset.rpTrack='1';
    track.classList.add('rp-product-track');
    const wrap=document.createElement('div'); wrap.className='rp-track-wrap';
    track.parentNode.insertBefore(wrap,track); wrap.appendChild(track);
    const prev=document.createElement('button'), next=document.createElement('button');
    prev.className='rp-track-arrow prev'; next.className='rp-track-arrow next';
    prev.type=next.type='button'; prev.textContent='‹'; next.textContent='›';
    prev.setAttribute('aria-label','Produtos anteriores'); next.setAttribute('aria-label','Próximos produtos');
    wrap.append(prev,next);
    const move=d=>track.scrollBy({left:d*track.clientWidth*.82,behavior:'smooth'});
    prev.onclick=()=>move(-1); next.onclick=()=>move(1);
    const state=()=>{prev.hidden=track.scrollLeft<8;next.hidden=track.scrollLeft+track.clientWidth>=track.scrollWidth-8};
    track.addEventListener('scroll',state,{passive:true}); new ResizeObserver(state).observe(track); setTimeout(state,50);
  }
  function makeHeader(track,title,filter){
    if(track.closest('#sabores')) return;
    let section=track.closest('section')||track.parentElement;
    if(section?.dataset.rpVitrine==='1') return;
    if(section) section.dataset.rpVitrine='1';
    const head=document.createElement('div'); head.className='rp-vitrine-head';
    const h=document.createElement('h3'); h.textContent=title;
    const b=document.createElement('button'); b.type='button'; b.className='rp-see-all'; b.textContent='Ver todos →';
    b.onclick=()=>openAll(title,filter);
    head.append(h,b);
    const target=track.closest('.rp-track-wrap')||track;
    target.parentNode.insertBefore(head,target);
  }
  async function openAll(title,filter){
    const overlay=document.getElementById('rpAllOverlay');
    overlay.dataset.filter=filter; overlay.querySelector('#rpAllTitle').textContent=title;
    overlay.classList.add('open'); document.body.style.overflow='hidden';
    overlay.querySelector('#rpAllSearch').value='';
    overlay.querySelectorAll('.rp-filter').forEach(x=>x.classList.toggle('active',x.dataset.f==='todos'));

    if(!Array.isArray(window.RP_PRODUTOS) || !window.RP_PRODUTOS.length){
      try{
        if(typeof carregarCardapioDinamico==='function') await carregarCardapioDinamico();
      }catch(_){}
    }

    renderAll();
  }
  function renderAll(){
    const overlay=document.getElementById('rpAllOverlay');
    const grid=overlay.querySelector('#rpAllGrid');
    const q=overlay.querySelector('#rpAllSearch').value.trim().toLowerCase();
    const f=overlay.querySelector('.rp-filter.active')?.dataset.f||'todos';
    const cat=overlay.dataset.filter;

    let produtos=Array.isArray(window.RP_PRODUTOS) ? [...window.RP_PRODUTOS] : [];

    if(cat==='bolos') produtos=produtos.filter(p=>p.categoria==='BOLO_NO_POTE');
    if(cat==='pudins') produtos=produtos.filter(p=>p.categoria==='MINI_PUDIM');

    if(f==='disponiveis') produtos=produtos.filter(p=>!!p.disponivel);
    if(f==='destaques') produtos=produtos.filter(p=>!!p.destaque);

    if(q){
      produtos=produtos.filter(p=>
        String(p.nome||'').toLowerCase().includes(q) ||
        String(p.descricao||'').toLowerCase().includes(q)
      );
    }

    const criar=window.rpCriarCardProduto;
    const cards=typeof criar==='function' ? produtos.map(p=>criar(p)) : [];

    // Cards criados para o modal não devem depender da animação de viewport da home.
    cards.forEach(card=>{
      card.classList.remove('rp-reveal');
      card.classList.add('rp-visible');
      card.style.transitionDelay='';
    });

    grid.replaceChildren(...cards);

    if(!produtos.length){
      const e=document.createElement('div');
      e.className='rp-empty';
      e.textContent=f==='destaques'
        ? 'Nenhum produto em destaque nesta categoria.'
        : 'Nenhum produto encontrado.';
      grid.append(e);
    }
  }
  window.rpReopenCatalog = function(state){
    const overlay=document.getElementById('rpAllOverlay');
    if(!overlay || !state) return;

    overlay.dataset.filter=state.filter || 'todos';
    const title=overlay.querySelector('#rpAllTitle');
    const search=overlay.querySelector('#rpAllSearch');
    if(title) title.textContent=state.title || 'Produtos';
    if(search) search.value=state.search || '';

    overlay.querySelectorAll('.rp-filter').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.f === (state.selectedFilter || 'todos'));
    });

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';

    renderAll();

    const panel=overlay.querySelector('.rp-all-panel');
    requestAnimationFrame(()=>{
      if(panel) panel.scrollTop=Number(state.scrollTop)||0;
    });
  };

  function ensureOverlay(){
    if(document.getElementById('rpAllOverlay')) return;
    const o=document.createElement('div');o.id='rpAllOverlay';o.className='rp-all-overlay';
    o.innerHTML=`<div class="rp-all-panel" role="dialog" aria-modal="true">
      <div class="rp-all-top"><h2 id="rpAllTitle">Produtos</h2><button class="rp-all-close" type="button" aria-label="Fechar">×</button></div>
      <div class="rp-all-tools"><input id="rpAllSearch" class="rp-all-search" placeholder="Buscar sabor..." autocomplete="off">
      <button class="rp-filter active" data-f="todos">Todos</button><button class="rp-filter" data-f="disponiveis">Disponíveis</button><button class="rp-filter" data-f="destaques">Destaques</button></div>
      <div id="rpAllGrid" class="rp-all-grid"></div></div>`;
    document.body.appendChild(o);
    const fecharCatalogo=()=>{
      o.classList.remove('open');
      document.body.style.overflow='';
      if(window.RP_CATALOG_RETURN_STATE) window.RP_CATALOG_RETURN_STATE.active=false;
    };
    o.querySelector('.rp-all-close').onclick=fecharCatalogo;
    o.addEventListener('click',e=>{if(e.target===o) fecharCatalogo();});
    o.querySelector('#rpAllSearch').addEventListener('input',renderAll);
    o.querySelectorAll('.rp-filter').forEach(b=>b.onclick=()=>{o.querySelectorAll('.rp-filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderAll()});
  }
  function rebuild(){
    if(observerBusy) return; observerBusy=true;
    ensureOverlay();
    const cards=cardsOriginais();
    if(cards.length){
      // Encontra containers que já agrupam vários cards e os transforma em carrossel.
      const parents=[...new Set(cards.map(c=>c.parentElement))].filter(p=>
        p &&
        !p.classList.contains('is-loading') &&
        p.querySelectorAll(':scope > '+cardSelector().split(',').join(',:scope > ')).length>0
      );
      parents.forEach(track=>{
        enhanceTrack(track);
        const sample=track.querySelector(cardSelector());
        const cat=categoriaDoCard(sample);
        makeHeader(track,cat==='pudins'?'Mini Pudins':'Bolos no Pote',cat);
      });

      // A vitrine de "Queridinhos" foi removida da home.
      // Ela criava uma segunda faixa de cards abaixo do cardápio, duplicando
      // produtos já exibidos e gerando os "cards de baixo" sem contexto.
      const sec = document.getElementById('queridinhosSection');
      if (sec) sec.remove();
    }
    observerBusy=false;
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(rebuild,50),{once:true}); else setTimeout(rebuild,50);
  // Reaplica quando o estoque/API rerenderizar os produtos.
  const mo=new MutationObserver(()=>setTimeout(rebuild,40));
  window.addEventListener('load',()=>mo.observe(document.body,{childList:true,subtree:true}),{once:true});
})();
