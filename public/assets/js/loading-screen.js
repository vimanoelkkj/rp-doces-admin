(() => {
  const loading = document.getElementById("rpLoadingScreen");
  const minDuration = 750;
  const startedAt = performance.now();
  let menuReady = false;
  let pageReady = document.readyState === "complete";

  function hideLoading() {
    if (!loading || !menuReady || !pageReady) return;
    const elapsed = performance.now() - startedAt;
    const wait = Math.max(0, minDuration - elapsed);
    setTimeout(() => {
      requestAnimationFrame(() => {
        loading.classList.add("is-hidden");
        loading.setAttribute("aria-busy", "false");
        setTimeout(() => loading.remove(), 320);
      });
    }, wait);
  }

  window.rpMarkMenuReady = function () {
    menuReady = true;
    hideLoading();
  };

  if (pageReady) {
    hideLoading();
  } else {
    window.addEventListener(
      "load",
      () => {
        pageReady = true;
        hideLoading();
      },
      { once: true }
    );
  }

  // Safety net: never trap the user behind the loader.
  setTimeout(() => {
    if (loading && !loading.classList.contains("is-hidden")) {
      loading.classList.add("is-hidden");
      loading.setAttribute("aria-busy", "false");
      setTimeout(() => loading.remove(), 320);
    }
  }, 2500);
})();
