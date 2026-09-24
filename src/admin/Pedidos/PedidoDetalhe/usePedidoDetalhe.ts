import { useCallback, useEffect, useRef, useState } from "react";
import { novaOperationKey } from "../../../lib/operationKey";
import type {
  MetodoPagamentoManual,
  PedidoDetalheResponse,
  PedidoItemRow,
  StatusPedido,
} from "./types";
import { parseValorPagamento, valorPagamentoInicial } from "./helpers";

interface UsePedidoDetalheArgs {
  orderId: number;
  onClose: () => void;
  onStatusChanged?: () => void;
}

export function usePedidoDetalhe({
  orderId,
  onClose,
  onStatusChanged,
}: UsePedidoDetalheArgs) {
  const [data, setData] = useState<PedidoDetalheResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alterando, setAlterando] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [arquivando, setArquivando] = useState(false);
  const [arquivamentoError, setArquivamentoError] = useState<string | null>(null);
  const [confirmarArquivamento, setConfirmarArquivamento] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [clienteNome, setClienteNome] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [nomeError, setNomeError] = useState<string | null>(null);
  const [registrandoPagamento, setRegistrandoPagamento] = useState(false);
  const [metodoPagamento, setMetodoPagamento] =
    useState<MetodoPagamentoManual>("DINHEIRO");
  const [valorPagamento, setValorPagamento] = useState("");
  const [pagamentoEmVoo, setPagamentoEmVoo] = useState(false);
  const [pagamentoError, setPagamentoError] = useState<string | null>(null);
  const pagamentoEmVooRef = useRef(false);
  const pagamentoKeyRef = useRef<string | null>(null);

  // Pix administrativo: `gerando` cobre a ação sem substituto; `regenerandoId`
  // guarda qual bloco específico está em voo (desabilita só aquele botão).
  // `pixAviso` é o caminho AMBÍGUO (MERCADO_PAGO_INDISPONIVEL) — nunca junta
  // com `pixError` genérico, porque a ação certa é diferente: nunca convidar
  // a tentar de novo direto, só "atualizar e conferir o que persistiu".
  const [gerando, setGerando] = useState(false);
  const [regenerandoId, setRegenerandoId] = useState<number | null>(null);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixAviso, setPixAviso] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [adicionandoItem, setAdicionandoItem] = useState(false);
  const [itemCancelamentoPreviewId, setItemCancelamentoPreviewId] = useState<number | null>(null);
  const [itemTroca, setItemTroca] = useState<PedidoItemRow | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const dataRef = useRef<PedidoDetalheResponse | null>(null);
  const pixEmVooRef = useRef<Set<string>>(new Set());
  const onStatusChangedRef = useRef(onStatusChanged);

  useEffect(() => {
    onStatusChangedRef.current = onStatusChanged;
  }, [onStatusChanged]);

  // A1: uma key por INTENÇÃO de cobrança. A identidade da ação já distingue
  // "gerar Pix novo" de "regenerar o Pix X", então o mapa é indexado por
  // ela. A key sobrevive a um retry da mesma ação (resposta perdida, erro de
  // rede) e é descartada quando a ação se resolve — assim uma regeneração
  // NOVA, iniciada explicitamente pelo operador depois, recebe key nova.
  // No caminho AMBÍGUO a key é preservada de propósito: repetir a ação nunca
  // pode nascer como uma segunda cobrança com outra identidade no MP.
  const pixKeysRef = useRef<Map<string, string>>(new Map());

  const carregarPedido = useCallback((silencioso = false) => {
    if (!silencioso) setLoading(true);
    return fetch(`/api/admin/pedidos/${orderId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar pedido");
        return response.json() as Promise<PedidoDetalheResponse>;
      })
      .then((result) => {
        const anterior = dataRef.current;
        const financeiroMudou = Boolean(
          anterior &&
            (anterior.financeiro.status !== result.financeiro.status ||
              anterior.financeiro.pagoCentavos !== result.financeiro.pagoCentavos ||
              anterior.financeiro.totalCentavos !== result.financeiro.totalCentavos),
        );
        dataRef.current = result;
        setData(result);
        if (result.anulacao) {
          setEditandoNome(false);
          setRegistrandoPagamento(false);
          setAdicionandoItem(false);
          setItemCancelamentoPreviewId(null);
          setItemTroca(null);
          setConfirmarArquivamento(false);
          setConfirmarExclusao(false);
          if (anterior && !anterior.anulacao) onStatusChangedRef.current?.();
        }
        // O modal de troca pode permanecer aberto durante a confirmação do
        // Pix. Mantém o item aberto ligado à fotografia mais recente do GET
        // para que a mudança AGUARDANDO_COBRANCA -> CONCLUIDA também atualize
        // o detalhe da troca, sem criar um segundo polling.
        setItemTroca((aberto) => {
          if (!aberto) return aberto;
          return result.itens.find((item) => item.id === aberto.id) ?? aberto;
        });
        setError(null);
        if (silencioso && financeiroMudou) onStatusChangedRef.current?.();
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!silencioso) setLoading(false);
      });
  }, [orderId]);

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    setAdicionandoItem(false);
    setEditandoNome(false);
    setRegistrandoPagamento(false);
    setPagamentoError(null);
    pagamentoEmVooRef.current = false;
    pagamentoKeyRef.current = null;
    pixKeysRef.current.clear();
    void carregarPedido();
  }, [carregarPedido]);

  // Contador de expiração dos Pix pendentes — só liga o relógio quando há
  // algo pra contar. Nunca decide sozinho que um Pix expirou: só o
  // backend/reconciliação tem autoridade pra transicionar PENDENTE ->
  // EXPIRADO (paymentSync.ts); aqui é só exibição de "tempo informado pelo
  // MP já passou", não uma mudança de estado local.
  useEffect(() => {
    if (!data || data.pixAdminPendentes.length === 0) return;
    const interval = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [data]);

  // O webhook segue sendo a autoridade da confirmação. Enquanto existir
  // uma cobrança pendente, uma releitura espaçada traz a convergência para a
  // tela sem exigir refresh manual nem manter polling quando não há trabalho.
  useEffect(() => {
    if (!data || data.pixAdminPendentes.length === 0) return;
    const interval = setInterval(() => void carregarPedido(true), 5000);
    return () => clearInterval(interval);
  }, [carregarPedido, data]);

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
        substituiId
          ? { substituiId, operationKey }
          : { operationKey, valorCentavos },
      ),
    })
      .then(async (response) => {
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
        return carregarPedido(true);
      })
      .catch((err) => setPixError(err.message))
      .finally(() => {
        pixEmVooRef.current.delete(acao);
        setGerando(false);
        setRegenerandoId(null);
      });
  };

  const copiarCodigo = (pixId: number, codigo: string) => {
    navigator.clipboard.writeText(codigo);
    setCopiedId(pixId);
    setTimeout(() => setCopiedId((atual) => (atual === pixId ? null : atual)), 2000);
  };

  const alterarStatus = (novoStatus: StatusPedido) => {
    if (!data || novoStatus === data.pedido.status_pedido) return;

    setAlterando(true);
    setStatusError(null);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusPedido: novoStatus }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao alterar status");
        }
        setData((prev) =>
          prev
            ? { ...prev, pedido: { ...prev.pedido, status_pedido: novoStatus } }
            : prev,
        );
        onStatusChanged?.();
      })
      .catch((err) => setStatusError(err.message))
      .finally(() => setAlterando(false));
  };

  const executarArquivamento = (arquivar: boolean) => {
    if (!data || arquivando) return;

    setArquivando(true);
    setArquivamentoError(null);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arquivado: arquivar }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Falha ao alterar arquivamento");
        }
        onStatusChangedRef.current?.();
        onClose();
      })
      .catch((err) => setArquivamentoError(err.message))
      .finally(() => setArquivando(false));
  };

  const clicarArquivar = () => {
    if (!data || arquivando) return;
    if (!anulado && data.pedido.arquivado === 0) {
      setConfirmarArquivamento(true);
      return;
    }
    executarArquivamento(false);
  };

  const iniciarEdicaoNome = () => {
    if (!data) return;
    setClienteNome(data.pedido.cliente_nome);
    setNomeError(null);
    setEditandoNome(true);
  };

  const salvarNome = () => {
    if (!data || salvandoNome) return;
    const nomeNormalizado = clienteNome.trim();
    if (!nomeNormalizado) {
      setNomeError("Informe o nome da cliente.");
      return;
    }
    if (nomeNormalizado.length > 200) {
      setNomeError("O nome deve ter no máximo 200 caracteres.");
      return;
    }
    if (nomeNormalizado === data.pedido.cliente_nome) {
      setEditandoNome(false);
      return;
    }

    setSalvandoNome(true);
    setNomeError(null);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clienteNome: nomeNormalizado }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Falha ao alterar nome da cliente");
        }
        setData((prev) =>
          prev
            ? {
                ...prev,
                pedido: {
                  ...prev.pedido,
                  cliente_nome: body.clienteNome ?? nomeNormalizado,
                },
              }
            : prev,
        );
        setEditandoNome(false);
        onStatusChangedRef.current?.();
      })
      .catch((err) => setNomeError(err.message))
      .finally(() => setSalvandoNome(false));
  };

  const selecionarMetodoPagamento = (metodo: MetodoPagamentoManual) => {
    setMetodoPagamento(metodo);
    setPagamentoError(null);
    pagamentoKeyRef.current = null;
  };

  const abrirRegistroPagamento = () => {
    if (!data) return;
    setValorPagamento(valorPagamentoInicial(data.capacidadeCobravelCentavos));
    setPagamentoError(null);
    pagamentoKeyRef.current = null;
    setRegistrandoPagamento(true);
  };

  const registrarPagamento = () => {
    if (!data || pagamentoEmVooRef.current) return;
    const valorCentavos = parseValorPagamento(valorPagamento);
    if (!valorCentavos) {
      setPagamentoError("Informe um valor válido.");
      return;
    }
    if (valorCentavos > data.capacidadeCobravelCentavos) {
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
      body: JSON.stringify({ metodo: metodoPagamento, valorCentavos, operationKey }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Falha ao registrar pagamento");
        }
        pagamentoKeyRef.current = null;
        setRegistrandoPagamento(false);
        return carregarPedido(true);
      })
      .catch((err) => setPagamentoError(err.message))
      .finally(() => {
        pagamentoEmVooRef.current = false;
        setPagamentoEmVoo(false);
      });
  };

  const anulado = Boolean(data?.anulacao);
  const trocaAguardandoCobranca = Boolean(
    data?.itens.some((item) => item.troca_status === "AGUARDANDO_COBRANCA"),
  );

  // "Ver detalhes" no histórico fecha o histórico e abre o modal específico
  // por cima do principal — mesmo comportamento de quem abre a partir da
  // lista de itens atual, sem empilhar um terceiro nível.
  const verCancelamentoDoHistorico = (itemId: number) => {
    if (anulado) return;
    setHistoricoAberto(false);
    setItemCancelamentoPreviewId(itemId);
  };
  const verTrocaDoHistorico = (itemId: number) => {
    if (anulado) return;
    const item = data?.itens.find((i) => i.id === itemId);
    setHistoricoAberto(false);
    if (item) setItemTroca(item);
  };

  return {
    data,
    loading,
    error,
    anulado,
    trocaAguardandoCobranca,
    alterando,
    statusError,
    arquivando,
    arquivamentoError,
    confirmarArquivamento,
    setConfirmarArquivamento,
    confirmarExclusao,
    setConfirmarExclusao,
    editandoNome,
    setEditandoNome,
    clienteNome,
    setClienteNome,
    salvandoNome,
    nomeError,
    registrandoPagamento,
    setRegistrandoPagamento,
    metodoPagamento,
    valorPagamento,
    setValorPagamento,
    pagamentoEmVoo,
    pagamentoError,
    setPagamentoError,
    pagamentoKeyRef,
    gerando,
    regenerandoId,
    pixError,
    pixAviso,
    setPixAviso,
    agora,
    copiedId,
    adicionandoItem,
    setAdicionandoItem,
    itemCancelamentoPreviewId,
    setItemCancelamentoPreviewId,
    itemTroca,
    setItemTroca,
    historicoAberto,
    setHistoricoAberto,
    carregarPedido,
    gerarPix,
    copiarCodigo,
    alterarStatus,
    executarArquivamento,
    clicarArquivar,
    iniciarEdicaoNome,
    salvarNome,
    selecionarMetodoPagamento,
    abrirRegistroPagamento,
    registrarPagamento,
    verCancelamentoDoHistorico,
    verTrocaDoHistorico,
  };
}
