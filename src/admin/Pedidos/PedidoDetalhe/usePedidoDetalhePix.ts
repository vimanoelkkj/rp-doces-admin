import { useRef, useState } from "react";
import { novaOperationKey } from "../../../lib/operationKey";

interface UsePedidoDetalhePixArgs {
  orderId: number;
  recarregarSilenciosamente: () => Promise<void>;
}

export function usePedidoDetalhePix({
  orderId,
  recarregarSilenciosamente
}: UsePedidoDetalhePixArgs) {
  // Pix administrativo: `gerando` cobre a ação sem substituto; `regenerandoId`
  // guarda qual bloco específico está em voo (desabilita só aquele botão).
  // `pixAviso` é o caminho AMBÍGUO (MERCADO_PAGO_INDISPONIVEL) — nunca junta
  // com `pixError` genérico, porque a ação certa é diferente: nunca convidar
  // a tentar de novo direto, só "atualizar e conferir o que persistiu".
  const [gerando, setGerando] = useState(false);
  const [regenerandoId, setRegenerandoId] = useState<number | null>(null);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixAviso, setPixAviso] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copySequenceRef = useRef(0);
  const pixEmVooRef = useRef<Set<string>>(new Set());

  // A1: uma key por INTENÇÃO de cobrança. A identidade da ação já distingue
  // "gerar Pix novo" de "regenerar o Pix X", então o mapa é indexado por
  // ela. A key sobrevive a um retry da mesma ação (resposta perdida, erro de
  // rede) e é descartada quando a ação se resolve — assim uma regeneração
  // NOVA, iniciada explicitamente pelo operador depois, recebe key nova.
  // No caminho AMBÍGUO a key é preservada de propósito: repetir a ação nunca
  // pode nascer como uma segunda cobrança com outra identidade no MP.
  const pixKeysRef = useRef<Map<string, string>>(new Map());

  const gerarPix = (substituiId?: number, valorCentavos?: number) => {
    setPixError(null);
    setPixAviso(null);
    if (substituiId) setRegenerandoId(substituiId);
    else setGerando(true);

    const acao = substituiId ? `regen:${substituiId}` : "novo";
    if (pixEmVooRef.current.has(acao)) return;
    pixEmVooRef.current.add(acao);
    let operationKey = pixKeysRef.current.get(acao);
    if (!operationKey) {
      operationKey = novaOperationKey();
      pixKeysRef.current.set(acao, operationKey);
    }

    fetch(`/api/admin/pedidos/${orderId}/pix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        substituiId ? { substituiId, operationKey } : { operationKey, valorCentavos }
      )
    })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          // Erro ambíguo ou operação ainda em processamento (código, não
          // texto — nunca inferir pela mensagem): nunca sabemos se o MP criou
          // a cobrança mesmo assim. Não convida a tentar de novo, só a
          // atualizar e conferir o que persistiu (a próxima carga do GET
          // reflete a verdade do ledger). A key é PRESERVADA: se a ação for
          // repetida, ela recupera a MESMA operação em vez de abrir outra.
          if (
            body.code === "MERCADO_PAGO_INDISPONIVEL" ||
            body.code === "OPERACAO_EM_PROCESSAMENTO"
          ) {
            setPixAviso(body.error ?? "Não foi possível confirmar a criação do Pix.");
            return;
          }
          // Qualquer outro erro é conclusivo para esta intenção: descarta a
          // key para que uma nova tentativa do operador seja tratada como a
          // intenção nova que ela é.
          pixKeysRef.current.delete(acao);
          throw new Error(body.error ?? "Falha ao gerar Pix");
        }
        pixKeysRef.current.delete(acao);
        return recarregarSilenciosamente();
      })
      .catch(err => setPixError(err.message))
      .finally(() => {
        pixEmVooRef.current.delete(acao);
        setGerando(false);
        setRegenerandoId(null);
      });
  };

  const copiarCodigo = async (pixId: number, codigo: string) => {
    const copySequence = ++copySequenceRef.current;
    setCopiedId(null);
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(codigo);
      if (copySequence !== copySequenceRef.current) return;
      setCopiedId(pixId);
      setTimeout(() => {
        if (copySequence === copySequenceRef.current) setCopiedId(null);
      }, 2000);
    } catch {
      if (copySequence === copySequenceRef.current) {
        setCopyError("Não foi possível copiar o código Pix. Tente novamente.");
      }
    }
  };

  return {
    gerando,
    regenerandoId,
    pixError,
    pixAviso,
    setPixAviso,
    copiedId,
    copyError,
    pixEmVooRef,
    pixKeysRef,
    gerarPix,
    copiarCodigo
  };
}
