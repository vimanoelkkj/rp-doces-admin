import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import { novaOperationKey } from "../../lib/operationKey";
import { reconciliarPedido } from "./reconciliarPedido";
import "./ExcluirPedidoModal.css";

type IntencaoStatus = "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "RECUSADO" | "INCONCLUSIVO";

interface PernaEstorno {
  pagamentoId: number;
  valorCentavos: number;
  restanteCentavos: number;
  intencao: { status: IntencaoStatus; ultimoErro: string | null; podeVerificar: boolean } | null;
}

interface EstadoEstorno {
  restanteTotalCentavos: number;
  pernas: PernaEstorno[];
}

const POLL_MS = 3000;

function formatarCentavos(valor: number): string {
  return (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function lerEstorno(body: unknown): EstadoEstorno | null {
  if (!body || typeof body !== "object") return null;
  const { restanteTotalCentavos, pernas } = body as Record<string, unknown>;
  if (typeof restanteTotalCentavos !== "number" || !Array.isArray(pernas)) return null;
  return { restanteTotalCentavos, pernas: pernas as PernaEstorno[] };
}

function algumaPernaEmAndamento(estado: EstadoEstorno | null): boolean {
  // `intencao === null` significa saldo reembolsável cujo estorno ainda NÃO
  // foi disparado (mostra o botão "Estornar"), não um estorno em andamento —
  // só PENDENTE/PROCESSANDO justificam "Estornando...".
  return !!estado && estado.pernas.some(p =>
    p.intencao?.status === "PENDENTE" || p.intencao?.status === "PROCESSANDO");
}

function algumaPernaRecusada(estado: EstadoEstorno | null): boolean {
  return !!estado && estado.pernas.some(p => p.intencao?.status === "RECUSADO");
}

function algumaPernaBloqueada(estado: EstadoEstorno | null): boolean {
  return !!estado && estado.pernas.some(p =>
    p.intencao?.status === "RECUSADO" || p.intencao?.status === "INCONCLUSIVO");
}

export default function ExcluirPedidoModal({ orderId, liquidoCentavos, onClose, onDeleted }: {
  orderId: number; liquidoCentavos: number; onClose: () => void; onDeleted: () => void;
}) {
  const [devolver, setDevolver] = useState<boolean | null>(null);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const modalProps = useAdminModal(true, () => { if (!savingRef.current) onClose(); });

  // Estado do estorno Mercado Pago que pode ainda bloquear a exclusão
  // (migration 0023). Enquanto a leitura inicial não resolve, `estorno`
  // continua `null` e a exclusão NÃO fica travada por isso: o servidor
  // permanece a autoridade final (trigger `pedido_anulacoes_validar_mp`)
  // se o admin conseguir submeter antes da leitura terminar.
  const [estorno, setEstorno] = useState<EstadoEstorno | null>(null);
  const [estornando, setEstornando] = useState(false);
  const [erroEstorno, setErroEstorno] = useState<string | null>(null);
  const valorMaximoPendenteRef = useRef(0);
  const operationKeyRef = useRef<string | null>(null);
  const montadoRef = useRef(true);

  function registrarEstorno(novo: EstadoEstorno) {
    if (novo.restanteTotalCentavos > valorMaximoPendenteRef.current) {
      valorMaximoPendenteRef.current = novo.restanteTotalCentavos;
    }
    setEstorno(novo);
  }

  async function carregarEstorno() {
    // O GET é somente leitura: a retomada de um estorno parado é pedida antes,
    // de forma explícita, em cada carga e em cada ciclo do polling.
    await reconciliarPedido(orderId);
    try {
      const response = await fetch(`/api/admin/pedidos/${orderId}/anulacao/estorno`);
      if (!response.ok) return;
      const lido = lerEstorno(await response.json());
      if (lido && montadoRef.current) registrarEstorno(lido);
    } catch {
      // Falha de leitura não bloqueia a exclusão indevidamente: o backend
      // continua sendo a autoridade final na hora de excluir de fato.
    }
  }

  useEffect(() => {
    montadoRef.current = true;
    carregarEstorno();
    return () => { montadoRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    if (!algumaPernaEmAndamento(estorno)) return;
    const id = setInterval(carregarEstorno, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estorno]);

  async function estornarMp() {
    if (estornando) return;
    // Uma intenção RECUSADA é terminal para a própria key (A1): só uma key
    // nova produz uma tentativa nova. PENDENTE/PROCESSANDO/INCONCLUSIVO
    // reaproveitam a mesma key com segurança (o servidor resolve por
    // pagamento, nunca por key duplicada).
    if (!operationKeyRef.current || algumaPernaRecusada(estorno)) {
      operationKeyRef.current = novaOperationKey();
    }
    setEstornando(true);
    setErroEstorno(null);
    try {
      const response = await fetch(`/api/admin/pedidos/${orderId}/anulacao/estorno`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationKey: operationKeyRef.current }),
      });
      const body = await response.json();
      if (!response.ok) {
        setErroEstorno(body?.error ?? "Não foi possível processar o estorno.");
        return;
      }
      const lido = lerEstorno(body);
      if (lido) registrarEstorno(lido);
    } catch {
      setErroEstorno("Falha de rede ao processar o estorno. Tente novamente.");
    } finally {
      setEstornando(false);
    }
  }

  async function excluir(event: React.FormEvent) {
    event.preventDefault();
    if (devolver === null || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/pedidos/${orderId}/anulacao`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ devolverEstoque: devolver, motivo }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível excluir o pedido.");
      window.dispatchEvent(new window.CustomEvent("pedido-anulado", { detail: { pedidoId: orderId } }));
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir pedido. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const restantePendenteCentavos = estorno?.restanteTotalCentavos ?? 0;
  const bloqueadoPorEstorno = restantePendenteCentavos > 0;
  const emAndamento = algumaPernaEmAndamento(estorno);
  const bloqueadoDefinitivo = algumaPernaBloqueada(estorno);

  return createPortal(
    <div className="excluir-pedido-overlay" {...modalProps} role="dialog" aria-modal="true" aria-labelledby="excluir-pedido-title">
      <form className="excluir-pedido-card" onSubmit={excluir}>
        <h2 id="excluir-pedido-title" className="excluir-pedido-title">Excluir Pedido #{orderId}?</h2>
        <p className="excluir-pedido-text">
          Este pedido será removido das telas e dos totais atuais. O histórico financeiro continuará registrado.
        </p>

        <div className="excluir-pedido-stat">
          <span className="excluir-pedido-stat-label">Valor que deixará de contar nos totais</span>
          <strong className="excluir-pedido-stat-value">
            {formatarCentavos(liquidoCentavos)}
          </strong>
        </div>

        {bloqueadoPorEstorno && (
          <div className="excluir-pedido-estorno">
            <p className="excluir-pedido-estorno-texto">
              Há {formatarCentavos(restantePendenteCentavos)} recebidos via Mercado Pago que ainda
              precisam ser estornados antes da exclusão.
            </p>
            {emAndamento ? (
              <p className="excluir-pedido-estorno-status" role="status">
                Estornando {formatarCentavos(restantePendenteCentavos)}...
              </p>
            ) : (
              <button type="button" className="excluir-pedido-estorno-botao"
                onClick={estornarMp} disabled={estornando}>
                {estornando ? "Estornando..." : bloqueadoDefinitivo
                  ? `Tentar novamente: estornar ${formatarCentavos(restantePendenteCentavos)} no Mercado Pago`
                  : `Estornar ${formatarCentavos(restantePendenteCentavos)} no Mercado Pago`}
              </button>
            )}
            {bloqueadoDefinitivo && !emAndamento && (
              <p className="excluir-pedido-estorno-erro" role="alert">
                {algumaPernaRecusada(estorno)
                  ? "O Mercado Pago recusou o estorno. Tente novamente ou trate o pagamento manualmente antes de excluir."
                  : "Não foi possível confirmar o estorno junto ao Mercado Pago. Tente novamente antes de excluir."}
              </p>
            )}
            {erroEstorno && <p className="excluir-pedido-estorno-erro" role="alert">{erroEstorno}</p>}
          </div>
        )}
        {!bloqueadoPorEstorno && valorMaximoPendenteRef.current > 0 && (
          <p className="excluir-pedido-estorno-sucesso" role="status">
            {formatarCentavos(valorMaximoPendenteRef.current)} estornados com sucesso.
          </p>
        )}

        <fieldset className="excluir-pedido-fieldset" disabled={saving || bloqueadoPorEstorno}>
          <legend className="excluir-pedido-legend">Devolver produtos ao estoque?</legend>
          <label className="excluir-pedido-radio">
            <input type="radio" name="devolverEstoque" checked={devolver === true}
              onChange={() => setDevolver(true)} required />
            Sim, devolver ao estoque
          </label>
          <label className="excluir-pedido-radio">
            <input type="radio" name="devolverEstoque" checked={devolver === false}
              onChange={() => setDevolver(false)} required />
            Não, manter estoque como está
          </label>
        </fieldset>

        <label className="excluir-pedido-field">
          <span>Motivo da exclusão (opcional)</span>
          <textarea
            className="excluir-pedido-textarea"
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            maxLength={300}
            disabled={saving}
          />
        </label>

        {error && <p role="alert" className="excluir-pedido-error">{error}</p>}

        <div className="excluir-pedido-actions">
          <button type="button" className="excluir-pedido-cancel" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="excluir-pedido-danger"
            disabled={saving || devolver === null || bloqueadoPorEstorno}>
            {saving ? "Excluindo..." : "Excluir pedido"}
          </button>
        </div>
      </form>
    </div>, document.body,
  );
}
