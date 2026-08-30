function dismissDesktopMenu(menu) {
  if (!menu) return;
  menu.classList.add("is-dismissed");
  menu.querySelector(".rp-desktop-menu__trigger")?.blur();
}

document.addEventListener("click", event => {
  const item = event.target.closest(
    ".rp-desktop-menu__popover button, .rp-desktop-menu__popover a"
  );
  if (!item) return;
  dismissDesktopMenu(item.closest(".rp-desktop-menu"));
});

document.addEventListener("pointerout", event => {
  const menu = event.target.closest?.(".rp-desktop-menu");
  if (!menu || menu.contains(event.relatedTarget)) return;
  menu.classList.remove("is-dismissed");
});

document.addEventListener("focusout", event => {
  const menu = event.target.closest?.(".rp-desktop-menu");
  if (!menu) return;
  requestAnimationFrame(() => {
    if (!menu.contains(document.activeElement) && !menu.matches(":hover")) {
      menu.classList.remove("is-dismissed");
    }
  });
});
