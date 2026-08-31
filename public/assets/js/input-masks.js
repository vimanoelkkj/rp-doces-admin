export function formatBrazilianPhone(value = "") {
  const digits = String(value).replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length === 1) return `(${digits}`;
  if (digits.length === 2) return `(${digits})`;

  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  if (number.length <= 5) return `(${ddd}) ${number}`;
  return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5, 9)}`;
}

function isCheckoutPhone(input) {
  return (
    input instanceof HTMLInputElement &&
    (input.matches('[data-checkout-field="whatsapp"]') || input.id === "rp-checkout-whatsapp")
  );
}

function enhancePhone(input) {
  if (!isCheckoutPhone(input)) return;
  input.maxLength = 15;
  input.inputMode = "numeric";
  input.autocomplete = "tel-national";
  input.value = formatBrazilianPhone(input.value);
}

function enhanceWithin(root = document) {
  root.querySelectorAll?.('[data-checkout-field="whatsapp"], #rp-checkout-whatsapp').forEach(enhancePhone);
}

document.addEventListener("input", event => {
  const input = event.target;
  if (!isCheckoutPhone(input)) return;
  const formatted = formatBrazilianPhone(input.value);
  if (input.value !== formatted) input.value = formatted;
});

document.addEventListener("focusin", event => {
  if (isCheckoutPhone(event.target)) enhancePhone(event.target);
});

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (isCheckoutPhone(node)) enhancePhone(node);
      enhanceWithin(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceWithin();
