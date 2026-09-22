import { useEffect, useMemo, useRef, useState } from "react";
import { DESPESA_CATEGORIA_LABEL, type DespesaCategoria } from "../../../shared/despesas";
import GastoModal from "./GastoModal";
import {
  formatarPreco,
  formatarPrecoComSinal,
  formatarMargem,
  formatarDataBr,
  intervaloDoPeriodo,
  paraISODate,
  type Periodo,
} from "./formatarDespesas";
import "./AdminDespesas.css";

interface DespesaListItem {
  id: number;
  fornecedor: string;
  dataCompetencia: string;
  status: "ATIVA" | "CANCELADA";
  totalCentavos: number;
  itemCount: number;
}

interface CategoriaResumo {
  categoria: DespesaCategoria;
  valorCentavos: number;
  percentual: number;
}

interface ItemRankingResumo {
  descricao: string;
  valorCentavos: number;
}

interface ResultadoFinanceiro {
  faturamentoLiquidoCentavos: number;
  despesasCentavos: number;
  lucroEstimadoCentavos: number;
  margemEstimada: number | null;
}

interface DespesasResponse {
  despesas: DespesaListItem[];
  resumo: { totalCentavos: number; porCategoria: CategoriaResumo[]; rankingItens: ItemRankingResumo[] };
  resultadoFinanceiro: ResultadoFinanceiro;
}

const STATUS_OPCOES: { valor: "TODOS" | "ATIVA" | "CANCELADA"; label: string }[] = [
  { valor: "TODOS", label: "Todos" },
  { valor: "ATIVA", label: "Ativa" },
  { valor: "CANCELADA", label: "Cancelada" },
];

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="8" viewBox="0 0 12 8" fill="none" className="desp-status-dropdown-chevron"
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

function StatusDropdown({ value, onChange }: {
  value: "TODOS" | "ATIVA" | "CANCELADA";
  onChange: (valor: "TODOS" | "ATIVA" | "CANCELADA") => void;
}) {
  const dd = useDropdown();
  const atual = STATUS_OPCOES.find((o) => o.valor === value)!;
  return (
    <div className={`desp-status-dropdown ${dd.open ? "desp-status-dropdown--open" : ""}`} ref={dd.ref}>
      <button type="button" className="desp-status-dropdown-trigger" aria-label="Filtrar por status"
        onClick={() => dd.setOpen(!dd.open)}>
        <span>{atual.label}</span>
        <IconChevron open={dd.open} />
      </button>
      {dd.open && (
        <ul className="desp-status-dropdown-list" ref={dd.menuRef}>
          {STATUS_OPCOES.map((opcao) => (
            <li key={opcao.valor}>
              <button type="button"
                className={`desp-status-dropdown-option ${value === opcao.valor ? "desp-status-dropdown-option--active" : ""}`}
                onClick={() => { onChange(opcao.valor); dd.setOpen(false); }}>
                {opcao.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PERIODOS: { valor: Periodo; label: string }[] = [
  { valor: "HOJE", label: "Hoje" },
  { valor: "7DIAS", label: "7 dias" },
  { valor: "ESTE_MES", label: "Este mês" },
  { valor: "MES_PASSADO", label: "Mês passado" },
  { valor: "PERSONALIZADO", label: "Personalizado" },
];

type ModalState =
  | null
  | { modo: "criar" }
  | { modo: "ver"; id: number }
  | { modo: "editar"; id: number };

export default function AdminDespesas() {
  const [periodo, setPeriodo] = useState<Periodo>("ESTE_MES");
  const [personalizado, setPersonalizado] = useState(() => {
    const hoje = paraISODate(new Date());
    return { desde: hoje, ate: hoje };
  });
  const [statusFiltro, setStatusFiltro] = useState<"TODOS" | "ATIVA" | "CANCELADA">("TODOS");
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [modal, setModal] = useState<ModalState>(null);

  const [data, setData] = useState<DespesasResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setBuscaDebounced(busca.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [busca]);

  const { desde, ate } = useMemo(() => intervaloDoPeriodo(periodo, personalizado), [periodo, personalizado]);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    const params = new URLSearchParams({ desde, ate, status: statusFiltro });
    if (buscaDebounced) params.set("search", buscaDebounced);
    fetch(`/api/admin/despesas?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar despesas");
        return response.json() as Promise<DespesasResponse>;
      })
      .then((result) => { if (!cancelado) { setData(result); setErro(null); } })
      .catch((err) => { if (!cancelado) setErro(err instanceof Error ? err.message : "Erro ao carregar despesas"); })
      .finally(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [desde, ate, statusFiltro, buscaDebounced, refreshKey]);

  const descricoesConhecidas = useMemo(() => {
    const nomes = new Set<string>();
    for (const item of data?.resumo.rankingItens ?? []) nomes.add(item.descricao);
    return Array.from(nomes);
  }, [data]);

  function fecharModal() {
    setModal(null);
  }

  const resultado = data?.resultadoFinanceiro;
  const resumo = data?.resumo;

  return (
    <main className="admin-main desp-page">
      <div className="desp-header-row">
        <div className="desp-title-group">
          <h1 className="desp-title">Despesas</h1>
          <p className="desp-subtitle">Acompanhe os gastos da operação e o impacto no resultado.</p>
        </div>
        <button type="button" className="desp-btn-primary" onClick={() => setModal({ modo: "criar" })}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          Registrar gasto
        </button>
      </div>

      <section className="desp-kpi-strip" aria-label="Resultado financeiro">
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Faturamento líquido</span>
          <strong className="desp-kpi-value">{resultado ? formatarPreco(resultado.faturamentoLiquidoCentavos) : "—"}</strong>
        </article>
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Gastos</span>
          <strong className="desp-kpi-value">{resultado ? formatarPreco(resultado.despesasCentavos) : "—"}</strong>
        </article>
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Lucro estimado</span>
          <strong className={`desp-kpi-value ${resultado && resultado.lucroEstimadoCentavos < 0 ? "desp-kpi-value--negativo" : ""}`}>
            {resultado ? formatarPrecoComSinal(resultado.lucroEstimadoCentavos) : "—"}
          </strong>
        </article>
        <article className="desp-kpi-card">
          <span className="desp-kpi-label">Margem estimada</span>
          <strong className={`desp-kpi-value ${resultado && (resultado.margemEstimada ?? 0) < 0 ? "desp-kpi-value--negativo" : ""}`}>
            {resultado ? formatarMargem(resultado.margemEstimada) : "—"}
          </strong>
        </article>
      </section>

      <section className="desp-insights">
        <article className="desp-card desp-categoria-card">
          <div className="desp-card-heading">
            <h2>Gastos por categoria</h2>
            <span>{resumo ? formatarPreco(resumo.totalCentavos) : "—"}</span>
          </div>
          {resumo && resumo.porCategoria.length > 0 ? (
            <div className="desp-categoria-list">
              {resumo.porCategoria.map((categoria) => (
                <div className="desp-categoria-row" key={categoria.categoria}>
                  <span>{DESPESA_CATEGORIA_LABEL[categoria.categoria]}</span>
                  <div className="desp-progress"><i style={{ width: `${Math.min(100, categoria.percentual)}%` }} /></div>
                  <strong>{formatarPreco(categoria.valorCentavos)}</strong>
                  <em>{categoria.percentual.toFixed(1).replace(".", ",")}%</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="desp-empty">Nenhum gasto no período.</p>
          )}
        </article>

        <article className="desp-card desp-ranking-card">
          <div className="desp-card-heading">
            <h2>Itens com maior gasto</h2>
          </div>
          {resumo && resumo.rankingItens.length > 0 ? (
            <ol className="desp-ranking">
              {resumo.rankingItens.map((item, index) => (
                <li key={item.descricao}>
                  <b>{index + 1}</b>
                  <span>{item.descricao}</span>
                  <strong>{formatarPreco(item.valorCentavos)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="desp-empty">Nenhum item no período.</p>
          )}
        </article>
      </section>

      <section className="desp-history">
        <div className="desp-toolbar">
          <div className="desp-periods" aria-label="Período">
            {PERIODOS.map((opcao) => (
              <button key={opcao.valor} type="button" aria-pressed={periodo === opcao.valor}
                className={periodo === opcao.valor ? "is-active" : ""} onClick={() => setPeriodo(opcao.valor)}>
                {opcao.label}
              </button>
            ))}
          </div>

          {periodo === "PERSONALIZADO" && (
            <div className="desp-custom-range">
              <input type="date" value={personalizado.desde} max={personalizado.ate}
                onChange={(e) => setPersonalizado((atual) => ({ ...atual, desde: e.target.value }))} />
              <span>até</span>
              <input type="date" value={personalizado.ate} min={personalizado.desde}
                onChange={(e) => setPersonalizado((atual) => ({ ...atual, ate: e.target.value }))} />
            </div>
          )}

          <label className="desp-search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" /><path d="m14 14-3-3" />
            </svg>
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por fornecedor ou item..." aria-label="Buscar despesas" />
          </label>

          <StatusDropdown value={statusFiltro} onChange={setStatusFiltro} />
        </div>

        {erro && <p role="alert" className="desp-error">{erro}</p>}

        <div className="desp-table-panel">
          <table className="desp-table">
            <thead>
              <tr><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(data?.despesas ?? []).map((despesa) => (
                <tr key={despesa.id} className="desp-table-row" onClick={() => setModal({ modo: "ver", id: despesa.id })}>
                  <td>{formatarDataBr(despesa.dataCompetencia)}</td>
                  <td><strong>{despesa.fornecedor || "Sem fornecedor"}</strong></td>
                  <td>{despesa.itemCount} {despesa.itemCount === 1 ? "item" : "itens"}</td>
                  <td><strong>{formatarPreco(despesa.totalCentavos)}</strong></td>
                  <td>
                    <span className={`desp-status desp-status--${despesa.status.toLowerCase()}`}>
                      {despesa.status === "ATIVA" ? "Ativa" : "Cancelada"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="desp-cards-mobile">
            {(data?.despesas ?? []).map((despesa) => (
              <button type="button" key={despesa.id} className="desp-card-mobile"
                onClick={() => setModal({ modo: "ver", id: despesa.id })}>
                <div className="desp-card-mobile-row">
                  <span>{formatarDataBr(despesa.dataCompetencia)}</span>
                  <span className={`desp-status desp-status--${despesa.status.toLowerCase()}`}>
                    {despesa.status === "ATIVA" ? "Ativa" : "Cancelada"}
                  </span>
                </div>
                <strong>{despesa.fornecedor || "Sem fornecedor"}</strong>
                <div className="desp-card-mobile-row">
                  <span>{despesa.itemCount} {despesa.itemCount === 1 ? "item" : "itens"}</span>
                  <strong>{formatarPreco(despesa.totalCentavos)}</strong>
                </div>
              </button>
            ))}
          </div>

          {!carregando && (data?.despesas.length ?? 0) === 0 && (
            <p className="desp-empty desp-empty--table">Nenhuma despesa encontrada no período.</p>
          )}
        </div>
      </section>

      {modal && (
        <GastoModal
          key={modal.modo === "criar" ? "criar" : `${modal.modo}-${modal.id}`}
          modo={modal.modo}
          despesaId={modal.modo === "criar" ? undefined : modal.id}
          descricoesConhecidas={descricoesConhecidas}
          onClose={fecharModal}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </main>
  );
}
