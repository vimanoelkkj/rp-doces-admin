const CATEGORIAS = new Set(["BOLO_NO_POTE", "MINI_PUDIM"]);
const CAMPOS_PERMITIDOS = new Set([
  "nome", "categoria", "descricao", "preco_centavos",
  "disponivel", "ativo", "destaque", "emoji"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function validarProduto(payload) {
  if (!isPlainObject(payload)) return { ok: false };

  const campos = Object.keys(payload);
  if (campos.some(campo => !CAMPOS_PERMITIDOS.has(campo))) return { ok: false };

  const obrigatorios = ["nome", "categoria", "preco_centavos"];
  if (obrigatorios.some(campo => !Object.prototype.hasOwnProperty.call(payload, campo))) return { ok: false };

  if (typeof payload.nome !== "string" || typeof payload.categoria !== "string") return { ok: false };
  if (payload.descricao !== undefined && typeof payload.descricao !== "string") return { ok: false };
  if (payload.emoji !== undefined && typeof payload.emoji !== "string") return { ok: false };

  const nome = payload.nome.trim();
  const categoria = payload.categoria;
  const descricao = (payload.descricao ?? "").trim();
  const emoji = (payload.emoji ?? "").trim();
  const preco = payload.preco_centavos;

  if (nome.length < 1 || nome.length > 100) return { ok: false };
  if (!CATEGORIAS.has(categoria)) return { ok: false };
  if (descricao.length > 500) return { ok: false };
  if ([...emoji].length > 16) return { ok: false };
  if (typeof preco !== "number" || !Number.isSafeInteger(preco) || preco < 1 || preco > 10_000_000) return { ok: false };

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
    }
  };
}
