const CATEGORIAS = new Set(["BOLO_NO_POTE", "MINI_PUDIM"]);
const CAMPOS_PERMITIDOS = new Set([
  "nome",
  "categoria",
  "descricao",
  "preco_centavos",
  "disponivel",
  "ativo",
  "destaque",
  "emoji",
  "estoque",
  "promocao_ativa",
  "preco_promocional_centavos",
  "promocao_inicio",
  "promocao_fim"
]);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

export function validarProduto(payload) {
  if (!isPlainObject(payload)) return { ok: false };

  const campos = Object.keys(payload);
  if (campos.some(campo => !CAMPOS_PERMITIDOS.has(campo))) return { ok: false };

  const obrigatorios = ["nome", "categoria", "preco_centavos"];
  if (obrigatorios.some(campo => !Object.prototype.hasOwnProperty.call(payload, campo)))
    return { ok: false };

  if (typeof payload.nome !== "string" || typeof payload.categoria !== "string")
    return { ok: false };
  if (payload.descricao !== undefined && typeof payload.descricao !== "string")
    return { ok: false };
  if (payload.emoji !== undefined && typeof payload.emoji !== "string") return { ok: false };

  const nome = payload.nome.trim();
  const categoria = payload.categoria;
  const descricao = (payload.descricao ?? "").trim();
  const emoji = (payload.emoji ?? "").trim();
  const preco = payload.preco_centavos;
  const estoque = payload.estoque ?? 0;
  const promocaoAtiva = payload.promocao_ativa ?? false;
  const precoPromocional = payload.preco_promocional_centavos ?? null;
  const promocaoInicio = payload.promocao_inicio || null;
  const promocaoFim = payload.promocao_fim || null;

  if (nome.length < 1 || nome.length > 100) return { ok: false };
  if (!CATEGORIAS.has(categoria)) return { ok: false };
  if (descricao.length > 500) return { ok: false };
  if ([...emoji].length > 16) return { ok: false };
  if (typeof preco !== "number" || !Number.isSafeInteger(preco) || preco < 1 || preco > 10_000_000)
    return { ok: false };
  if (
    typeof estoque !== "number" ||
    !Number.isSafeInteger(estoque) ||
    estoque < 0 ||
    estoque > 100000
  )
    return { ok: false };
  if (typeof promocaoAtiva !== "boolean") return { ok: false };
  if (
    precoPromocional !== null &&
    (typeof precoPromocional !== "number" ||
      !Number.isSafeInteger(precoPromocional) ||
      precoPromocional < 1 ||
      precoPromocional >= preco)
  )
    return { ok: false };
  if (promocaoAtiva && precoPromocional === null) return { ok: false };
  for (const dt of [promocaoInicio, promocaoFim])
    if (dt !== null && (typeof dt !== "string" || !Number.isFinite(Date.parse(dt))))
      return { ok: false };
  if (promocaoInicio && promocaoFim && Date.parse(promocaoFim) <= Date.parse(promocaoInicio))
    return { ok: false };

  for (const campo of ["disponivel", "ativo", "destaque"]) {
    if (payload[campo] !== undefined && typeof payload[campo] !== "boolean") return { ok: false };
  }

  return {
    ok: true,
    produto: {
      nome,
      categoria,
      descricao,
      preco_centavos: preco,
      disponivel: payload.disponivel ?? true,
      ativo: payload.ativo ?? true,
      destaque: payload.destaque ?? false,
      emoji,
      estoque,
      promocao_ativa: promocaoAtiva,
      preco_promocional_centavos: precoPromocional,
      promocao_inicio: promocaoInicio,
      promocao_fim: promocaoFim
    }
  };
}
