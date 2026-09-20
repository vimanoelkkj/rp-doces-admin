import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// HUMAN-14 — estado compartilhado das notificações do admin.
//
// Existe para que o badge da navegação e a página de Notificações leiam a
// MESMA contagem: marcar como lida na página precisa refletir no badge sem
// recarregar. Sem isso seriam duas leituras que divergem na hora.
//
// Atualização por eventos naturais (montagem, foco da janela, volta de
// visibilidade), com dedupe — exatamente o padrão que o HUMAN-11 já usa em
// `useCatalogProducts`. Sem polling, sem realtime, sem WebSocket.

export type NotificacaoTipo = "PEDIDO" | "PAGAMENTO" | "ESTOQUE" | "OPERACAO" | "TESTE";

export interface Notificacao {
  chave: string;
  tipo: NotificacaoTipo;
  titulo: string;
  descricao: string;
  em: string;
  lida: boolean;
  destino: string | null;
}

interface NotificacoesApi {
  notificacoes: Notificacao[];
  naoLidas: number;
  loading: boolean;
  error: string | null;
  revalidar: () => void;
  marcarComoLidas: (chaves: string[]) => Promise<void>;
  marcarTodasComoLidas: () => Promise<void>;
}

const MIN_REVALIDATION_INTERVAL_MS = 2_000;

const NotificacoesContext = createContext<NotificacoesApi | null>(null);

export function NotificacoesProvider({ children }: { children: React.ReactNode }) {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ativo = useRef(true);
  const emVoo = useRef(false);
  const ultimaRequisicao = useRef(0);

  const aplicar = useCallback((dados: { notificacoes: Notificacao[]; naoLidas: number }) => {
    if (!ativo.current) return;
    setNotificacoes(dados.notificacoes);
    setNaoLidas(dados.naoLidas);
    setError(null);
  }, []);

  const carregar = useCallback(
    (inicial = false) => {
      const agora = Date.now();
      if (emVoo.current) return;
      if (!inicial && agora - ultimaRequisicao.current < MIN_REVALIDATION_INTERVAL_MS) return;
      emVoo.current = true;
      ultimaRequisicao.current = agora;
      if (inicial) setLoading(true);

      fetch("/api/admin/notificacoes")
        .then(async (response) => {
          if (!response.ok) throw new Error("Falha ao carregar notificações");
          return response.json() as Promise<{ notificacoes: Notificacao[]; naoLidas: number }>;
        })
        .then(aplicar)
        .catch((motivo: unknown) => {
          if (!ativo.current) return;
          setError(motivo instanceof Error ? motivo.message : "Falha ao carregar notificações");
        })
        .finally(() => {
          emVoo.current = false;
          if (ativo.current) setLoading(false);
        });
    },
    [aplicar],
  );

  useEffect(() => {
    ativo.current = true;
    const aoFocar = () => carregar();
    const aoAnular = () => carregar(true);
    const aoFicarVisivel = () => {
      if (document.visibilityState === "visible") carregar();
    };

    carregar(true);
    window.addEventListener("focus", aoFocar);
    window.addEventListener("pedido-anulado", aoAnular);
    document.addEventListener("visibilitychange", aoFicarVisivel);
    return () => {
      ativo.current = false;
      window.removeEventListener("focus", aoFocar);
      window.removeEventListener("pedido-anulado", aoAnular);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
    };
  }, [carregar]);

  // O POST já devolve o estado recalculado pelo servidor, então marcar como
  // lida não precisa de uma segunda leitura nem de contagem otimista local.
  const marcar = useCallback(
    async (corpo: { todas: true } | { chaves: string[] }) => {
      try {
        const response = await fetch("/api/admin/notificacoes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
        if (!response.ok) throw new Error("Falha ao marcar notificações");
        aplicar(await response.json());
      } catch (motivo: unknown) {
        if (!ativo.current) return;
        setError(motivo instanceof Error ? motivo.message : "Falha ao marcar notificações");
      }
    },
    [aplicar],
  );

  return (
    <NotificacoesContext.Provider
      value={{
        notificacoes,
        naoLidas,
        loading,
        error,
        revalidar: () => carregar(),
        marcarComoLidas: (chaves) => marcar({ chaves }),
        marcarTodasComoLidas: () => marcar({ todas: true }),
      }}
    >
      {children}
    </NotificacoesContext.Provider>
  );
}

export function useNotificacoes(): NotificacoesApi {
  const contexto = useContext(NotificacoesContext);
  if (!contexto) {
    throw new Error("useNotificacoes precisa estar dentro de NotificacoesProvider");
  }
  return contexto;
}
