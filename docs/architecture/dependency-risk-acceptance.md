<a id="dependency-risk-acceptance-for-v10"></a>

# Aceitação de risco de dependências para a v1.0

<a id="scope-and-baseline"></a>

## Escopo e baseline

Aceita para a v1.0 pelo proprietário do projeto em 2026-10-06, com base na auditoria de dependências de produção e na inspeção do código-fonte realizadas naquele dia.

- Comando: `npm audit --omit=dev`.
- Resultado: **2 vulnerabilidades moderadas, 0 altas e 0 críticas**.
- As versões instaladas correspondem ao lockfile: `rp-doces` → `react-router-dom@6.30.6` → `react-router@6.30.6`.
- A auditoria conta dois pacotes afetados; ambos apontam para os dois avisos de segurança do React Router abaixo. A aceitação não abrange avisos futuros nem mudanças de arquitetura.

<a id="external-redirect-accepted-risk-for-v10"></a>

## Redirect externo: risco aceito para a v1.0

**[GHSA-wrjc-x8rr-h8h6 / CVE-2026-53669](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)** — severidade moderada.

Caminhos de navegação fornecidos por um atacante e contendo barras invertidas podem provocar redirects externos inesperados. A aplicação usa APIs afetadas (`Link` e `useNavigate`), mas não foi identificado destino totalmente controlado por um usuário nos fluxos inspecionados.

A navegação usa rotas constantes, caminhos com prefixo fixo `/pedido/` e hashes constantes da Home. O `navigate(notificacao.destino)` dinâmico em `src/admin/notificacoes/AdminNotificacoes.tsx` recebe destinos construídos por `functions/lib/notificacoes.ts`, como `/admin/pedidos?pedido=<id>` e `/admin/produtos`, em vez de URLs fornecidas por usuários.

**Decisão: aceitável para a v1.0 com risco documentado.** A dependência vulnerável continua instalada. A inspeção do código não identificou um caminho de entrada explorável; isso não é uma prova universal de impossibilidade de exploração.

Reavalie antes de introduzir `returnTo`, URLs livres ou destinos de navegação fornecidos por usuários ou outras fontes não confiáveis.

<a id="ssr-hydration-constructor-injection-currently-not-applicable"></a>

## Injeção de construtor na hidratação SSR: atualmente não aplicável

**[GHSA-337j-9hxr-rhxg / CVE-2026-53666](https://github.com/advisories/GHSA-337j-9hxr-rhxg)** — severidade moderada.

A vulnerabilidade depende de dados de erro de SSR/hidratação que permitam a entrada de um atacante selecionar construtores no cliente. O aviso de segurança exclui explicitamente aplicações em Declarative Mode.

O projeto usa `createRoot` em `src/main.tsx` e `BrowserRouter` em `src/App.tsx`. A inspeção do código de produção não encontrou SSR, `hydrateRoot`, `RouterProvider` nem `StaticRouter`.

**Decisão: não aplicável à arquitetura atual.** Reavalie antes de adotar SSR, hidratação, Framework Mode ou Data Mode com SSR/hidratação manual.

<a id="remediation-and-release-policy"></a>

## Política de correção e release

Os dois avisos estão corrigidos a partir do React Router **7.18.0**; a recomendação auditada do npm é **7.18.4**. A versão v6 instalada continua afetada, portanto a correção exige uma **atualização de versão major para React Router 7**. Essa migração será tratada separadamente após a v1.0, com verificações de regressão de rotas, checkout, navegação administrativa, redirects e acompanhamento de pedidos.

Não use `npm audit fix --force` como atalho de correção. Esta aceitação não autoriza alterações de dependências.

- Vulnerabilidades **altas/críticas** em produção bloqueiam a release.
- Vulnerabilidades **moderadas** em produção exigem análise e, quando aplicável, aceitação de risco explícita e documentada para a release.
- Repita a auditoria a cada release; esta aceitação datada não substitui a análise atual.

Consulte o [checklist de release](../RELEASE-CHECKLIST.md) para os critérios de publicação.
