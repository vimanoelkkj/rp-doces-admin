const DESKTOP_HOME_QUERY = "(min-width: 1024px)";
const REVEAL_SELECTOR = ".rp-home > .rp-home-section, .rp-home > .rp-home-footer";

let observer = null;
let activeHome = null;

function cleanupReveal() {
  observer?.disconnect();
  observer = null;
  activeHome = null;
}

function revealAll(home) {
  home.classList.remove("rp-home-reveal-ready");
  home.querySelectorAll(REVEAL_SELECTOR).forEach(section => {
    section.classList.remove("rp-home-reveal-item", "is-visible");
  });
}

function setupReveal() {
  const home = document.querySelector("[data-home-landing]");
  if (!home) {
    cleanupReveal();
    return;
  }

  if (!matchMedia(DESKTOP_HOME_QUERY).matches || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cleanupReveal();
    revealAll(home);
    return;
  }

  if (home === activeHome && observer) return;

  cleanupReveal();
  activeHome = home;

  const sections = [...home.querySelectorAll(REVEAL_SELECTOR)];
  if (!sections.length) return;

  sections.forEach(section => section.classList.add("rp-home-reveal-item"));
  home.classList.add("rp-home-reveal-ready");

  observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer?.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  sections.forEach(section => observer.observe(section));
}

const media = matchMedia(DESKTOP_HOME_QUERY);
media.addEventListener?.("change", setupReveal);

const root = document.getElementById("rp-app");
if (root) {
  new MutationObserver(setupReveal).observe(root, { childList: true, subtree: true });
}

queueMicrotask(setupReveal);
