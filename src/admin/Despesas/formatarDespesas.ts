// Helpers de formatação/parsing só desta tela — o vocabulário de
// categoria/unidade fica em shared/despesas.ts (usado também pelo backend).

export const formatarPreco = (centavos: number) =>
  `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

function valorUnitarioParaTexto(centavos: number): string {
  const [inteiro, decimais = ""] = (centavos / 100).toFixed(5).split(".");
  const decimaisNecessarios = decimais.replace(/0+$/, "").padEnd(2, "0");
  return `${inteiro},${decimaisNecessarios}`;
}

export const formatarValorUnitario = (centavos: number) =>
  `R$ ${valorUnitarioParaTexto(centavos)}`;

export const formatarPrecoComSinal = (centavos: number) =>
  `${centavos < 0 ? "-" : ""}R$ ${(Math.abs(centavos) / 100).toFixed(2).replace(".", ",")}`;

export const formatarMargem = (margem: number | null) =>
  margem === null ? "—" : `${margem.toFixed(1).replace(".", ",")}%`;

export const formatarDataBr = (isoDate: string) => {
  const [ano, mes, dia] = isoDate.split("-");
  return `${dia}/${mes}/${ano}`;
};

// Valor unitário aceita até 5 casas decimais em reais para não perder
// centavos no total quando a compra tem muitas unidades (ex.: 1,16305 × 200).
// O retorno continua em centavos, mas pode conter até 3 casas fracionárias.
export function parseValorReais(valor: string): number | null {
  const limpo = valor.trim().replace(/\s/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  if (!/^\d+(?:\.\d{1,5})?$/.test(normalizado)) return null;

  const [reais, fracao = ""] = normalizado.split(".");
  const unidadesCemMilesimos = Number(reais) * 100_000 + Number(fracao.padEnd(5, "0"));
  if (!Number.isSafeInteger(unidadesCemMilesimos)) return null;
  return unidadesCemMilesimos / 1000;
}

export const centavosParaValorInput = (centavos: number) => valorUnitarioParaTexto(centavos);

// Quantidade aceita até 3 casas decimais (1,5 kg / 0,5 kg / 30 un).
export function parseQuantidade(valor: string): number | null {
  const limpo = valor.trim().replace(/\s/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalizado)) return null;
  const numero = Number(normalizado);
  return numero > 0 ? numero : null;
}

function hojeLocal(): Date {
  const agora = new Date();
  agora.setHours(0, 0, 0, 0);
  return agora;
}

export function paraISODate(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export type Periodo = "HOJE" | "7DIAS" | "ESTE_MES" | "MES_PASSADO" | "PERSONALIZADO";

export function intervaloDoPeriodo(
  periodo: Periodo,
  personalizado: { desde: string; ate: string },
): { desde: string; ate: string } {
  const hoje = hojeLocal();
  if (periodo === "HOJE") {
    const iso = paraISODate(hoje);
    return { desde: iso, ate: iso };
  }
  if (periodo === "7DIAS") {
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 6);
    return { desde: paraISODate(inicio), ate: paraISODate(hoje) };
  }
  if (periodo === "ESTE_MES") {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return { desde: paraISODate(inicio), ate: paraISODate(hoje) };
  }
  if (periodo === "MES_PASSADO") {
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { desde: paraISODate(inicio), ate: paraISODate(fim) };
  }
  return personalizado;
}
