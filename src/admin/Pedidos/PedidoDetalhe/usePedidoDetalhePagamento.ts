import { useRef, useState } from "react";
import { novaOperationKey } from "../../../lib/operationKey";
import { parseValorPagamento, valorPagamentoInicial } from "./helpers";
import type { MetodoPagamentoManual } from "./types";

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

  const selecionarMetodoPagamento = (metodo: MetodoPagamentoManual) => {
    setMetodoPagamento(metodo);
    setPagamentoError(null);
    pagamentoKeyRef.current = null;
  };

  const abrirRegistroPagamento = () => {
    if (capacidadeCobravelCentavos === undefined) return;
    setValorPagamento(valorPagamentoInicial(capacidadeCobravelCentavos));
    setPagamentoError(null);
    pagamentoKeyRef.current = null;
    setRegistrandoPagamento(true);
  };

  const registrarPagamento = () => {
    if (capacidadeCobravelCentavos === undefined || pagamentoEmVooRef.current) return;
    const valorCentavos = parseValorPagamento(valorPagamento);
    if (!valorCentavos) {
      setPagamentoError("Informe um valor válido.");
      return;
    }
    if (valorCentavos > capacidadeCobravelCentavos) {
      setPagamentoError("O valor não pode ultrapassar o saldo em aberto.");
      return;
    }

    pagamentoEmVooRef.current = true;
    setPagamentoEmVoo(true);
    setPagamentoError(null);
    const operationKey = pagamentoKeyRef.current ?? novaOperationKey();
    pagamentoKeyRef.current = operationKey;

    fetch(`/api/admin/pedidos/${orderId}/pagamentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metodo: metodoPagamento, valorCentavos, operationKey })
    })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Falha ao registrar pagamento");
        }
        pagamentoKeyRef.current = null;
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
    selecionarMetodoPagamento,
    abrirRegistroPagamento,
    registrarPagamento
  };
}
