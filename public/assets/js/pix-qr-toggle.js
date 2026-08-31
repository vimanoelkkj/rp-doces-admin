document.addEventListener("click", event => {
  const summary = event.target.closest(".rp-payment__qr-mobile > summary");
  if (!summary) return;

  const details = summary.parentElement;
  if (!details) return;

  requestAnimationFrame(() => {
    summary.textContent = details.open ? "Ocultar QR Code" : "Mostrar QR Code";
  });
});
