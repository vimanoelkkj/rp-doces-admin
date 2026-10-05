const MAX_ITENS_PER_PEDIDO = 50;

export interface AdicionarItemBody {
  operationKey?: unknown;
  produtoId?: unknown;
  quantidade?: unknown;
  precoEsperadoCentavos?: unknown;
}

interface AdicionarItemDados {
  produtoId: number;
  quantidade: number;
  precoEsperadoCentavos: number;
}

interface EditarItensBody {
  itens: { produtoId: number; quantidade: number }[];
}

type ResultadoValidacao<T> =
  { ok: true; dados: T } | { ok: false; error: string; status: 400; code?: string };

export function validarAdicionarItemBody(body: unknown): ResultadoValidacao<AdicionarItemDados> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Dados do item inválidos", status: 400 };
  }
  const entrada = body as AdicionarItemBody;
  const produtoId = entrada.produtoId;
  const quantidade = entrada.quantidade;
  const precoEsperadoCentavos = entrada.precoEsperadoCentavos;
  if (
    !Number.isInteger(produtoId) ||
    Number(produtoId) <= 0 ||
    !Number.isInteger(quantidade) ||
    Number(quantidade) < 1 ||
    Number(quantidade) > 50 ||
    !Number.isSafeInteger(precoEsperadoCentavos) ||
    Number(precoEsperadoCentavos) < 1
  ) {
    return { ok: false, error: "Dados do item inválidos", status: 400 };
  }
  return {
    ok: true,
    dados: {
      produtoId: produtoId as number,
      quantidade: quantidade as number,
      precoEsperadoCentavos: precoEsperadoCentavos as number
    }
  };
}

export function validarEditarItensBody(body: unknown): ResultadoValidacao<EditarItensBody> {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !("itens" in body) ||
    !Array.isArray(body.itens) ||
    body.itens.length === 0
  ) {
    return { ok: false, error: "A comanda precisa ter ao menos um item", status: 400 };
  }
  if (body.itens.length > MAX_ITENS_PER_PEDIDO) {
    return { ok: false, error: "Itens demais", status: 400 };
  }
  if (
    !body.itens.every(
      i =>
        i &&
        typeof i === "object" &&
        !Array.isArray(i) &&
        Number.isInteger(i.produtoId) &&
        i.produtoId > 0 &&
        Number.isInteger(i.quantidade) &&
        i.quantidade >= 1 &&
        i.quantidade <= 50
    )
  ) {
    return { ok: false, error: "Item inválido", status: 400 };
  }
  return { ok: true, dados: body as EditarItensBody };
}
