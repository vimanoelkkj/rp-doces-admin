import { describe, expect, it } from "vitest";
import { parseLegacySchedule, phoneDisplay, scheduleText } from "./store.model";

describe("store.model", () => {
  it("formata WhatsApp brasileiro sem duplicar o código do país", () => {
    expect(phoneDisplay("5531999999999")).toBe("(31) 99999-9999");
    expect(phoneDisplay("31999999999")).toBe("(31) 99999-9999");
  });

  it("resume faixa consecutiva de dias", () => {
    expect(scheduleText(["seg", "ter", "qua", "qui", "sex", "sab"], "10:00", "19:00"))
      .toBe("Seg a sáb, 10h às 19h");
  });

  it("mantém lista explícita quando os dias não são consecutivos", () => {
    expect(scheduleText(["seg", "qua", "sex"], "10:30", "18:30"))
      .toBe("Seg, Qua, Sex, 10h30 às 18h30");
  });

  it("recupera configuração legada de atendimento", () => {
    expect(parseLegacySchedule("Seg a sáb, 10h às 19h")).toEqual({
      days: ["seg", "ter", "qua", "qui", "sex", "sab"],
      open: "10:00",
      close: "19:00"
    });
  });
});
