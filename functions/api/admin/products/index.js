import { json, bodyJson, sameOrigin } from "../../../lib/http.js";
import { requireUser } from "../../../lib/auth.js";
import { validarProduto } from "../../../lib/productValidation.js";

async function categoryExists(env, id) {
  return Boolean(
    await env.DB.prepare("SELECT id FROM categorias WHERE id = ? AND ativo = 1").bind(id).first()
  );
}

export async function onRequestGet({ request, env }) {
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const { results } = await env.DB.prepare(
    `
    SELECT p.id, p.nome, p.categoria, p.descricao, p.preco_centavos, p.disponivel, p.ativo,
           p.destaque, p.ordem, p.emoji, p.estoque, p.estoque_reservado, p.promocao_ativa,
           p.preco_promocional_centavos, p.promocao_inicio, p.promocao_fim, p.image_key,
           p.criado_em, p.atualizado_em, c.nome AS categoria_nome, c.emoji AS categoria_emoji,
           c.ordem AS categoria_ordem
    FROM produtos p
    LEFT JOIN categorias c ON c.id = p.categoria
    ORDER BY COALESCE(c.ordem, 9999), p.ordem, p.nome
  `
  ).all();
  return json({ produtos: results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ erro: "Origem inválida." }, 403);
  const auth = await requireUser(env, request);
  if (auth.error) return auth.error;
  const payload = await bodyJson(request);
  const validacao = validarProduto(payload);
  if (!validacao.ok) return json({ erro: "Dados do produto inválidos." }, 400);
  const p = validacao.produto;

  if (!(await categoryExists(env, p.categoria))) {
    return json({ erro: "Categoria inexistente ou inativa." }, 400);
  }

  const ordemRow = await env.DB.prepare(
    "SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM produtos WHERE categoria = ?"
  )
    .bind(p.categoria)
    .first();
  const ordem = Number(ordemRow?.proxima ?? 0);
  const result = await env.DB.prepare(
    `
    INSERT INTO produtos (nome, categoria, descricao, preco_centavos, disponivel, ativo, destaque, ordem, emoji, estoque, promocao_ativa, preco_promocional_centavos, promocao_inicio, promocao_fim)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  )
    .bind(
      p.nome,
      p.categoria,
      p.descricao,
      p.preco_centavos,
      p.disponivel ? 1 : 0,
      p.ativo ? 1 : 0,
      p.destaque ? 1 : 0,
      ordem,
      p.emoji,
      p.estoque,
      p.promocao_ativa ? 1 : 0,
      p.preco_promocional_centavos,
      p.promocao_inicio,
      p.promocao_fim
    )
    .run();

  return json({ ok: true, id: result.meta?.last_row_id }, 201);
}
