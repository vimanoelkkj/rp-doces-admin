(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function prepararReveals(root=document) {
    const candidatos = root.querySelectorAll(
      '.flavor-card, section h2, section h3, section > p, .hero img, .hero h1, .hero p'
    );
    candidatos.forEach((el, i) => {
      if (el.classList.contains('rp-reveal')) return;
      el.classList.add('rp-reveal');
      if (!reduced) el.style.transitionDelay = `${Math.min(i % 5, 4) * 55}ms`;
      observer?.observe(el);
    });
  }

  const observer = reduced ? null : new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('rp-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: .10, rootMargin: '0px 0px -5% 0px' });

  if (reduced) {
    document.documentElement.classList.add('rp-reduced-motion');
  }

  document.addEventListener('DOMContentLoaded', () => {
    prepararReveals();
    if (reduced) document.querySelectorAll('.rp-reveal').forEach(x => x.classList.add('rp-visible'));

    /* O cardápio é re-renderizado pela API, então observamos apenas novos cards. */
    const alvo = document.body;
    new MutationObserver(muts => {
      let precisa = false;
      for (const m of muts) if (m.addedNodes.length) { precisa = true; break; }
      if (precisa) prepararReveals();
    }).observe(alvo, { childList:true, subtree:true });
  });
})();
