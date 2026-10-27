# Aceitação de risco de dependências para a v1.0

## Escopo e situação de referência

Aceitação para a v1.0 pelo responsável pelo projeto em 06/10/2026, com base na auditoria de dependências de produção e na inspeção do código-fonte realizadas naquele dia.

- Comando: `npm audit --omit=dev`.
- Resultado: **2 vulnerabilidades moderadas, 0 altas e 0 críticas**.
- As versões instaladas coincidem com o arquivo de trava de dependências: `rp-doces` → `react-router-dom@6.30.6` → `react-router@6.30.6`.
- A auditoria contabiliza dois pacotes afetados; ambos apontam para os dois avisos de segurança do React Router abaixo. A aceitação não cobre avisos futuros nem mudanças de arquitetura.

## Redirecionamento externo: risco aceito para a v1.0

**[GHSA-wrjc-x8rr-h8h6 / CVE-2026-53669](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)** — severidade moderada.

Caminhos de navegação fornecidos por um atacante e contendo barras invertidas podem causar redirecionamentos externos inesperados. A aplicação usa APIs afetadas (`Link` e `useNavigate`), mas não foi identificado nenhum destino totalmente controlado pelo usuário nos fluxos inspecionados.

A navegação usa rotas constantes, caminhos com prefixo fixo `/pedido/` e âncoras constantes da página inicial. A chamada dinâmica `navigate(notificacao.destino)` em `src/admin/notificacoes/AdminNotificacoes.tsx` recebe destinos construídos por `functions/lib/notificacoes.ts`, como `/admin/pedidos?pedido=<id>` e `/admin/produtos`, em vez de URLs fornecidas pelo usuário.

**Decisão: aceitável para a v1.0, com risco documentado.** A dependência vulnerável continua instalada. A inspeção do código não identificou um caminho de entrada explorável; isso não é uma prova universal de que a exploração seja impossível.

Reavalie antes de introduzir `returnTo`, URLs livres ou destinos de navegação fornecidos por usuários ou outras fontes não confiáveis.

## Injeção de construtor na hidratação SSR: atualmente não aplicável

**[GHSA-337j-9hxr-rhxg / CVE-2026-53666](https://github.com/advisories/GHSA-337j-9hxr-rhxg)** — severidade moderada.

A vulnerabilidade depende de dados de erro de SSR/hidratação que permitam à entrada de um atacante selecionar construtores no cliente. O aviso exclui explicitamente aplicações no modo declarativo (Declarative Mode).

O projeto usa `createRoot` em `src/main.tsx` e `BrowserRouter` em `src/App.tsx`. A inspeção do código de produção não encontrou SSR, `hydrateRoot`, `RouterProvider` ou `StaticRouter`.

**Decisão: não aplicável à arquitetura atual.** Reavalie antes de adotar SSR, hidratação, modo de framework (Framework Mode) ou modo de dados (Data Mode) com SSR/hidratação manual.

## Correção e política de publicação

Ambos os avisos são corrigidos a partir do React Router **7.18.0**; a recomendação do npm registrada na auditoria é **7.18.4**. A versão v6 instalada continua afetada, portanto a correção exige uma **atualização de versão principal para o React Router 7**. Essa migração será tratada separadamente após a v1.0, com verificações de regressão em roteamento, checkout, navegação administrativa, redirecionamentos e acompanhamento de pedidos.

Não use `npm audit fix --force` como atalho para a correção. Esta aceitação não autoriza alterações de dependências.

- Vulnerabilidades **altas/críticas** de produção bloqueiam a publicação.
- Vulnerabilidades **moderadas** de produção exigem triagem e, quando aplicável, aceitação explícita e documentada do risco para a versão.
- Refaça a auditoria a cada publicação; esta aceitação datada não substitui a triagem atual.

Veja o [checklist de publicação](../RELEASE-CHECKLIST.md) para os critérios de liberação.
