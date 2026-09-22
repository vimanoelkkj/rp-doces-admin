import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import {
  DESPESA_CATEGORIAS,
  DESPESA_CATEGORIA_LABEL,
  DESPESA_UNIDADES,
  DESPESA_UNIDADE_LABEL,
  type DespesaCategoria,
  type DespesaUnidade,
} from "../../../shared/despesas";
import {
  formatarPreco,
  formatarDataBr,
  parseValorReais,
  parseQuantidade,
  centavosParaValorInput,
  paraISODate,
} from "./formatarDespesas";
import "./GastoModal.css";

interface DespesaItemView {
  id: number;
  descricao: string;
  categoria: DespesaCategoria;
  quantidade: number;
  unidade: DespesaUnidade;
  valorUnitarioCentavos: number;
  valorTotalCentavos: number;
}

interface DespesaView {
  id: number;
  fornecedor: string;
  dataCompetencia: string;
  observacao: string;
  status: "ATIVA" | "CANCELADA";
  totalCentavos: number;
  itens: DespesaItemView[];
}

interface ItemForm {
  key: string;
  descricao: string;
  categoria: DespesaCategoria;
  quantidade: string;
  unidade: DespesaUnidade;
  valorUnitario: string;
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" className="gasto-dropdown-chevron"
      style={{ transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>
      <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);
  return { open, setOpen, ref, menuRef };
}

function GastoDropdown<T extends string>({ value, options, labels, disabled, onChange, ariaLabel }: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  disabled?: boolean;
  onChange: (valor: T) => void;
  ariaLabel: string;
}) {
  const dd = useDropdown();
  return (
    <div className={`gasto-dropdown ${dd.open ? "gasto-dropdown--open" : ""}`} ref={dd.ref}>
      <button type="button" className="gasto-dropdown-trigger" disabled={disabled} aria-label={ariaLabel}
        onClick={() => dd.setOpen(!dd.open)}>
        <span>{labels[value]}</span>
        <IconChevron open={dd.open} />
      </button>
      {dd.open && (
        <ul className="gasto-dropdown-list" ref={dd.menuRef}>
          {options.map((opt) => (
            <li key={opt}>
              <button type="button"
                className={`gasto-dropdown-option ${value === opt ? "gasto-dropdown-option--active" : ""}`}
                onClick={() => { onChange(opt); dd.setOpen(false); }}>
                {labels[opt]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

let proximaKey = 0;
function novoItemVazio(): ItemForm {
  proximaKey += 1;
  return {
    key: `novo-${proximaKey}`,
    descricao: "",
    categoria: "INGREDIENTES",
    quantidade: "",
    unidade: "UN",
    valorUnitario: "",
  };
}

function itensDaDespesa(despesa: DespesaView): ItemForm[] {
  return despesa.itens.map((item) => {
    proximaKey += 1;
    return {
      key: `item-${item.id}-${proximaKey}`,
      descricao: item.descricao,
      categoria: item.categoria,
      quantidade: String(item.quantidade).replace(".", ","),
      unidade: item.unidade,
      valorUnitario: centavosParaValorInput(item.valorUnitarioCentavos),
    };
  });
}

function subtotalItem(item: ItemForm): number | null {
  const quantidade = parseQuantidade(item.quantidade);
  const valorUnitarioCentavos = parseValorReais(item.valorUnitario);
  if (quantidade === null || valorUnitarioCentavos === null) return null;
  return Math.round(quantidade * valorUnitarioCentavos);
}

type Modo = "criar" | "ver" | "editar";

export default function GastoModal({ modo: modoInicial, despesaId, descricoesConhecidas, onClose, onSaved }: {
  modo: Modo;
  despesaId?: number;
  descricoesConhecidas: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
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
  const modalProps = useAdminModal(true, () => { if (!savingRef.current) onClose(); });

  useEffect(() => {
    if (modoInicial === "criar" || despesaId === undefined) return;
    let cancelado = false;
    setCarregando(true);
    fetch(`/api/admin/despesas/${despesaId}`)
      .then(async (response) => {
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
      .catch((err) => { if (!cancelado) setErro(err instanceof Error ? err.message : "Erro ao carregar despesa."); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [modoInicial, despesaId]);

  const somenteLeitura = modo === "ver";
  const totalCentavos = itens.reduce((soma, item) => soma + (subtotalItem(item) ?? 0), 0);

  function atualizarItem(key: string, campo: keyof ItemForm, valor: string) {
    setItens((atual) => atual.map((item) => (item.key === key ? { ...item, [campo]: valor } : item)));
  }

  function removerItem(key: string) {
    setItens((atual) => (atual.length <= 1 ? atual : atual.filter((item) => item.key !== key)));
  }

  function adicionarItem() {
    setItens((atual) => [...atual, novoItemVazio()]);
  }

  function validarFormulario(): { ok: true; payload: Record<string, unknown> } | { ok: false; erro: string } {
    if (!dataCompetencia) return { ok: false, erro: "Informe a data da compra." };
    if (itens.length === 0) return { ok: false, erro: "Adicione ao menos um item." };
    const itensPayload = [];
    for (const item of itens) {
      if (!item.descricao.trim()) return { ok: false, erro: "Todo item precisa de uma descrição." };
      const quantidade = parseQuantidade(item.quantidade);
      if (quantidade === null) return { ok: false, erro: `Quantidade inválida em "${item.descricao || "item"}".` };
      const valorUnitarioCentavos = parseValorReais(item.valorUnitario);
      if (valorUnitarioCentavos === null) {
        return { ok: false, erro: `Valor unitário inválido em "${item.descricao || "item"}".` };
      }
      itensPayload.push({
        descricao: item.descricao.trim(),
        categoria: item.categoria,
        quantidade,
        unidade: item.unidade,
        valorUnitarioCentavos,
      });
    }
    return {
      ok: true,
      payload: {
        fornecedor: fornecedor.trim(),
        dataCompetencia,
        observacao: observacao.trim(),
        itens: itensPayload,
      },
    };
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    const validado = validarFormulario();
    if (!validado.ok) { setErro(validado.erro); return; }

    savingRef.current = true;
    setSalvando(true);
    setErro(null);
    try {
      const url = modo === "editar" ? `/api/admin/despesas/${despesaId}` : "/api/admin/despesas";
      const method = modo === "editar" ? "PUT" : "POST";
      const response = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(validado.payload),
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

  const titulo = modo === "criar" ? "Registrar gasto" : modo === "editar" ? "Editar despesa" : "Detalhe da despesa";

  return createPortal(
    <div className="gasto-overlay" {...modalProps} role="dialog" aria-modal="true" aria-labelledby="gasto-modal-title">
      <div className="gasto-modal">
        <header className="gasto-header">
          <div>
            <p className="gasto-kicker">Despesas</p>
            <h2 id="gasto-modal-title" className="gasto-title">{titulo}</h2>
          </div>
          <button type="button" className="gasto-close" onClick={onClose} aria-label="Fechar" disabled={salvando}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="m4 4 10 10M14 4 4 14" />
            </svg>
          </button>
        </header>

        {carregando ? (
          <p className="gasto-loading">Carregando…</p>
        ) : somenteLeitura && despesa ? (
          <div className="gasto-body">
            <div className="gasto-detalhe-grid">
              <div>
                <span>Status</span>
                <strong className={`gasto-status-pill gasto-status-pill--${despesa.status.toLowerCase()}`}>
                  {despesa.status === "ATIVA" ? "Ativa" : "Cancelada"}
                </strong>
              </div>
              <div>
                <span>Fornecedor</span>
                <strong>{despesa.fornecedor || "Sem fornecedor"}</strong>
              </div>
              <div>
                <span>Data</span>
                <strong>{formatarDataBr(despesa.dataCompetencia)}</strong>
              </div>
              {despesa.observacao && (
                <div className="gasto-detalhe-span2">
                  <span>Observação</span>
                  <strong>{despesa.observacao}</strong>
                </div>
              )}
            </div>

            <div className="gasto-detalhe-itens">
              <h3>Itens</h3>
              {despesa.itens.map((item) => (
                <div className="gasto-detalhe-item" key={item.id}>
                  <div>
                    <strong>{item.descricao}</strong>
                    <span>{item.quantidade.toLocaleString("pt-BR")} {DESPESA_UNIDADE_LABEL[item.unidade]} × {formatarPreco(item.valorUnitarioCentavos)}</span>
                  </div>
                  <strong>{formatarPreco(item.valorTotalCentavos)}</strong>
                </div>
              ))}
            </div>

            <div className="gasto-total-row">
              <span>Total da despesa</span>
              <strong>{formatarPreco(despesa.totalCentavos)}</strong>
            </div>

            {erro && <p role="alert" className="gasto-error">{erro}</p>}

            <footer className="gasto-footer gasto-footer--detalhe">
              {despesa.status === "ATIVA" && (
                <>
                  <button type="button" className="gasto-btn-cancel" onClick={cancelarDespesa} disabled={cancelando}>
                    {cancelando ? "Excluindo…" : "Excluir despesa"}
                  </button>
                  <button type="button" className="gasto-btn-save" onClick={() => setModo("editar")}>
                    Editar
                  </button>
                </>
              )}
              {despesa.status === "CANCELADA" && (
                <button type="button" className="gasto-btn-cancel" onClick={onClose}>Fechar</button>
              )}
            </footer>
          </div>
        ) : (
          <form className="gasto-body" onSubmit={salvar}>
            <div className="gasto-form-grid">
              <label className="gasto-span-2">
                <span>Fornecedor (opcional)</span>
                <input value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} disabled={salvando} maxLength={200} />
              </label>
              <label>
                <span>Data da compra</span>
                <input type="date" required value={dataCompetencia}
                  onChange={(e) => setDataCompetencia(e.target.value)} disabled={salvando} />
              </label>
              <label className="gasto-span-2">
                <span>Observação (opcional)</span>
                <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} disabled={salvando} maxLength={1000} />
              </label>
            </div>

            <div className="gasto-itens-heading">
              <h3>Itens da compra</h3>
              <span>{itens.length} {itens.length === 1 ? "item" : "itens"}</span>
            </div>

            <div className="gasto-itens-list">
              <datalist id="gasto-descricoes-conhecidas">
                {descricoesConhecidas.map((nome) => <option value={nome} key={nome} />)}
              </datalist>
              {itens.map((item, index) => {
                const subtotal = subtotalItem(item);
                return (
                  <article className="gasto-item-card" key={item.key}>
                    <header>
                      <strong>Item {index + 1}</strong>
                      <button type="button" onClick={() => removerItem(item.key)}
                        disabled={salvando || itens.length <= 1} aria-label={`Remover item ${index + 1}`}>
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                          <path d="M2 4h11M6 4V2.5h3V4M3.5 4l.6 8.5h6.8l.6-8.5" />
                        </svg>
                      </button>
                    </header>
                    <div className="gasto-item-grid">
                      <label className="gasto-item-descricao">
                        <span>Descrição</span>
                        <input value={item.descricao} disabled={salvando} list="gasto-descricoes-conhecidas"
                          onChange={(e) => atualizarItem(item.key, "descricao", e.target.value)} maxLength={200} required />
                      </label>
                      <label>
                        <span>Categoria</span>
                        <GastoDropdown value={item.categoria} options={DESPESA_CATEGORIAS} labels={DESPESA_CATEGORIA_LABEL}
                          disabled={salvando} ariaLabel="Categoria"
                          onChange={(valor) => atualizarItem(item.key, "categoria", valor)} />
                      </label>
                      <label>
                        <span>Quantidade</span>
                        <input inputMode="decimal" value={item.quantidade} disabled={salvando}
                          onChange={(e) => atualizarItem(item.key, "quantidade", e.target.value)} required />
                      </label>
                      <label>
                        <span>Unidade</span>
                        <GastoDropdown value={item.unidade} options={DESPESA_UNIDADES} labels={DESPESA_UNIDADE_LABEL}
                          disabled={salvando} ariaLabel="Unidade"
                          onChange={(valor) => atualizarItem(item.key, "unidade", valor)} />
                      </label>
                      <label>
                        <span>Valor unitário</span>
                        <div className="gasto-money-input">
                          <span>R$</span>
                          <input inputMode="decimal" value={item.valorUnitario} disabled={salvando}
                            onChange={(e) => atualizarItem(item.key, "valorUnitario", e.target.value)} required />
                        </div>
                      </label>
                      <div className="gasto-item-subtotal">
                        <span>Total</span>
                        <strong>{subtotal === null ? "—" : formatarPreco(subtotal)}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <button type="button" className="gasto-btn-add-item" onClick={adicionarItem} disabled={salvando}>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M7.5 2v11M2 7.5h11" />
              </svg>
              Adicionar item
            </button>

            {erro && <p role="alert" className="gasto-error">{erro}</p>}

            <footer className="gasto-footer">
              <div className="gasto-total-row">
                <span>Total da despesa</span>
                <strong>{formatarPreco(totalCentavos)}</strong>
              </div>
              <div className="gasto-footer-actions">
                <button type="button" className="gasto-btn-cancel" onClick={onClose} disabled={salvando}>Cancelar</button>
                <button type="submit" className="gasto-btn-save" disabled={salvando}>
                  {salvando ? "Salvando…" : modo === "editar" ? "Salvar alterações" : "Registrar gasto"}
                </button>
              </div>
            </footer>
          </form>
        )}
      </div>
    </div>, document.body,
  );
}
