(() => {
  if (!document.querySelector("link[data-rp-auth-redesign]")) {
    const authStyles = document.createElement("link");
    authStyles.rel = "stylesheet";
    authStyles.href = "/admin/assets/css/auth-redesign.css";
    authStyles.dataset.rpAuthRedesign = "1";
    document.head.appendChild(authStyles);
  }

  let locked = false;
  let scrollYBeforeLock = 0;

  function hasOpenModal() {
    const nativeModal = [...document.querySelectorAll(".modal-bg")].some(
      el => !el.classList.contains("hidden")
    );
    const customModal = !!document.querySelector(
      ".order-detail-overlay.open, .rp-delete-overlay.open"
    );
    return nativeModal || customModal;
  }

  function lock() {
    if (locked) return;
    scrollYBeforeLock = window.scrollY || document.documentElement.scrollTop || 0;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollYBeforeLock}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    locked = true;
  }

  function unlock() {
    if (!locked) return;
    const body = document.body;
    body.style.position = "";
    body.style.top = "";
    body.style.left = "";
    body.style.right = "";
    body.style.width = "";
    body.style.overflow = "";
    locked = false;
    window.scrollTo(0, scrollYBeforeLock);
  }

  function sync() {
    hasOpenModal() ? lock() : unlock();
  }

  new MutationObserver(sync).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });
  addEventListener("pageshow", sync);
  sync();
})();
