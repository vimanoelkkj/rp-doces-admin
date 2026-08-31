function formatCurrencyInput(value = "") {
  const digits = String(value).replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents)) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100);
}

function formatBrazilianPhone(value = "") {
  const digits = String(value).replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length < 3) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  if (!number) return `(${ddd})`;
  if (number.length <= 5) return `(${ddd}) ${number}`;
  return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5, 9)}`;
}

function isMoneyInput(input) {
  return (
    input instanceof HTMLInputElement &&
    input.matches('[data-product-form] input[name="preco"], [data-product-form] input[name="preco_promocional"]')
  );
}

function isPhoneInput(input) {
  return (
    input instanceof HTMLInputElement &&
    input.matches('[data-manual-order-form] input[name="cliente_whatsapp"]')
  );
}

function enhanceMoney(input) {
  if (!isMoneyInput(input)) return;
  input.inputMode = "numeric";
  input.autocomplete = "off";
}

function enhancePhone(input) {
  if (!isPhoneInput(input)) return;
  input.maxLength = 15;
  input.inputMode = "numeric";
  input.autocomplete = "tel-national";
  input.value = formatBrazilianPhone(input.value);
}

function enhanceWithin(root = document) {
  root.querySelectorAll?.('[data-product-form] input[name="preco"], [data-product-form] input[name="preco_promocional"]').forEach(enhanceMoney);
  root.querySelectorAll?.('[data-manual-order-form] input[name="cliente_whatsapp"]').forEach(enhancePhone);
}

document.addEventListener("input", event => {
  const input = event.target;
  if (isMoneyInput(input)) {
    const formatted = formatCurrencyInput(input.value);
    if (input.value !== formatted) input.value = formatted;
    return;
  }
  if (isPhoneInput(input)) {
    const formatted = formatBrazilianPhone(input.value);
    if (input.value !== formatted) input.value = formatted;
  }
});

document.addEventListener("focusin", event => {
  if (isMoneyInput(event.target)) enhanceMoney(event.target);
  if (isPhoneInput(event.target)) enhancePhone(event.target);
});

const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (isMoneyInput(node)) enhanceMoney(node);
      if (isPhoneInput(node)) enhancePhone(node);
      enhanceWithin(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceWithin();
