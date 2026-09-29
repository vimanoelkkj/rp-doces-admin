import { readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { build } from "esbuild";

// Onda 9C · ETAPA 4 — enumeração automática das rotas administrativas.
//
// Em /api/admin a proteção é POR HANDLER: `_middleware.ts` só define
// Cache-Control, não autentica. Um grep por `requireUser` prova que o texto
// existe num arquivo, não que ele roda antes de qualquer acesso a dados — e
// também não percebe uma rota nova criada sem proteção nenhuma.
//
// Este helper resolve as duas pontas:
//   1. enumera as rotas a partir do SISTEMA DE ARQUIVOS, então um arquivo novo
//      em functions/api/admin entra no contrato sem ninguém lembrar dele;
//   2. devolve um ambiente sem banco, sem R2 e sem rede, em que qualquer toque
//      em dados é registrado e lançado — a prova de que a recusa aconteceu
//      antes do acesso, e não depois de uma falha qualquer.

const RAIZ = "functions/api/admin";
const HANDLERS = {
  onRequestGet: "GET",
  onRequestPost: "POST",
  onRequestPut: "PUT",
  onRequestPatch: "PATCH",
  onRequestDelete: "DELETE",
  onRequestHead: "HEAD",
  onRequestOptions: "OPTIONS"
};
// Um dispatcher explícito (`export const onRequest`) recebe todos os métodos;
// ele pode recusar os que não implementa com 404/405 ANTES da autenticação.
const METODOS_DISPATCHER = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const normalizar = caminho => caminho.split(sep).join("/");

async function arquivosDeRota(dir) {
  const entradas = await readdir(dir, { withFileTypes: true });
  const arquivos = [];
  for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...(await arquivosDeRota(caminho)));
    else if (entrada.name.endsWith(".ts") && !entrada.name.startsWith("_")) arquivos.push(caminho);
  }
  return arquivos;
}

/** `/api/admin/pedidos/[id]` -> URL de teste + params preenchidos. */
export function rotaDe(arquivo) {
  const caminho = normalizar(arquivo)
    .replace(/^functions/, "")
    .replace(/\.ts$/, "");
  const params = {};
  const url = caminho.replace(/\[([^\]]+)\]/g, (_, nome) => {
    params[nome] = "1";
    return "1";
  });
  return { url: `https://local.test${url}`, params };
}

/**
 * Compila e importa TODAS as rotas administrativas reais (produção, sem
 * dublês) e devolve `[{ arquivo, url, params, handlers: [{ nome, method, handler }] }]`.
 */
export async function carregarRotasAdmin() {
  const arquivos = await arquivosDeRota(RAIZ);
  if (!arquivos.length) throw new Error(`nenhuma rota encontrada em ${RAIZ}`);
  const bundle = await build({
    stdin: {
      contents: arquivos
        .map(
          (arquivo, i) => `export * as r${i} from './${normalizar(arquivo).replace(/\.ts$/, "")}'`
        )
        .join("\n"),
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node"
  });
  const source = `${bundle.outputFiles[0].text}\n//# sourceURL=rp-doces-admin-rotas.mjs`;
  const modulos = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );

  return arquivos.map((arquivo, i) => {
    const modulo = modulos[`r${i}`];
    const handlers = Object.entries(HANDLERS)
      .filter(([nome]) => typeof modulo[nome] === "function")
      .map(([nome, method]) => ({ nome, method, handler: modulo[nome] }));
    const dispatcher =
      typeof modulo.onRequest === "function"
        ? METODOS_DISPATCHER.map(method => ({
            nome: `onRequest(${method})`,
            method,
            handler: modulo.onRequest
          }))
        : [];
    return {
      arquivo: normalizar(arquivo),
      ...rotaDe(arquivo),
      handlers: [...handlers, ...dispatcher]
    };
  });
}

/**
 * Ambiente sem dados: `env.DB` e `env.PRODUCT_IMAGES` lançam no primeiro toque
 * e registram o acesso em `toques`. Nenhum secret real — apenas placeholders.
 */
export function ambienteIsolado(toques) {
  const proibido = nome =>
    new Proxy(
      {},
      {
        get(_, propriedade) {
          toques.push(`${nome}.${String(propriedade)}`);
          throw new Error(`${nome} acessado sem sessão válida`);
        }
      }
    );
  return {
    DB: proibido("DB"),
    PRODUCT_IMAGES: proibido("PRODUCT_IMAGES"),
    MP_ACCESS_TOKEN: "fake",
    MP_WEBHOOK_SECRET: "9c-local-only",
    PUSH_VAPID_PUBLIC_KEY: "fake",
    PUSH_VAPID_PRIVATE_KEY: "fake"
  };
}

/** Chama um handler de rota com o contexto mínimo do Pages Functions. */
export function chamarRota(
  handler,
  rota,
  { env, method, origin = null, cookie = null, body = {} }
) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  return handler({
    env,
    params: rota.params,
    waitUntil() {},
    request: new Request(rota.url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body)
    })
  });
}
