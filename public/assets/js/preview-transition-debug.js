const params = new URLSearchParams(location.search);

if (params.get("debug") === "transitions") {
  const logs = [];
  let sampleRun = 0;
  let frozen = false;
  let userScrolled = false;

  const panel = document.createElement("aside");
  panel.setAttribute("data-transition-debug", "");
  panel.style.cssText = [
    "position:fixed",
    "z-index:99999",
    "top:8px",
    "left:8px",
    "right:8px",
    "max-height:54dvh",
    "overflow-y:auto",
    "overflow-x:hidden",
    "overscroll-behavior:contain",
    "touch-action:pan-y",
    "-webkit-overflow-scrolling:touch",
    "padding:9px 10px",
    "border-radius:10px",
    "background:rgb(20 16 16 / 90%)",
    "color:#fff",
    "font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
    "white-space:pre-wrap",
    "pointer-events:auto",
    "box-shadow:0 6px 24px rgb(0 0 0 / 28%)"
  ].join(";");

  function stamp() {
    return performance.now().toFixed(1).padStart(7, " ");
  }

  function renderPanel() {
    panel.textContent = logs.join("\n");
    if (!userScrolled) panel.scrollTop = panel.scrollHeight;
  }

  panel.addEventListener(
    "touchstart",
    () => {
      userScrolled = true;
    },
    { passive: true }
  );

  panel.addEventListener(
    "wheel",
    () => {
      userScrolled = true;
    },
    { passive: true }
  );

  panel.addEventListener("scroll", () => {
    const distanceFromBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    if (distanceFromBottom < 8) userScrolled = false;
  });

  function write(message, { force = false } = {}) {
    if (frozen && !force) return;
    const line = `${stamp()} ${message}`;
    logs.push(line);
    if (logs.length > 180) logs.shift();
    renderPanel();
    console.debug(`[rp-transition] ${line}`);
  }

  function snapshot(label) {
    const payment = document.querySelector(".rp-payment");
    const checkout = document.querySelector(".rp-checkout");
    const checkoutStyle = checkout ? getComputedStyle(checkout) : null;
    const paymentBackdrop = document.querySelector(".rp-payment__backdrop");
    const paymentBackdropStyle = paymentBackdrop ? getComputedStyle(paymentBackdrop) : null;
    const globalBackdrop = getComputedStyle(document.body, "::before");
    const catalog = document.querySelector("[data-catalog-route]");
    const catalogStyle = catalog ? getComputedStyle(catalog) : null;

    const parts = [
      label,
      `lock=${document.body.classList.contains("rp-cart-open") ? 1 : 0}`,
      `pay=${payment ? 1 : 0}`,
      `payReturn=${payment?.classList.contains("is-checkout-return") ? 1 : 0}`,
      `co=${checkout ? 1 : 0}`,
      `hidden=${checkout?.hidden ? 1 : 0}`,
      `coDisplay=${checkoutStyle?.display || "-"}`,
      `coOpacity=${checkoutStyle?.opacity || "-"}`,
      `catalogOpacity=${catalogStyle?.opacity || "-"}`,
      `catalogTransform=${catalogStyle?.transform || "-"}`,
      `payBg=${paymentBackdropStyle?.backgroundColor || "-"}`,
      `globalBg=${globalBackdrop.backgroundColor || "-"}`,
      `globalBlur=${globalBackdrop.backdropFilter || globalBackdrop.webkitBackdropFilter || "-"}`
    ];

    write(parts.join(" "));
    return Boolean(payment);
  }

  function sampleFrames(reason, total = 72) {
    const run = ++sampleRun;
    let frame = 0;
    let sawPayment = false;
    let removalFrame = null;
    frozen = false;
    userScrolled = false;
    logs.length = 0;
    snapshot(`START:${reason}`);

    function next() {
      if (run !== sampleRun || frozen) return;

      const hasPayment = snapshot(`f${String(frame).padStart(2, "0")}`);
      if (hasPayment) sawPayment = true;
      if (sawPayment && !hasPayment && removalFrame === null) {
        removalFrame = frame;
        write(`MARK:payment-removed@f${String(frame).padStart(2, "0")}`);
      }

      frame += 1;

      if (removalFrame !== null && frame > removalFrame + 10) {
        write(`FROZEN:${reason}`);
        frozen = true;
        renderPanel();
        return;
      }

      if (frame < total) requestAnimationFrame(next);
      else write(`END:${reason}`);
    }

    requestAnimationFrame(next);
  }

  document.addEventListener(
    "click",
    event => {
      const trigger = event.target.closest?.("[data-retry-payment], [data-close-payment]");
      if (!trigger) return;
      const action = trigger.matches("[data-retry-payment]") ? "retry" : "close-payment";
      sampleFrames(action);
    },
    true
  );

  const observer = new MutationObserver(mutations => {
    if (frozen) return;

    let bodyChanged = false;
    let paymentChanged = false;
    let checkoutChanged = false;
    let catalogChanged = false;

    for (const mutation of mutations) {
      if (mutation.target === document.body && mutation.attributeName === "class") bodyChanged = true;
      const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : null;
      if (element?.matches?.(".rp-payment, [data-region='payment']")) paymentChanged = true;
      if (element?.matches?.(".rp-checkout, [data-region='checkout']")) checkoutChanged = true;
      if (element?.matches?.("[data-catalog-route], [data-region='products']")) catalogChanged = true;
      if (mutation.type === "childList") {
        if (element?.matches?.("[data-region='payment']")) paymentChanged = true;
        if (element?.matches?.("[data-region='checkout']")) checkoutChanged = true;
        if (element?.matches?.("[data-region='products']")) catalogChanged = true;
      }
    }

    if (bodyChanged || paymentChanged || checkoutChanged || catalogChanged) {
      snapshot(
        `MUT:${bodyChanged ? "B" : "-"}${paymentChanged ? "P" : "-"}${checkoutChanged ? "C" : "-"}${catalogChanged ? "G" : "-"}`
      );
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "aria-hidden", "style"]
  });

  window.__rpTransitionDebug = {
    logs,
    snapshot: () => snapshot("MANUAL"),
    sampleFrames,
    unfreeze() {
      frozen = false;
      userScrolled = false;
      write("UNFROZEN", { force: true });
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.body.append(panel);
    snapshot("READY");
  });
}
