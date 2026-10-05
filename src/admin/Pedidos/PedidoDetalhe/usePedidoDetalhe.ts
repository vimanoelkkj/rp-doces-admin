import { useCallback, useEffect, useRef, useState } from "react";
import type { PedidoDetalheResponse, PedidoItemRow, StatusPedido } from "./types";
import { usePedidoDetalhePagamento } from "./usePedidoDetalhePagamento";
import { usePedidoDetalhePix } from "./usePedidoDetalhePix";

interface UsePedidoDetalheArgs {
  orderId: number;
  onClose: () => void;
  onStatusChanged?: () => void;
}

export function usePedidoDetalhe({ orderId, onClose, onStatusChanged }: UsePedidoDetalheArgs) {
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

  const [agora, setAgora] = useState(() => Date.now());
  const [adicionandoItem, setAdicionandoItem] = useState(false);
  const [itemCancelamentoPreviewId, setItemCancelamentoPreviewId] = useState<number | null>(null);
  const [itemTroca, setItemTroca] = useState<PedidoItemRow | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const dataRef = useRef<PedidoDetalheResponse | null>(null);
  const onStatusChangedRef = useRef(onStatusChanged);

  useEffect(() => {
    onStatusChangedRef.current = onStatusChanged;
  }, [onStatusChanged]);

  const carregarPedido = useCallback(
    (silencioso = false) => {
      if (!silencioso) setLoading(true);
      return fetch(`/api/admin/pedidos/${orderId}/reconciliar`, { method: "POST" })
        .catch(err => {
          console.warn("Falha na reconciliação da comanda", err);
        })
        .then(() => fetch(`/api/admin/pedidos/${orderId}`))
        .then(async response => {
          if (!response.ok) throw new Error("Falha ao carregar pedido");
          return response.json() as Promise<PedidoDetalheResponse>;
        })
        .then(result => {
          const anterior = dataRef.current;
          const financeiroMudou = Boolean(
            anterior &&
            (anterior.financeiro.status !== result.financeiro.status ||
              anterior.financeiro.pagoCentavos !== result.financeiro.pagoCentavos ||
              anterior.financeiro.totalCentavos !== result.financeiro.totalCentavos)
          );
          dataRef.current = result;
          setData(result);
          if (result.anulacao) {
            setEditandoNome(false);
            pagamentoCoordenacaoRef.current.setRegistrandoPagamento(false);
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
          setItemTroca(aberto => {
            if (!aberto) return aberto;
            return result.itens.find(item => item.id === aberto.id) ?? aberto;
          });
          setError(null);
          if (silencioso && financeiroMudou) onStatusChangedRef.current?.();
        })
        .catch(err => setError(err.message))
        .finally(() => {
          if (!silencioso) setLoading(false);
        });
    },
    [orderId]
  );

  const {
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
  } = usePedidoDetalhePagamento({
    orderId,
    capacidadeCobravelCentavos: data?.capacidadeCobravelCentavos,
    recarregarSilenciosamente: () => carregarPedido(true)
  });

  const {
    gerando,
    regenerandoId,
    pixError,
    pixAviso,
    setPixAviso,
    copiedId,
    pixKeysRef,
    gerarPix,
    copiarCodigo
  } = usePedidoDetalhePix({
    orderId,
    recarregarSilenciosamente: () => carregarPedido(true)
  });
  const pixCoordenacaoRef = useRef({ pixKeysRef });

  // These setters and refs are stable; keep the existing effect dependencies.
  const pagamentoCoordenacaoRef = useRef({
    setRegistrandoPagamento,
    setPagamentoError,
    pagamentoEmVooRef,
    pagamentoKeyRef
  });

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    setAdicionandoItem(false);
    setEditandoNome(false);
    pagamentoCoordenacaoRef.current.setRegistrandoPagamento(false);
    pagamentoCoordenacaoRef.current.setPagamentoError(null);
    pagamentoCoordenacaoRef.current.pagamentoEmVooRef.current = false;
    pagamentoCoordenacaoRef.current.pagamentoKeyRef.current = null;
    pixCoordenacaoRef.current.pixKeysRef.current.clear();
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

  const alterarStatus = (novoStatus: StatusPedido) => {
    if (!data || novoStatus === data.pedido.status_pedido) return;

    setAlterando(true);
    setStatusError(null);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusPedido: novoStatus })
    })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Falha ao alterar status");
        }
        setData(prev =>
          prev ? { ...prev, pedido: { ...prev.pedido, status_pedido: novoStatus } } : prev
        );
        onStatusChanged?.();
      })
      .catch(err => setStatusError(err.message))
      .finally(() => setAlterando(false));
  };

  const executarArquivamento = (arquivar: boolean) => {
    if (!data || arquivando) return;

    setArquivando(true);
    setArquivamentoError(null);
    fetch(`/api/admin/pedidos/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ arquivado: arquivar })
    })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Falha ao alterar arquivamento");
        }
        onStatusChangedRef.current?.();
        onClose();
      })
      .catch(err => setArquivamentoError(err.message))
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
      body: JSON.stringify({ clienteNome: nomeNormalizado })
    })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.error ?? "Falha ao alterar nome da cliente");
        }
        setData(prev =>
          prev
            ? {
                ...prev,
                pedido: {
                  ...prev.pedido,
                  cliente_nome: body.clienteNome ?? nomeNormalizado
                }
              }
            : prev
        );
        setEditandoNome(false);
        onStatusChangedRef.current?.();
      })
      .catch(err => setNomeError(err.message))
      .finally(() => setSalvandoNome(false));
  };

  const anulado = Boolean(data?.anulacao);
  const trocaAguardandoCobranca = Boolean(
    data?.itens.some(item => item.troca_status === "AGUARDANDO_COBRANCA")
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
    const item = data?.itens.find(i => i.id === itemId);
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
    verTrocaDoHistorico
  };
}
