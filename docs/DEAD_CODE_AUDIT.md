# RELATÓRIO FORENSE DE CÓDIGO MORTO E OBSOLETO
**Fase:** Dead Code Audit — Etapa 0 (Inventário Forense)  
**Data:** 24/09/2026  
**Regra Aplicada:** Nenhuma linha de código, arquivo ou dependência foi alterada, movida ou excluída. Inspeção puramente estática.

---

## 1. MAPA DE ENTRYPOINTS DO REPOSITÓRIO

Os entrypoints reais que formam a raiz do grafo de execução:

### A. Frontend (SPA React / Vite)
- **HTML Raiz:** `index.html` (carrega `/src/main.tsx`).
- **Bootstrap React:** `src/main.tsx` (monta `#root` e renderiza `<App />`).
- **Roteamento Central:** `src/App.tsx`:
  - **Storefront (10 rotas):**
    - `/` (`Homepage`)
    - `/cardapio` (`Cardapio`)
    - `/checkout` (`Checkout`)
    - `/aguardando-pagamento` (`AguardandoPagamento`)
    - `/pedido-confirmado` (`PedidoConfirmado`)
    - `/pagamento-nao-aprovado` (`PagamentoNaoAprovado`)
    - `/pedido/:token` (`AcompanharPedido`)
    - `/dev/preparando-pedido` (`PreparandoPedido`)
    - `/dev/gerando-pagamento` (`GerandoPagamento`)
    - `/dev/processando-pagamento` (`ProcessandoPagamento`)
  - **Admin (8 rotas sob `AdminLayout`):**
    - `/admin/login` (`AdminLogin`)
    - `/admin` (`AdminDashboard`)
    - `/admin/produtos` (`AdminProdutos`)
    - `/admin/pedidos` (`AdminPedidos`)
    - `/admin/administradores` (`AdminAdministradores`)
    - `/admin/loja` (`AdminLoja`)
    - `/admin/despesas` (`AdminDespesas`)
    - `/admin/notificacoes` (`AdminNotificacoes`)
- **Service Worker / PWA:** `public/sw-admin.js`, `public/admin-manifest.webmanifest`, `public/admin-offline.html` (registrados via `src/admin/pwa/useAdminPwa.ts`).

### B. Backend (Cloudflare Pages Functions)
- **Middleware:** `functions/api/admin/_middleware.ts` (interceptor global de autenticação do painel admin).
- **Rotas de API HTTP:** 46 endpoints físicos em `functions/api/**` (mapeados na Seção 8).
- **Webhook Externo:** `functions/api/webhooks/mercadopago.ts` (consumido diretamente pelos servidores do Mercado Pago via HMAC SHA-256).

### C. Infraestrutura, Build e Dados
- **Bundler:** `vite.config.ts`, `tsconfig.json`.
- **Configuração Cloudflare:** `wrangler.toml`, `public/_headers`, `public/_redirects`.
- **Scripts de Ciclo de Vida:** `package.json` (`dev`, `build`, `test`, `test:cached`, `preview`, `pages:dev`, `db:migrate:local`, `db:seed:local`).
- **Banco de Dados (D1 Migrations):** 30 migrações ativas (`migrations/0001_*.sql` até `migrations/0030_*.sql`).
- **Carga Inicial:** `seed/products.sql`.

### D. Testes Automatizados
- **Test Runners:** `scripts/run-tests.mjs` (runner direto) e `scripts/run-tests-cached.mjs` (runner determinístico com hash de dependências).
- **Suítes de Teste:** 47 arquivos `tests/*.test.mjs`.
- **Helpers e Fixtures:** `tests/helpers/b3.mjs`, `tests/helpers/b5.mjs`, `tests/fixtures/producao-simulada.sql`.

---

## 2. ARQUIVOS CANDIDATOS A MORTOS

Auditoria cruzada em `src/`, `functions/lib/`, `shared/`, `scripts/`:

| Arquivo | Tipo | Consumidores Encontrados | Motivo da Suspeita | Confiança |
| :--- | :---: | :---: | :--- | :---: |
| `src/services/.gitkeep` | Scaffold | 0 | Diretório vazio reservado para scaffolding futuro | **ALTA** |
| `src/utils/.gitkeep` | Scaffold | 0 | Diretório vazio reservado para scaffolding futuro | **ALTA** |
| `.claude/launch.json` | Config Local | 0 | Arquivo de editor/IA versionado indevidamente no Git | **ALTA** *(Higiene)* |

*Nota sobre código fonte TS/TSX:* **Nenhum arquivo `.ts` ou `.tsx` em `src/`, `functions/lib/` ou `shared/` é 100% órfão.** Todos os 53 módulos sob `functions/lib/`, os 4 arquivos em `shared/` e os 72 módulos em `src/` possuem pelo menos 1 importador real.

---

## 3. EXPORTS PÚBLICOS CANDIDATOS A NÃO UTILIZADOS

Pesquisa exaustiva de símbolos exportados sem nenhum consumidor (nem no código de produção, nem nas suítes de teste):

| Arquivo de Origem | Export | Re-exportado em | Consumidores Totais | Classificação | Confiança |
| :--- | :--- | :--- | :---: | :---: | :---: |
| `functions/lib/ledger/legacy.ts:210` | `getVirtualOrRealPayment` | `functions/lib/comandaLedger.ts:35` | **0** | **D** (Sem consumidor) | **ALTA** |
| `functions/lib/ledger/projection.ts:27` | `computeFinancialStatus` | `functions/lib/comandaLedger.ts:56` | **0** | **D** (Sem consumidor) | **ALTA** |

### Evidência Concreta:
1. `getVirtualOrRealPayment`:
   - Criada durante o Target 1 como utilitário para inspecionar se um pagamento era legado ou real.
   - Nenhuma rota em `functions/api/`, nenhum outro helper e nenhum dos 47 testes chamam `getVirtualOrRealPayment`.
   - O detalhe do pedido (`pedidos/[id].ts`) usa `getFinanceiroPedido` e `pedido_pagamentos` diretamente.
2. `computeFinancialStatus`:
   - Função pura `(totalCentavos, pagoCentavos) => StatusFinanceiroAgregado`.
   - Não é chamada nem dentro de `projection.ts` (que usa SQL `STATUS_FINANCEIRO_SQL` ou comparações locais).
   - Zero ocorrências em todo o repositório além de sua própria linha e do re-export na fachada `comandaLedger.ts`.

---

## 4. FUNÇÕES, CONSTANTES E TIPOS PRIVADOS CANDIDATOS

1. **Imports e Constantes Locais em Módulos Backend:**
   - Em `functions/lib/operacoes.ts`:
     - `export type ConflitoOperacao = ...` (usado internamente e exportado para `itemCancellation.ts` e `itemExchange.ts`).
     - Todas as constantes e types são consumidos ou exportados.
2. **Types de Frontend:**
   - Verificado via `tsc --noEmit` com flags ativas no `tsconfig.json`:
     - `"noUnusedLocals": true`
     - `"noUnusedParameters": true`
   - O compilador valida `src/` estritamente: **não existem variáveis locais, parâmetros ou imports não utilizados no frontend.**
3. **Branches Históricas de Migração Intermediária (Cutover):**
   - `functions/lib/operacoes.ts:162-178`:
     Bloco `catch` que captura `no such column: pedido_item_troca_id` para tolerar bancos D1 locais entre as migrações 0018 e 0019. Como a migração 0019 já está consolidada no banco, esse fallback é inerte em ambientes atualizados, mas ainda protege contra inconsistências em runners antigos. *(Confiança: BAIXA / Manter por segurança transitória).*

---

## 5. COMPONENTES E HOOKS DO FRONTEND

Todos os componentes em `src/` foram mapeados:

1. **Telas de Loading/Dev:**
   - `src/pages/PreparandoPedido.tsx`
   - `src/pages/GerandoPagamento.tsx`
   - `src/pages/ProcessandoPagamento.tsx`
   - *Status:* **ATIVOS CONFIRMADOS**. Além de expostos nas rotas `/dev/*` em `App.tsx` para inspeção visual, são montados dinamicamente em `src/pages/AguardandoPagamento.tsx:291-293` durante as etapas de carregamento do checkout do cliente.
2. **Modais Administrativos:**
   - Todos os 12 modais (`AdicionarItemModal`, `CancelamentoItemPreviewModal`, `EditarPedidoModal`, `ExcluirPedidoModal`, `HistoricoComandaModal`, `NovoPedidoModal`, `PedidoDetalheModal`, `TrocarItemModal`, `AlterarSenhaModal`, `NovoAdminModal`, `GastoModal`, `CategoriasModal`) são ativamente importados pelas telas principais ou pelo `PedidoDetalheModal`.
3. **Barrels `index.ts` em `src/admin/*`:**
   - Existem 7 arquivos `index.ts` reexportando as páginas (`Administradores`, `Dashboard`, `Despesas`, `Login`, `Loja`, `Pedidos`, `Produtos`). Todos são consumidos por `src/App.tsx`.

---

## 6. AUDITORIA DE CSS

- **Total de arquivos CSS rastreados:** 38 arquivos.
- **Arquivos CSS sem importador:** **0** (todos os 38 são importados via `import "./Nome.css"` em seus respectivos componentes ou em `src/main.tsx` / `src/App.tsx`).
- **Classes CSS Não Encontradas em Match Textual Estático:**
  - `src/admin/theme/admin-dark-theme.css`: Classes que usam seletores descendentes baseados em atributos (`[data-theme="dark"] .ped-table`, `.card-stat`). Estão ativas em runtime quando o tema escuro é alternado via `AdminThemeContext`.
  - `src/components/PageTransition.css`: Animações de transição (`.page-transition-enter`, `.page-transition-exit`) injetadas dinamicamente pelo wrapper de animação.
  - *Classificação:* **INCERTAS / PRESERVAR**. Nenhuma classe foi confirmada como morta com segurança.

---

## 7. AUDITORIA DO BACKEND (`functions/lib/`)

1. **Helpers Duplicados Identificados (Oportunidade de Unificação, Não Dead Code):**
   - Formatação de Moeda BRL em centavos:
     - `src/lib/brl.ts:formatCentsAsBrlInput`
     - `src/admin/Despesas/formatarDespesas.ts:formatarPreco`
     - `src/admin/Pedidos/formatarFinanceiro.ts:formatarPreco` (duplicação privada)
     - `src/admin/Dashboard/AdminDashboard.tsx:formatarPrecoComSinal` (duplicação privada local)
   - Formatação de Margem:
     - `src/admin/Despesas/formatarDespesas.ts:formatarMargem`
     - `src/admin/Dashboard/AdminDashboard.tsx:formatarMargem` (duplicação privada local)
2. **Fachadas Recém-Criadas:**
   - `functions/lib/comandaLedger.ts` (84 linhas): Fachada pública retrô.
   - `functions/lib/comandaPix.ts` (34 linhas): Fachada pública de Pix.
   - `functions/lib/paymentSync.ts` (43 linhas): Fachada pública pura.
   - *Status:* **NECESSÁRIAS E ATIVAS**. Preservam estabilidade de contratos entre rotas e suítes de teste.

---

## 8. INVENTÁRIO COMPLETO DE ROTAS DE API (`functions/api/**`)

Todas as 46 rotas físicas auditadas contra frontend e testes:

| Rota / Arquivo | Métodos | Frontend | Testes | Classificação |
| :--- | :---: | :---: | :---: | :--- |
| `functions/api/admin/_middleware.ts` | ALL | Indireto | Sim | **ATIVA CONFIRMADA** (Pages Middleware) |
| `functions/api/admin/administradores.ts` | GET, POST | Sim | Não | **ATIVA CONFIRMADA** (AdminAdministradores) |
| `functions/api/admin/administradores/[id].ts` | PUT, DELETE | Sim | Não | **ATIVA CONFIRMADA** (AdminAdministradores) |
| `functions/api/admin/categorias.ts` | GET, POST, DELETE | Sim | Sim | **ATIVA CONFIRMADA** (CategoriasModal) |
| `functions/api/admin/dashboard.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (AdminDashboard) |
| `functions/api/admin/despesas.ts` | GET, POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminDespesas / GastoModal) |
| `functions/api/admin/despesas/[id].ts` | DELETE | Sim | Sim | **ATIVA CONFIRMADA** (AdminDespesas) |
| `functions/api/admin/despesas/[id]/cancelar.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminDespesas) |
| `functions/api/admin/diagnosticos/pedido-teste.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminLoja diagnóstico) |
| `functions/api/admin/diagnosticos/pix-reembolso.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminLoja diagnóstico) |
| `functions/api/admin/diagnosticos/pix-status.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminLoja diagnóstico) |
| `functions/api/admin/diagnosticos/pix.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminLoja diagnóstico) |
| `functions/api/admin/notificacoes.ts` | GET, POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminNotificacoes) |
| `functions/api/admin/pedidos.ts` | GET, POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminPedidos / NovoPedidoModal) |
| `functions/api/admin/pedidos/[id].ts` | GET, PATCH, DELETE | Sim | Sim | **ATIVA CONFIRMADA** (PedidoDetalheModal) |
| `functions/api/admin/pedidos/[id]/anulacao.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (ExcluirPedidoModal) |
| `functions/api/admin/pedidos/[id]/anulacao/estorno.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (ExcluirPedidoModal) |
| `functions/api/admin/pedidos/[id]/cancelamentos/[cancelamentoId]/reembolsos.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (CancelamentoItemPreviewModal) |
| `functions/api/admin/pedidos/[id]/historico.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (HistoricoComandaModal) |
| `functions/api/admin/pedidos/[id]/itens.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (AdicionarItemModal) |
| `functions/api/admin/pedidos/[id]/itens/[itemId]/cancelamento-preview.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (CancelamentoItemPreviewModal) |
| `functions/api/admin/pedidos/[id]/itens/[itemId]/cancelamentos.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (CancelamentoItemPreviewModal) |
| `functions/api/admin/pedidos/[id]/itens/[itemId]/troca-preview.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (TrocarItemModal) |
| `functions/api/admin/pedidos/[id]/itens/[itemId]/trocas.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (TrocarItemModal) |
| `functions/api/admin/pedidos/[id]/pagamentos.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (PedidoPagamento) |
| `functions/api/admin/pedidos/[id]/pix.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (PedidoPagamento / gerar Pix) |
| `functions/api/admin/pedidos/[id]/reembolsos.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (PedidoPagamento / estorno manual) |
| `functions/api/admin/pedidos/[id]/trocas/[trocaId]/reembolsos.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (TrocarItemModal) |
| `functions/api/admin/produtos.ts` | GET, POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminProdutos / NovoProdutoModal) |
| `functions/api/admin/produtos/[id].ts` | PUT, DELETE | Sim | Sim | **ATIVA CONFIRMADA** (AdminProdutos / NovoProdutoModal) |
| `functions/api/admin/produtos/[id]/imagem.ts` | POST | Sim | Não | **ATIVA CONFIRMADA** (Upload de fotos) |
| `functions/api/admin/push/retry.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (AdminNotificacoes) |
| `functions/api/admin/push/subscribe.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (PushNotificationCard / PWA) |
| `functions/api/admin/push/test.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (PushNotificationCard) |
| `functions/api/admin/push/unsubscribe.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (PushNotificationCard) |
| `functions/api/admin/push/vapid-key.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (useAdminPwa) |
| `functions/api/auth/login.ts` | POST | Sim | Não | **ATIVA CONFIRMADA** (AdminLogin) |
| `functions/api/auth/logout.ts` | POST | Sim | Não | **ATIVA CONFIRMADA** (AdminSidebar / BottomNav) |
| `functions/api/auth/me.ts` | GET | Sim | Não | **ATIVA CONFIRMADA** (AdminAuthContext) |
| `functions/api/checkout.ts` | POST | Sim | Sim | **ATIVA CONFIRMADA** (Checkout do cliente) |
| `functions/api/config.ts` | GET, PUT | Sim | Sim | **ATIVA CONFIRMADA** (Storefront / AdminLoja) |
| `functions/api/images/[key].ts` | GET, PUT | Sim | Não | **ATIVA CONFIRMADA** (Imagens de produtos D1/R2) |
| `functions/api/pedido-status.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (Polling rápido de status) |
| `functions/api/pedido.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (AcompanharPedido) |
| `functions/api/produtos.ts` | GET | Sim | Sim | **ATIVA CONFIRMADA** (Cardapio catálogo) |
| `functions/api/webhooks/mercadopago.ts` | POST | Webhook | Sim | **ATIVA CONFIRMADA** (Webhook externo MP) |

*Conclusão da auditoria de rotas:* **Zero rotas mortas ou legadas.** 100% das 46 rotas possuem integração ativa no frontend ou são webhooks/endpoints de infraestrutura testados.

---

## 9. AUDITORIA DE TESTES E FIXTURES

- **Suítes encontradas em `tests/`:** 47 arquivos `.test.mjs`.
- **Suítes executadas pelo runner:** Exatamente 47 arquivos (100% de cobertura).
- **Suítes órfãs ou ignoradas:** **Zero**.
- **Helpers:**
  - `tests/helpers/b3.mjs`: Consumido por `b3.test.mjs`, `b3-recuperacao.test.mjs`, `b4.test.mjs`, etc.
  - `tests/helpers/b5.mjs`: Consumido por `b5-cutover.test.mjs`.
- **Fixtures:**
  - `tests/fixtures/producao-simulada.sql`: Consumida por `tests/helpers/b5.mjs` para simular banco legado.

---

## 10. AUDITORIA DE SCRIPTS

Inventário dos arquivos em `scripts/` e comandos em `package.json`:

| Script Físico | Invocador / Uso | Finalidade | Classificação |
| :--- | :--- | :--- | :---: |
| `scripts/run-tests.mjs` | `package.json` (`npm test`) | Runner sequencial de testes | **ATIVO** |
| `scripts/run-tests-cached.mjs` | `package.json` (`npm run test:cached`) | Runner com cache de hash sha256 | **ATIVO** |
| `scripts/b5-production-compat.sql` | `tests/helpers/b5.mjs` | Script de compatibilidade legado B5 | **ATIVO / FIXTURE** |
| `scripts/b5-production-validate.sql` | Operação manual (README/Docs) | Script SQL de validação pós-migração | **MANUAL** |
| `scripts/0014-production-compat.sql` | Operação manual histórica | Script SQL de migração pontual de 0014 | **MANUAL / HISTÓRICO** |
| `scripts/0014-production-validate.sql`| Operação manual histórica | Script SQL de validação de 0014 | **MANUAL / HISTÓRICO** |

---

## 11. AUDITORIA DE DEPENDÊNCIAS NPM (`package.json`)

| Pacote | Tipo | Onde é Utilizado | Classificação |
| :--- | :---: | :--- | :---: |
| `@mmmike/web-push` | dep | `functions/lib/pushNotifier.ts` (envio de notificações VAPID) | **USADA** |
| `react` | dep | Todo o frontend sob `src/` | **USADA** |
| `react-dom` | dep | `src/main.tsx` e Portals em modais | **USADA** |
| `react-router-dom` | dep | `src/App.tsx`, navegação e hooks de rota | **USADA** |
| `@cloudflare/workers-types`| dev | `/// <reference types="..." />` em functions | **TOOLING** |
| `@types/react` | dev | Tipagem TypeScript para React | **TOOLING** |
| `@types/react-dom` | dev | Tipagem TypeScript para React DOM | **TOOLING** |
| `@vitejs/plugin-react` | dev | `vite.config.ts` | **TOOLING** |
| `jsdom` | dev | 9 suítes de teste de interface (`human-findings-ui`, `b2-ui`, etc.) | **USADA (TESTES)** |
| `typescript` | dev | Compilador `tsc` (`npm run build`) | **TOOLING** |
| `vite` | dev | Bundler / Servidor dev | **TOOLING** |
| `wrangler` | dev | CLI Cloudflare Pages / D1 migrations | **TOOLING** |

*Conclusão de dependências:* **100% das dependências e devDependencies são ativamente usadas.** Nenhuma dependência órfã encontrada.

---

## 12. AUDITORIA DE ASSETS

### A. Em `src/assets/` (Total: 3 imagens — **100% ÓRFÃS**)
- `src/assets/cake-cart-image.png` (27.997 bytes)
- `src/assets/happy-bolo-image.png` (15.938 bytes)
- `src/assets/sad-bolo-image.png` (12.367 bytes)
- **Evidência:** Nenhum arquivo `.tsx`, `.ts`, `.html` ou `.css` importa ou faz referência a esses arquivos.

### B. Em `public/images/` (Total: 12 imagens — **5 ÓRFÃS CONFIRMADAS**)
- `public/images/hero-cake.png`: Usado em `src/pages/Homepage.tsx:303`.
- `public/images/story-image.png`: Usado em `src/pages/Homepage.tsx:323`.
- `public/images/produto-*.png` (5 imagens de produtos): Usados em `seed/products.sql` como imagem padrão do catálogo.
- `public/images/insta-1.png` (393.968 bytes): **ZERO referências**.
- `public/images/insta-2.png` (371.778 bytes): **ZERO referências**.
- `public/images/insta-3.png` (401.848 bytes): **ZERO referências**.
- `public/images/insta-4.png` (354.705 bytes): **ZERO referências**.
- `public/images/insta-5.png` (114.168 bytes): **ZERO referências**.
- **Evidência:** Mais de **1,63 MB** em imagens de placeholder do Instagram que não aparecem em nenhuma página, CSS ou seed do projeto.

### C. Em `public/icons/` (Total: 8 ícones — **TODOS ATIVOS**)
- `admin-icon-*.png`, `admin-badge-*.png`, `apple-touch-icon.png`: Todos referenciados formalmente em `public/admin-manifest.webmanifest` ou `src/admin/pwa/useAdminPwa.ts`.

---

## 13. ENCAMINHAR PARA HIGIENE DO REPOSITÓRIO

Itens que **NÃO são dead code de aplicação**, mas devem ser tratados na fase de higiene:

1. **Arquivo de Editor Tracked no Git:**
   - `.claude/launch.json` — Deve ser removido do tracking do Git (`git rm --cached`) e adicionado ao `.gitignore`.
2. **Diretórios de Caches / Artefatos Locais Não Rastreados:**
   - `.test-cache/` (cache de teste, já ignorado).
   - `test-logs/` (logs de execução de teste, já ignorado por `*.log`).
   - `graphify-out/` (saída de grafo, já ignorado por `graphify*`).
   - `.qoder/` (já ignorado).
   - `.dev.vars` (segredos locais do Cloudflare, já ignorado).
   - `.wrangler/` (já ignorado).
   - `dist/` (já ignorado).
3. **Pastas Vazias de Scaffold:**
   - `src/services/.gitkeep`
   - `src/utils/.gitkeep`

---

## 14. CLASSIFICAÇÃO FINAL (GRUPOS A / B / C / D)

### GRUPO A: DEAD CODE — ALTA CONFIANÇA (Candidatos Claros para Remoção)
1. **Assets sem uso em `src/assets/` (3 arquivos):**
   - `src/assets/cake-cart-image.png`
   - `src/assets/happy-bolo-image.png`
   - `src/assets/sad-bolo-image.png`
2. **Assets sem uso em `public/images/` (5 arquivos ~1.63 MB):**
   - `public/images/insta-1.png`
   - `public/images/insta-2.png`
   - `public/images/insta-3.png`
   - `public/images/insta-4.png`
   - `public/images/insta-5.png`
3. **Exports públicos sem nenhum consumidor no repositório (2 funções):**
   - `getVirtualOrRealPayment` em `functions/lib/ledger/legacy.ts` (e re-export em `functions/lib/comandaLedger.ts`).
   - `computeFinancialStatus` em `functions/lib/ledger/projection.ts` (e re-export em `functions/lib/comandaLedger.ts`).

### GRUPO B: SUSPEITO — PRECISA CONFIRMAÇÃO DO PRODUTO / OPERAÇÃO
1. `scripts/0014-production-compat.sql` e `scripts/0014-production-validate.sql` (scripts operacionais de uma migração antiga já consolidada no schema principal).
2. Fallback de cutover para bancos locais antigos sem `pedido_item_troca_id` em `functions/lib/operacoes.ts:162-178`.

### GRUPO C: ATIVO / NECESSÁRIO (Parecia Suspeito, mas o Uso Foi Confirmado)
1. `PreparandoPedido.tsx`, `GerandoPagamento.tsx`, `ProcessandoPagamento.tsx` (são renderizados pelo fluxo principal em `AguardandoPagamento.tsx`).
2. Rotas de diagnóstico `/api/admin/diagnosticos/*` (são chamadas pela tela de administração `AdminLoja.tsx`).
3. `checkoutRateLimit.ts` vs `rateLimit.ts` (um é de checkout por IP/hora, o outro é de login por usuário/tentativas).
4. `jsdom` (essencial para 9 suítes de testes automatizados de componentes).
5. Todas as 46 rotas em `functions/api/**`.
6. Todas as 47 suítes de teste em `tests/*.test.mjs`.

### GRUPO D: HIGIENE DO REPOSITÓRIO (Tratar em Fase Separada)
1. Desindexar `.claude/launch.json` do Git e atualizar `.gitignore`.
2. Avaliar remoção de pastas vazias com `.gitkeep` (`src/services`, `src/utils`).
3. Manutenção dos caches e artefatos ignorados (`.test-cache/`, `test-logs/`, `graphify-out/`).

---

## 15. ORDEM RECOMENDADA DE REMOÇÃO POSTERIOR

Caso o usuário aprove a limpeza, esta é a ordem sequencial mais segura:

1. **Passo 1 (Risco Zero):** Remoção dos 8 assets órfãos (`src/assets/*` e `public/images/insta-*.png`), liberando ~1.7 MB sem tocar em nenhuma linha de código TS/TSX.
2. **Passo 2 (Risco Quase Nulo):** Remoção dos 2 exports mortos (`getVirtualOrRealPayment` e `computeFinancialStatus`) em `legacy.ts`, `projection.ts` e na fachada `comandaLedger.ts`.
3. **Passo 3 (Otimização Opcional):** Unificação dos helpers duplicados de formatação BRL e Margem em `formatarDespesas.ts` / `formatarFinanceiro.ts` / `AdminDashboard.tsx`.
4. **Passo 4 (Higiene Git):** Desindexação do `.claude/launch.json`.
