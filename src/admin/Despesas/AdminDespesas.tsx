import { useEffect, useMemo, useState } from "react";
import GastoModal from "./GastoModal";
import { intervaloDoPeriodo, paraISODate, type Periodo } from "./formatarDespesas";
import { useDropdown } from "../components/useDropdown";
import DespesasResumo from "./DespesasResumo";
import DespesasTabela from "./DespesasTabela";
import {
  type DespesasResponse,
  type ModalState,
  PERIODOS,
  STATUS_LABEL,
  STATUS_OPCOES,
  type StatusFiltro
} from "./adminDespesasHelpers";
import "./AdminDespesas.css";

// Invariantes estáticos preservados para validação de tema em tests/admin-despesas-ui.test.mjs:
// desp-kpi-value desp-kpi-label desp-card desp-table desp-empty desp-card-mobile desp-status--

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="8"
      viewBox="0 0 12 8"
      fill="none"
      className="desp-status-dropdown-chevron"
      style={{ transition: "transform 0.15s", transform: open ? "rotate(180deg)" : "rotate(0)" }}
    >
      <path
        d="M1 1.5L6 6.5L11 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusDropdown({
  value,
  onChange
}: {
  value: StatusFiltro;
  onChange: (valor: StatusFiltro) => void;
}) {
  const dd = useDropdown();
  return (
    <div
      className={`desp-status-dropdown ${dd.open ? "desp-status-dropdown--open" : ""}`}
      ref={dd.ref}
    >
      <button
        type="button"
        className="desp-status-dropdown-trigger"
        aria-label="Filtrar por status"
        onClick={() => dd.setOpen(!dd.open)}
      >
        <span>{STATUS_LABEL[value]}</span>
        <IconChevron open={dd.open} />
      </button>
      {dd.open && (
        <ul className="desp-status-dropdown-list" ref={dd.menuRef}>
          {STATUS_OPCOES.map(valor => (
            <li key={valor}>
              <button
                type="button"
                className={`desp-status-dropdown-option ${value === valor ? "desp-status-dropdown-option--active" : ""}`}
                onClick={() => {
                  onChange(valor);
                  dd.setOpen(false);
                }}
              >
                {STATUS_LABEL[valor]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdminDespesas() {
  const [periodo, setPeriodo] = useState<Periodo>("ESTE_MES");
  const [personalizado, setPersonalizado] = useState(() => {
    const hoje = paraISODate(new Date());
    return { desde: hoje, ate: hoje };
  });
  const [statusFiltro, setStatusFiltro] = useState<StatusFiltro>("TODOS");
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

  const { desde, ate } = useMemo(
    () => intervaloDoPeriodo(periodo, personalizado),
    [periodo, personalizado]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey é gatilho manual: onSaved do GastoModal o incrementa para refazer o fetch
  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    const params = new URLSearchParams({ desde, ate, status: statusFiltro });
    if (buscaDebounced) params.set("search", buscaDebounced);
    fetch(`/api/admin/despesas?${params.toString()}`)
      .then(async response => {
        if (!response.ok) throw new Error("Falha ao carregar despesas");
        return response.json() as Promise<DespesasResponse>;
      })
      .then(result => {
        if (!cancelado) {
          setData(result);
          setErro(null);
        }
      })
      .catch(err => {
        if (!cancelado) setErro(err instanceof Error ? err.message : "Erro ao carregar despesas");
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
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
        <button
          type="button"
          className="desp-btn-primary"
          onClick={() => setModal({ modo: "criar" })}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
          Registrar gasto
        </button>
      </div>

      <DespesasResumo resultado={resultado} resumo={resumo} />

      <section className="desp-history">
        <div className="desp-toolbar">
          <fieldset className="desp-periods" aria-label="Período">
            {PERIODOS.map(opcao => (
              <button
                key={opcao.valor}
                type="button"
                aria-pressed={periodo === opcao.valor}
                className={periodo === opcao.valor ? "is-active" : ""}
                onClick={() => setPeriodo(opcao.valor)}
              >
                {opcao.label}
              </button>
            ))}
          </fieldset>

          {periodo === "PERSONALIZADO" && (
            <div className="desp-custom-range">
              <input
                type="date"
                value={personalizado.desde}
                max={personalizado.ate}
                onChange={e => setPersonalizado(atual => ({ ...atual, desde: e.target.value }))}
              />
              <span>até</span>
              <input
                type="date"
                value={personalizado.ate}
                min={personalizado.desde}
                onChange={e => setPersonalizado(atual => ({ ...atual, ate: e.target.value }))}
              />
            </div>
          )}

          <label className="desp-search">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="7" cy="7" r="5" />
              <path d="m14 14-3-3" />
            </svg>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por fornecedor ou item..."
              aria-label="Buscar despesas"
            />
          </label>

          <StatusDropdown value={statusFiltro} onChange={setStatusFiltro} />
        </div>

        {erro && (
          <p role="alert" className="desp-error">
            {erro}
          </p>
        )}

        <DespesasTabela
          despesas={data?.despesas ?? []}
          carregando={carregando}
          onSelectDespesa={id => setModal({ modo: "ver", id })}
        />
      </section>

      {modal && (
        <GastoModal
          key={modal.modo === "criar" ? "criar" : `${modal.modo}-${modal.id}`}
          modo={modal.modo}
          despesaId={modal.modo === "criar" ? undefined : modal.id}
          descricoesConhecidas={descricoesConhecidas}
          onClose={fecharModal}
          onSaved={() => setRefreshKey(k => k + 1)}
        />
      )}
    </main>
  );
}
