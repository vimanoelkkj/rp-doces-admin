const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = ["00", "30"];

function splitTime(value = "10:00") {
  const [hour = "10", minute = "00"] = String(value).split(":");
  return {
    hour: HOURS.includes(hour) ? hour : "10",
    minute: MINUTES.includes(minute) ? minute : "00"
  };
}

function closePicker(picker) {
  if (!picker) return;
  picker.classList.remove("is-open");
  picker.querySelector("[data-time-trigger]")?.setAttribute("aria-expanded", "false");
}

function closeOthers(except) {
  document.querySelectorAll("[data-time-picker].is-open").forEach(picker => {
    if (picker !== except) closePicker(picker);
  });
}

function syncPicker(picker, input) {
  const { hour, minute } = splitTime(input.value);
  const triggerValue = picker.querySelector("[data-time-value]");
  if (triggerValue) triggerValue.textContent = `${hour}:${minute}`;

  picker.querySelectorAll("[data-time-hour]").forEach(button => {
    const selected = button.dataset.timeHour === hour;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });

  picker.querySelectorAll("[data-time-minute]").forEach(button => {
    const selected = button.dataset.timeMinute === minute;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

function setPart(picker, input, part, value) {
  const current = splitTime(input.value);
  current[part] = value;
  input.value = `${current.hour}:${current.minute}`;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  syncPicker(picker, input);
}

function enhanceTimeInput(input) {
  if (input.dataset.timePickerEnhanced === "1") return;
  input.dataset.timePickerEnhanced = "1";

  const picker = document.createElement("div");
  picker.className = "store-time-picker";
  picker.dataset.timePicker = "";
  picker.innerHTML = `
    <button class="store-time-picker__trigger" type="button" data-time-trigger aria-haspopup="listbox" aria-expanded="false">
      <span data-time-value></span>
      <span class="store-time-picker__chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="store-time-picker__menu" data-time-menu hidden>
      <div class="store-time-picker__column">
        <span class="store-time-picker__label">Hora</span>
        <div class="store-time-picker__hours" role="listbox" aria-label="Hora">
          ${HOURS.map(hour => `<button type="button" role="option" data-time-hour="${hour}">${hour}</button>`).join("")}
        </div>
      </div>
      <div class="store-time-picker__column store-time-picker__column--minutes">
        <span class="store-time-picker__label">Minutos</span>
        <div class="store-time-picker__minutes" role="listbox" aria-label="Minutos">
          ${MINUTES.map(minute => `<button type="button" role="option" data-time-minute="${minute}">${minute}</button>`).join("")}
        </div>
      </div>
    </div>`;

  input.classList.add("store-time-picker__native");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.insertAdjacentElement("beforebegin", picker);

  const trigger = picker.querySelector("[data-time-trigger]");
  const menu = picker.querySelector("[data-time-menu]");

  const open = () => {
    closeOthers(picker);
    picker.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    requestAnimationFrame(() => {
      picker.querySelector("[data-time-hour].is-selected")?.scrollIntoView({ block: "center" });
    });
  };

  const close = () => {
    closePicker(picker);
    menu.hidden = true;
  };

  trigger.addEventListener("click", () => {
    if (picker.classList.contains("is-open")) close();
    else open();
  });

  trigger.addEventListener("keydown", event => {
    if (["ArrowDown", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      open();
    }
    if (event.key === "Escape") close();
  });

  picker.querySelectorAll("[data-time-hour]").forEach(button => {
    button.addEventListener("click", () => setPart(picker, input, "hour", button.dataset.timeHour));
  });

  picker.querySelectorAll("[data-time-minute]").forEach(button => {
    button.addEventListener("click", () => {
      setPart(picker, input, "minute", button.dataset.timeMinute);
      close();
      trigger.focus();
    });
  });

  picker.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
    }
  });

  input.addEventListener("input", () => syncPicker(picker, input));
  syncPicker(picker, input);
}

function scan(root = document) {
  root.querySelectorAll?.('.store-time-row input[type="time"]').forEach(enhanceTimeInput);
}

document.addEventListener("click", event => {
  document.querySelectorAll("[data-time-picker].is-open").forEach(picker => {
    if (!picker.contains(event.target)) {
      closePicker(picker);
      const menu = picker.querySelector("[data-time-menu]");
      if (menu) menu.hidden = true;
    }
  });
});

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    });
  }
});

scan();
observer.observe(document.body, { childList: true, subtree: true });
