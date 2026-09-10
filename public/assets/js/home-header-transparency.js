function syncHeaderTransparency() {
  const home = document.querySelector('.rp-home--redesign');
  const header = home?.querySelector('.rp-home-header');
  const hero = home?.querySelector('.rp-home-hero');
  if (!header || !hero) return;

  const headerHeight = header.getBoundingClientRect().height;
  const heroBottom = hero.getBoundingClientRect().bottom;
  const overHero = heroBottom > headerHeight + 1;

  header.classList.toggle('is-over-hero', overHero);
}

const observer = new MutationObserver(syncHeaderTransparency);
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('scroll', syncHeaderTransparency, { passive: true });
window.addEventListener('resize', syncHeaderTransparency);
window.addEventListener('load', syncHeaderTransparency);
requestAnimationFrame(syncHeaderTransparency);
