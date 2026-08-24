(() => {
  const cta = document.getElementById("rpMobileCta");
  if (!cta) return;
  const destino =
    document.getElementById("menu-grid-bolo")?.closest("section") ||
    document.getElementById("menu-grid-bolo");
  if (!destino) {
    cta.remove();
    return;
  }

  function atualizar() {
    if (innerWidth > 720) {
      cta.classList.remove("show");
      document.body.classList.remove("rp-mobile-cta-visible");
      return;
    }
    const r = destino.getBoundingClientRect();
    const passouHero = scrollY > Math.min(innerHeight * 0.55, 420);
    const estaNoCardapio = r.top < innerHeight * 0.72 && r.bottom > 90;
    const mostrar = passouHero && !estaNoCardapio;
    cta.classList.toggle("show", mostrar);
    document.body.classList.toggle("rp-mobile-cta-visible", mostrar);
  }
  cta.addEventListener("click", () =>
    destino.scrollIntoView({ behavior: "smooth", block: "start" })
  );
  addEventListener("scroll", atualizar, { passive: true });
  addEventListener("resize", atualizar);
  atualizar();
})();
