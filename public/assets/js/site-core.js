// ⚠️ MOCKUP: troque pelo número real da sua marca (com DDI 55 + DDD, sem espaços/traços)
let WHATSAPP_NUMBER = "5533991285907";

function rpEscHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    ch =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[ch]
  );
}

const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");
menuToggle.addEventListener("click", () => navLinks.classList.toggle("open"));
navLinks.addEventListener("click", e => {
  if (e.target.tagName === "A") navLinks.classList.remove("open");
});

function renderFlavors(items, grid, tipo) {
  items.forEach(s => {
    const card = document.createElement("div");
    card.className = "flavor-card";
    card.innerHTML = `
        <div class="flavor-top">
          <div class="flavor-emoji">${rpEscHtml(s.emoji)}</div>
          <div class="flavor-price">${rpEscHtml(s.preco)}</div>
        </div>
        <h3>${rpEscHtml(s.nome)}</h3>
        <p>${rpEscHtml(s.desc)}</p>
        <button class="btn-flavor" data-sabor="${rpEscHtml(s.nome)}" data-tipo="${rpEscHtml(tipo)}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.71.45 3.38 1.3 4.85L2 22l5.35-1.4a9.9 9.9 0 0 0 4.69 1.19h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m0 1.67c2.2 0 4.27.86 5.82 2.42a8.2 8.2 0 0 1 2.42 5.82c0 4.54-3.7 8.24-8.25 8.24a8.3 8.3 0 0 1-4.2-1.15l-.3-.18-3.17.83.85-3.1-.2-.32a8.2 8.2 0 0 1-1.26-4.37c0-4.55 3.7-8.19 8.29-8.19Z"/></svg>
          Pedir esse sabor
        </button>
      `;
    grid.appendChild(card);
  });
  grid.addEventListener("click", e => {
    const btn = e.target.closest(".btn-flavor");
    if (!btn) return;
    pedirSabor(btn.getAttribute("data-sabor"), btn.getAttribute("data-tipo"));
  });
}
function pedirSabor(sabor, tipo) {
  const texto = `Olá! \uD83C\uDF70 Vim pelo site da R&P Doces e gostaria de fazer um pedido do(a) ${tipo} sabor *${sabor}*. Poderia me passar mais informações?`;
  abrirWhatsApp(texto);
}

function pedirGeral(e) {
  if (e) e.preventDefault();
  const texto = `Olá! \uD83C\uDF70 Vim pelo site da R&P Doces e gostaria de saber mais sobre os bolos no pote e mini pudins disponíveis.`;
  abrirWhatsApp(texto);
  return false;
}

function abrirWhatsApp(texto) {
  const textoEncoded = encodeURIComponent(texto);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const url = isMobile
    ? `https://wa.me/${WHATSAPP_NUMBER}?text=${textoEncoded}`
    : `https://web.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&text=${textoEncoded}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
