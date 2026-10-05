import { useEffect, useRef, useState } from "react";
import { novaOperationKey } from "../../../lib/operationKey";
import { parseValorPagamento, valorPagamentoInicial } from "./helpers";
import type { MetodoPagamentoManual } from "./types";
import {
  type PaymentIntent,
  isDefinitivePaymentRejection,
  matchesPaymentIntent,
  readPaymentIntents,
  resolvePaymentIntent,
  storePaymentIntent
} from "./manualPaymentIntent";

interface UsePedidoDetalhePagamentoArgs {
  orderId: number;
  capacidadeCobravelCentavos: number | undefined;
  recarregarSilenciosamente: () => Promise<void>;
}

export function usePedidoDetalhePagamento({
  orderId,
  capacidadeCobravelCentavos,
  recarregarSilenciosamente
}: UsePedidoDetalhePagamentoArgs) {
  const [registrandoPagamento, setRegistrandoPagamento] = useState(false);
  const [metodoPagamento, setMetodoPagamento] = useState<MetodoPagamentoManual>("DINHEIRO");
  const [valorPagamento, setValorPagamento] = useState("");
  const [pagamentoEmVoo, setPagamentoEmVoo] = useState(false);
  const [pagamentoError, setPagamentoError] = useState<string | null>(null);
  const pagamentoEmVooRef = useRef(false);
  const pagamentoKeyRef = useRef<string | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PaymentIntent | null>(null);

  useEffect(() => {
    try {
      setPendingIntent(readPaymentIntents(orderId).slice(-1)[0] ?? null);
    } catch {
      setPendingIntent(null);
    }
  }, [orderId]);

  const selecionarMetodoPagamento = (metodo: MetodoPagamentoManual) => {
    setMetodoPagamento(metodo);
    setPagamentoError(null);
    pagamentoKeyRef.current = null;
  };

  const abrirRegistroPagamento = () => {
    if (capacidadeCobravelCentavos === undefined) return;
    setRegistrandoPagamento(true);
    setValorPagamento(valorPagamentoInicial(capacidadeCobravelCentavos));
    try {
      const pending = readPaymentIntents(orderId).slice(-1)[0];
      setPendingIntent(pending ?? null);
      setValorPagamento(
        valorPagamentoInicial(pending?.payload.valorCentavos ?? capacidadeCobravelCentavos)
      );
      if (pending) setMetodoPagamento(pending.payload.metodo);
      setPagamentoError(null);
      pagamentoKeyRef.current = pending?.operationKey ?? null;
    } catch {
      setPagamentoError(
        "Não foi possível recuperar a tentativa de pagamento. Verifique o armazenamento do navegador."
      );
    }
  };

  const registrarPagamento = () => {
    if (capacidadeCobravelCentavos === undefined || pagamentoEmVooRef.current) return;
    const valorCentavos = parseValorPagamento(valorPagamento);
    if (!valorCentavos) {
      setPagamentoError("Informe um valor válido.");
      return;
    }
    const payload = { metodo: metodoPagamento, valorCentavos };
    let intent: PaymentIntent;
    try {
      const pending = readPaymentIntents(orderId).find(candidate =>
        matchesPaymentIntent(candidate, orderId, payload)
      );
      // An unresolved intent must reach A1 replay even if its commit reduced the balance.
      if (!pending && valorCentavos > capacidadeCobravelCentavos) {
        setPagamentoError("O valor não pode ultrapassar o saldo em aberto.");
        return;
      }
      intent = pending ?? {
        version: 1,
        state: "pending",
        pedidoId: orderId,
        operationKey: novaOperationKey(),
        payload
      };
      storePaymentIntent(intent);
    } catch {
      setPagamentoError(
        "Não foi possível salvar a tentativa de pagamento. Verifique o armazenamento do navegador."
      );
      return;
    }

    pagamentoEmVooRef.current = true;
    setPagamentoEmVoo(true);
    setPagamentoError(null);
    const operationKey = intent.operationKey;
    pagamentoKeyRef.current = operationKey;
    setPendingIntent(intent);

    fetch(`/api/admin/pedidos/${orderId}/pagamentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metodo: metodoPagamento, valorCentavos, operationKey })
    })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) {
          if (
            typeof body?.error === "string" &&
            isDefinitivePaymentRejection(response.status, body.code)
          ) {
            resolvePaymentIntent(intent);
            pagamentoKeyRef.current = null;
            setPendingIntent(readPaymentIntents(orderId).slice(-1)[0] ?? null);
          }
          throw new Error(body.error ?? "Falha ao registrar pagamento");
        }
        if (body?.ok !== true)
          throw new Error("Não foi possível confirmar o pagamento. Retome a tentativa.");
        resolvePaymentIntent(intent);
        pagamentoKeyRef.current = null;
        setPendingIntent(readPaymentIntents(orderId).slice(-1)[0] ?? null);
        setRegistrandoPagamento(false);
        return recarregarSilenciosamente();
      })
      .catch(err => setPagamentoError(err.message))
      .finally(() => {
        pagamentoEmVooRef.current = false;
        setPagamentoEmVoo(false);
      });
  };

  return {
    registrandoPagamento,
    setRegistrandoPagamento,
    metodoPagamento,
    valorPagamento,
    setValorPagamento,
    pagamentoEmVoo,
    pagamentoError,
    setPagamentoError,
    pagamentoEmVooRef,
    pagamentoKeyRef,
    pagamentoPendente: pendingIntent?.pedidoId === orderId,
    selecionarMetodoPagamento,
    abrirRegistroPagamento,
    registrarPagamento
  };
}
