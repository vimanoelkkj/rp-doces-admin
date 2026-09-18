interface ScheduleDay {
  label: string;
  active: boolean;
}

export function formatScheduleText(
  days: ScheduleDay[],
  openTime: string,
  closeTime: string,
): string {
  const activeDays = days.filter((day) => day.active);
  if (activeDays.length === 0) return "Fechado";
  const dayLabel =
    activeDays.length === 7
      ? "Todos os dias"
      : `${activeDays[0].label} a ${activeDays[activeDays.length - 1].label}`;
  return `${dayLabel}: ${openTime.replace(":", "h")} às ${closeTime.replace(":", "h")}`;
}
