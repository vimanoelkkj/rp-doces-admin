const params = new URLSearchParams(location.search);

if (params.get("debug") === "transitions") {
  const logs = [];
  let sampleRun = 0;

  const panel = document.createElement("aside");
  panel.setAttribute("data-transition-debug", "");
  panel.style.cssText = [
    "position:fixed",
    "z-index:99999",
    "top:8px",
    "left:8px",
    "right:8px",
    "max-height:42dvh",
    "overflow:auto",
    "padding:9px 10px",
    "border-radius:10px",
    "background:rgb(20 16 16 / 88%)",
    "color:#fff",
    "font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
    "white-space:pre-wrap",
    "pointer-events:none",
    "box-shadow:0 6px 24px rgb(0 0 0 / 28%)"
  ].join(";");

  function stamp() {
    return performance.now().toFixed(1).padStart(7, " ");
  }

  function write(message) {
    const line = `${stamp()} ${message}`;
    logs.push(line);
    if (logs.length > 120) logs.shift();
    panel.textContent = logs.slice(-18).join("\n");
    panel.scrollTop = panel.scrollHeight;
    console.debug(`[rp-transition] ${line}`);
  }

  function snapshot(label) {
    const payment = document.querySelector(".rp-payment");
    const checkout = document.querySelector(".rp-checkout");
    const checkoutStyle = checkout ? getComputedStyle(checkout) : null;
    const paymentBackdrop = document.querySelector(".rp-payment__backdrop");
    const paymentBackdropStyle = paymentBackdrop ? getComputedStyle(paymentBackdrop) : null;
    const globalBackdrop = getComputedStyle(document.body, "::before");

    const parts = [
      label,
      `lock=${document.body.classList.contains("rp-cart-open") ? 1 : 0}`,
      `pay=${payment ? 1 : 0}`,
      `payReturn=${payment?.classList.contains("is-checkout-return") ? 1 : 0}`,
      `co=${checkout ? 1 : 0}`,
      `hidden=${checkout?.hidden ? 1 : 0}`,
      `coDisplay=${checkoutStyle?.display || "-"}`,
      `coOpacity=${checkoutStyle?.opacity || "-"}`,
      `payBg=${paymentBackdropStyle?.backgroundColor || "-"}`,
      `globalBg=${globalBackdrop.backgroundColor || "-"}`,
      `globalBlur=${globalBackdrop.backdropFilter || globalBackdrop.webkitBackdropFilter || "-"}`
    ];

    write(parts.join(" "));
  }

  function sampleFrames(reason, total = 36) {
    const run = ++sampleRun;
    let frame = 0;
    snapshot(`START:${reason}`);

    function next() {
      if (run !== sampleRun) return;
      snapshot(`f${String(frame).padStart(2, "0")}`);
      frame += 1;
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
    let bodyChanged = false;
    let paymentChanged = false;
    let checkoutChanged = false;

    for (const mutation of mutations) {
      if (mutation.target === document.body && mutation.attributeName === "class") bodyChanged = true;
      const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : null;
      if (element?.matches?.(".rp-payment, [data-region='payment']")) paymentChanged = true;
      if (element?.matches?.(".rp-checkout, [data-region='checkout']")) checkoutChanged = true;
      if (mutation.type === "childList") {
        if (element?.matches?.("[data-region='payment']")) paymentChanged = true;
        if (element?.matches?.("[data-region='checkout']")) checkoutChanged = true;
      }
    }

    if (bodyChanged || paymentChanged || checkoutChanged) {
      snapshot(
        `MUT:${bodyChanged ? "B" : "-"}${paymentChanged ? "P" : "-"}${checkoutChanged ? "C" : "-"}`
      );
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "aria-hidden"]
  });

  window.__rpTransitionDebug = {
    logs,
    snapshot: () => snapshot("MANUAL"),
    sampleFrames
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.body.append(panel);
    snapshot("READY");
  });
}
