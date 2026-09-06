export const STORE_DAYS = [
  ["seg", "Seg"],
  ["ter", "Ter"],
  ["qua", "Qua"],
  ["qui", "Qui"],
  ["sex", "Sex"],
  ["sab", "Sáb"],
  ["dom", "Dom"]
] as const;

export type StoreDay = (typeof STORE_DAYS)[number][0];
export type DeliveryStatus = "EM_BREVE" | "DISPONIVEL" | "INDISPONIVEL";

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  EM_BREVE: "Em breve",
  DISPONIVEL: "Disponíveis",
  INDISPONIVEL: "Indisponíveis"
};

export function phoneDisplay(value = ""): string {
  const digits = String(value).replace(/\D/g, "").replace(/^55/, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function humanTime(value = ""): string {
  const [hour = "0", minute = "00"] = String(value).split(":");
  return minute === "00" ? `${Number(hour)}h` : `${Number(hour)}h${minute}`;
}

export function scheduleText(days: StoreDay[], open: string, close: string): string {
  const activeIndexes = STORE_DAYS.reduce<number[]>((list, [key], index) => {
    if (days.includes(key)) list.push(index);
    return list;
  }, []);

  let dayText = "Nenhum dia selecionado";
  if (activeIndexes.length) {
    const consecutive = activeIndexes.every(
      (value, index) => index === 0 || value === activeIndexes[index - 1] + 1
    );

    if (consecutive && activeIndexes.length > 2) {
      const first = STORE_DAYS[activeIndexes[0]][1];
      const last = STORE_DAYS[activeIndexes.at(-1)!][1].toLowerCase();
      dayText = `${first} a ${last}`;
    } else {
      dayText = activeIndexes.map(index => STORE_DAYS[index][1]).join(", ");
    }
  }

  return `${dayText}, ${humanTime(open)} às ${humanTime(close)}`;
}

export function parseLegacySchedule(text = ""): { days: StoreDay[]; open: string; close: string } {
  const lower = String(text).toLowerCase();
  let days: StoreDay[] = [];

  if (lower.includes("seg a dom") || lower.includes("seg a domingo")) {
    days = STORE_DAYS.map(([key]) => key);
  } else if (lower.includes("seg a sáb") || lower.includes("seg a sab")) {
    days = STORE_DAYS.slice(0, 6).map(([key]) => key);
  } else if (lower.includes("seg a sex")) {
    days = STORE_DAYS.slice(0, 5).map(([key]) => key);
  } else {
    days = STORE_DAYS.filter(
      ([key, label]) => lower.includes(key) || lower.includes(label.toLowerCase())
    ).map(([key]) => key);
  }

  const times = [...String(text).matchAll(/(\d{1,2})h(?:(\d{2}))?/g)];
  const normalize = (match: RegExpMatchArray | undefined) =>
    `${String(match?.[1] || "10").padStart(2, "0")}:${match?.[2] || "00"}`;

  return {
    days,
    open: normalize(times[0]),
    close: times[1] ? normalize(times[1]) : "19:00"
  };
}

export function imageUrl(key?: string | null): string {
  return key ? `/api/images/${encodeURIComponent(key)}` : "";
}
