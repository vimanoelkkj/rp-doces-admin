import { useEffect, useState } from "react";
import { segundosRestantes } from "../lib/aguardandoPagamento";

// Segundos até `expiresAt`, atualizados a cada segundo; `null` enquanto não há prazo.
export function useContagemRegressiva(expiresAt: string | null | undefined): number | null {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      setTimeLeft(segundosRestantes(expiresAt));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return timeLeft;
}
