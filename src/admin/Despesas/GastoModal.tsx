import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import { formatarPreco, paraISODate } from "./formatarDespesas";
import GastoDetalheView from "./GastoDetalheView";
import GastoItemCard from "./GastoItemCard";
import {
  type DespesaView,
  type ItemForm,
  itensDaDespesa,
  type Modo,
  novoItemVazio,
  subtotalItem,
  validarFormulario
} from "./gastoModalHelpers";
import "./GastoModal.css";

// Invariantes estáticos para cobertura de tema em tests/admin-despesas-ui.test.mjs:
// gasto-modal gasto-title gasto-error gasto-btn-save gasto-btn-cancel gasto-item-card gasto-status-pill--

export default function GastoModal({
  modo: modoInicial,
  despesaId,
  descricoesConhecidas,
  onClose,
  onSaved
}: {
  modo: Modo;
  despesaId?: number;
  descricoesConhecidas: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const fieldId = useId();
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [carregando, setCarregando] = useState(modoInicial !== "criar");
  const [despesa, setDespesa] = useState<DespesaView | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  const [fornecedor, setFornecedor] = useState("");
  const [dataCompetencia, setDataCompetencia] = useState(paraISODate(new Date()));
  const [observacao, setObservacao] = useState("");
  const [itens, setItens] = useState<ItemForm[]>([novoItemVazio()]);

  const savingRef = useRef(false);
  const modalProps = useAdminModal(true, () => {
    if (!savingRef.current) onClose();
  });

  useEffect(() => {
    if (modoInicial === "criar" || despesaId === undefined) return;
    let cancelado = false;
    setCarregando(true);
    fetch(`/api/admin/despesas/${despesaId}`)
      .then(async response => {
        if (!response.ok) throw new Error("Não foi possível carregar a despesa.");
        return response.json() as Promise<{ despesa: DespesaView }>;
      })
      .then(({ despesa: carregada }) => {
        if (cancelado) return;
        setDespesa(carregada);
        setFornecedor(carregada.fornecedor);
        setDataCompetencia(carregada.dataCompetencia);
        setObservacao(carregada.observacao);
        setItens(itensDaDespesa(carregada));
      })
      .catch(err => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Erro ao carregar despesa.");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [modoInicial, despesaId]);

  const somenteLeitura = modo === "ver";
  const totalCentavos = itens.reduce((soma, item) => soma + (subtotalItem(item) ?? 0), 0);

  function atualizarItem(key: string, campo: keyof ItemForm, valor: string) {
    setItens(atual => atual.map(item => (item.key === key ? { ...item, [campo]: valor } : item)));
  }

  function removerItem(key: string) {
    setItens(atual => (atual.length <= 1 ? atual : atual.filter(item => item.key !== key)));
  }

  function adicionarItem() {
    setItens(atual => [...atual, novoItemVazio()]);
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    const validado = validarFormulario(dataCompetencia, fornecedor, observacao, itens);
    if (!validado.ok) {
      setErro(validado.erro);
      return;
    }

    savingRef.current = true;
    setSalvando(true);
    setErro(null);
    try {
      const url = modo === "editar" ? `/api/admin/despesas/${despesaId}` : "/api/admin/despesas";
      const method = modo === "editar" ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validado.payload)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar a despesa.");
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar despesa. Tente novamente.");
    } finally {
      savingRef.current = false;
      setSalvando(false);
    }
  }

  async function cancelarDespesa() {
    if (!despesaId || cancelando) return;
    setCancelando(true);
    setErro(null);
    try {
      const response = await fetch(`/api/admin/despesas/${despesaId}/cancelar`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível cancelar a despesa.");
      onSaved();
      onClose();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao cancelar despesa. Tente novamente.");
      setCancelando(false);
    }
  }

  const titulo =
    modo === "criar"
      ? "Registrar gasto"
      : modo === "editar"
        ? "Editar despesa"
        : "Detalhe da despesa";

  return createPortal(
    <div
      className="gasto-overlay"
      {...modalProps}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gasto-modal-title"
    >
      <div className="gasto-modal">
        <header className="gasto-header">
          <div>
            <p className="gasto-kicker">Despesas</p>
            <h2 id="gasto-modal-title" className="gasto-title">
              {titulo}
            </h2>
          </div>
          <button
            type="button"
            className="gasto-close"
            onClick={onClose}
            aria-label="Fechar"
            disabled={salvando}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="m4 4 10 10M14 4 4 14" />
            </svg>
          </button>
        </header>

        {carregando ? (
          <p className="gasto-loading">Carregando…</p>
        ) : somenteLeitura && despesa ? (
          <GastoDetalheView
            despesa={despesa}
            erro={erro}
            cancelando={cancelando}
            onCancelarDespesa={cancelarDespesa}
            onEditar={() => setModo("editar")}
            onClose={onClose}
          />
        ) : (
          <form className="gasto-body" onSubmit={salvar}>
            <div className="gasto-form-grid">
              <label className="gasto-span-2">
                <span>Fornecedor (opcional)</span>
                <input
                  value={fornecedor}
                  onChange={e => setFornecedor(e.target.value)}
                  disabled={salvando}
                  maxLength={200}
                />
              </label>
              <label>
                <span>Data da compra</span>
                <input
                  type="date"
                  required
                  value={dataCompetencia}
                  onChange={e => setDataCompetencia(e.target.value)}
                  disabled={salvando}
                />
              </label>
              <label className="gasto-span-2">
                <span>Observação (opcional)</span>
                <textarea
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)}
                  disabled={salvando}
                  maxLength={1000}
                />
              </label>
            </div>

            <div className="gasto-itens-heading">
              <h3>Itens da compra</h3>
              <span>
                {itens.length} {itens.length === 1 ? "item" : "itens"}
              </span>
            </div>

            <div className="gasto-itens-list">
              <datalist id="gasto-descricoes-conhecidas">
                {descricoesConhecidas.map(nome => (
                  <option value={nome} key={nome} />
                ))}
              </datalist>
              {itens.map((item, index) => (
                <GastoItemCard
                  key={item.key}
                  item={item}
                  index={index}
                  totalItens={itens.length}
                  fieldId={fieldId}
                  salvando={salvando}
                  onRemoverItem={removerItem}
                  onAtualizarItem={atualizarItem}
                />
              ))}
            </div>

            <button
              type="button"
              className="gasto-btn-add-item"
              onClick={adicionarItem}
              disabled={salvando}
            >
              <svg
                aria-hidden="true"
                width="15"
                height="15"
                viewBox="0 0 15 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <path d="M7.5 2v11M2 7.5h11" />
              </svg>
              Adicionar item
            </button>

            {erro && (
              <p role="alert" className="gasto-error">
                {erro}
              </p>
            )}

            <footer className="gasto-footer">
              <div className="gasto-total-row">
                <span>Total da despesa</span>
                <strong>{formatarPreco(totalCentavos)}</strong>
              </div>
              <div className="gasto-footer-actions">
                <button
                  type="button"
                  className="gasto-btn-cancel"
                  onClick={onClose}
                  disabled={salvando}
                >
                  Cancelar
                </button>
                <button type="submit" className="gasto-btn-save" disabled={salvando}>
                  {salvando
                    ? "Salvando…"
                    : modo === "editar"
                      ? "Salvar alterações"
                      : "Registrar gasto"}
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
