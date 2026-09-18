// HUMAN-12 — regra ÚNICA de vigência de promoção.
//
// Antes deste arquivo a regra estava duplicada em dois lugares
// (`functions/lib/pricing.ts` e `src/api/products.ts`) e nenhum dos dois
// consultava `promocao_ativa` — a única coisa que o admin realmente
// persistia. O resultado era um checkbox desconectado: ligar/desligar não
// mudava preço nenhum, e não havia como cadastrar preço promocional nem
// período.
//
// Este módulo mora em `shared/` pelo mesmo motivo que `shared/whatsapp.ts`:
// backend e frontend importam a MESMA função, então admin e catálogo não
// podem divergir por construção.
//
// AUTORIDADE: o backend continua sendo a autoridade do preço. O frontend usa
// esta regra apenas para EXIBIR; o checkout recalcula tudo pelo servidor e
// nunca confia em preço vindo do cliente.

export interface PromocaoCampos {
  preco_centavos: number;
  preco_promocional_centavos: number | null;
  /**
   * Fonte única de ativação. Obrigatório de propósito: se fosse opcional, um
   * SELECT que esquecesse a coluna faria toda promoção sumir silenciosamente.
   * Sendo obrigatório, o esquecimento vira erro de compilação.
   */
  promocao_ativa: number;
  promocao_inicio: string | null;
  promocao_fim: string | null;
}

export type PromocaoEstado =
  /** Checkbox desligado: preço normal, independente de preço/datas guardados. */
  | "DESLIGADA"
  /** Ligada, mas sem preço promocional utilizável: nada a aplicar. */
  | "SEM_PRECO"
  /** Ligada e agendada para começar depois de agora. */
  | "FUTURA"
  /** Ligada e dentro da janela (ou sem agendamento). */
  | "VIGENTE"
  /** Ligada, mas a janela já terminou. */
  | "EXPIRADA";

// `Date.parse` trata "2026-09-20T00:00:00Z" como UTC e
// "2026-09-20 00:00:00" como horário LOCAL — a mesma coluna produziria
// instantes diferentes conforme o formato. O admin passou a gravar sempre
// ISO com `Z` (inequívoco), mas a base histórica de produção pode conter o
// formato do SQLite (`CURRENT_TIMESTAMP`), que é UTC por definição. Este
// parser resolve os dois sem ambiguidade.
export function parseInstantePromocao(valor: string | null): number | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (!texto) return null;
  const normalizado = /[TZ]|[+-]\d{2}:?\d{2}$/.test(texto)
    ? texto
    : `${texto.replace(" ", "T")}Z`;
  const instante = Date.parse(normalizado);
  return Number.isFinite(instante) ? instante : null;
}

export function estadoPromocao(
  produto: PromocaoCampos,
  now: number = Date.now(),
): PromocaoEstado {
  if (!produto.promocao_ativa) return "DESLIGADA";

  const promocional = produto.preco_promocional_centavos;
  if (promocional == null || !Number.isFinite(promocional) || promocional <= 0) {
    return "SEM_PRECO";
  }

  const inicio = parseInstantePromocao(produto.promocao_inicio);
  const fim = parseInstantePromocao(produto.promocao_fim);

  // Data ilegível é ignorada em vez de derrubar a promoção inteira: o campo
  // é opcional, e "sem agendamento" é um estado legítimo.
  if (inicio !== null && now < inicio) return "FUTURA";
  if (fim !== null && now > fim) return "EXPIRADA";
  return "VIGENTE";
}

export function promocaoVigente(produto: PromocaoCampos, now?: number): boolean {
  return estadoPromocao(produto, now) === "VIGENTE";
}

/**
 * Preço a cobrar AGORA. A expiração é consequência de avaliar esta regra a
 * cada leitura — não existe cron desligando promoção, e não precisa existir:
 * o dado já responde sozinho.
 */
export function precoVigenteCentavos(
  produto: PromocaoCampos,
  now?: number,
): number {
  return promocaoVigente(produto, now)
    ? produto.preco_promocional_centavos!
    : produto.preco_centavos;
}
