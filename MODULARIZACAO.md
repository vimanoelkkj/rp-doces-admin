# Plano Estratégico de Modularização — R&P Doces

Este documento orienta a refatoração e modularização dos centros de densidade da base de código do projeto R&P Doces. Qualquer sessão do Antigravity ou desenvolvedor que retomar o projeto deve seguir rigorosamente as diretrizes aqui documentadas.

---

## 1. Princípios e Regras de Ouro

1. **Modularizar por responsabilidade, NUNCA por tamanho de arquivo:**
   * O objetivo não é bater metas arbitrárias de "menos de 200 linhas", mas separar domínios claros e coesos.
   * Não desintegrar código em dezenas de micro-arquivos sem sentido (ex.: no React, nada de criar `PedidoHeader.tsx`, `PedidoTitle.tsx`, `PedidoButton.tsx`, `PedidoSection.tsx`). Cada subcomponente deve representar uma parte real e coesa da tela.

2. **Invariância de Contrato e Retrocompatibilidade:**
   * Módulos refatorados na camada `functions/lib/` devem manter o arquivo raiz como fachada/barrel (ex.: `comandaLedger.ts` reexportando os submódulos), de modo que nenhum endpoint ou helper de teste precise alterar seus caminhos de importação.
   * Não alterar regras de negócio, cálculos contábeis, triggers do banco de dados, chaves compostas ou garantias de idempotência.

3. **Passos Curtos e Seguros (Um monólito por vez):**
   * Refatorar um único centro de gravidade de cada vez.
   * Ao final de cada etapa, rodar validações completas:
     * `npx tsc --noEmit`
     * `node --test tests/admin-push-v2.test.mjs`
     * `node scripts/run-tests.mjs` (apenas quando solicitado/permitido) ou testes direcionados do módulo
     * `npm run build`
     * `git diff --check`

4. **Fase 0 Obrigatória — Mapeamento Sem Edições:**
   * Antes de tocar em qualquer código de um alvo, realizar um mapeamento estrito: dependências, exports públicos, consumidores externos, potenciais ciclos e o agrupamento natural das funções existentes.
   * A árvore definitiva só é aprovada e fatiada após essa inspeção e validação explícita. Não transformar hipóteses de estrutura em profecias autocumpridas.

---

## 2. Ordem de Ataque

1. **`functions/lib/comandaLedger.ts`** (1.247 linhas — backend contábil)
2. **`src/admin/Pedidos/PedidoDetalheModal.tsx`** (1.236 linhas — modal/miniapp frontend)
3. **`functions/lib/comandaPix.ts`** (1.069 linhas — gateway e ciclo de vida Pix)
4. **`functions/lib/paymentSync.ts`** (705 linhas — sincronização convergente de pagamentos)
5. **`functions/api/admin/pedidos.ts`** (719 linhas — endpoints administrativos de pedidos)
6. **Revisões posteriores sob demanda:** `AdminLoja.tsx`, `Homepage.tsx`, `NovoProdutoModal.tsx`.

---

## 3. Desenho de Arquitetura por Alvo

### Alvo 1: `functions/lib/comandaLedger.ts` (1.247 linhas)
**Diagnóstico:** É o centro de gravidade financeiro/contábil dos pedidos (cálculo de projeções de saldo, alocações de itens, materialização legada, pagamentos manuais no balcão e estornos administrativos).

**Estrutura pretendida (Hipótese de Trabalho):**
```text
functions/lib/
  comandaLedger.ts               # Fachada que reexporta todos os submódulos para manter compatibilidade
  ledger/
    types.ts                     # Interfaces contábeis, enums e tipos compartilhados
    legacy.ts                    # Compatibilidade e materialização legada (ledgerPaymentStatus, ensureLegacyPaymentMaterialized, resolveLedgerPaymentId, getVirtualOrRealPayment)
    projection.ts                # Projeções contábeis e consolidação de saldos
    allocations.ts               # Alocação de pagamentos a itens e consumo de reservas
    adminPayments.ts             # Registro e processamento de pagamentos manuais
    adminRefunds.ts              # Regras e lançamentos contábeis de estornos/reembolsos
```

> **Nota sobre operações administrativas:** Helpers como `reconcilePersistedAdminFact` e `replayOperacaoLocal` devem ser mantidos junto dos pagamentos/refunds administrativos se forem estritamente auxiliares a eles, evitando criar arquivos extras para poucos helpers a menos que haja necessidade comprovada na Fase 0.

---

### Alvo 2: `src/admin/Pedidos/PedidoDetalheModal.tsx` (1.236 linhas)
**Diagnóstico:** É praticamente um miniapp completo encapsulado em um único componente, misturando gerenciamento de estado de pedidos, efeitos de polling/sincronização, regras de ações e múltiplas seções visuais.

**Estrutura pretendida:**
```text
src/admin/Pedidos/PedidoDetalheModal/
  index.ts                       # Export padrão do modal
  PedidoDetalheModal.tsx         # Orquestrador visual do modal (layout, tabs e estrutura principal)
  usePedidoDetalhe.ts            # Hook isolado com estado, efeitos, mutações e chamadas de API
  PedidoResumo.tsx               # Cartão de resumo (status, cliente, totais e metadados)
  PedidoItens.tsx                # Listagem de itens, status de produção, ações de cancelamento/troca
  PedidoPagamentos.tsx           # Histórico financeiro, Pix status, pagamentos manuais e reembolsos
  PedidoHistorico.tsx            # Linha do tempo de auditoria e eventos operacionais
```

---

### Alvo 3: `functions/lib/comandaPix.ts` (1.069 linhas)
**Diagnóstico:** Concentra consultas de capacidade cobrável, geração/substituição de cobranças Pix administrativas e reprojeção local.

**Estrutura pretendida (Hipótese de Trabalho):**
```text
functions/lib/
  comandaPix.ts                  # Fachada reexportando submódulos
  pix/
    types.ts                     # Tipos e contratos de resposta Pix
    queries.ts                   # Consultas de capacidade cobrável e Pix pendentes (ex: getCapacidadeCobravel, getPixAdminPendentesAtivos)
    replay.ts                    # Reprojeção e reconciliação local (ex: replayPixAdmin)
    adminCharge.ts               # Criação e substituição de cobranças administrativas (ex: createAdminPixCharge)
```

> **Atenção:** A estrutura acima é uma hipótese inicial. Antes de criar cada módulo, confirmar que a responsabilidade existe de fato no arquivo atual. O projeto já possui módulos dedicados como `paymentSync.ts`, `mpRefund.ts` e `mpRefundIntent.ts`; portanto, **não mover lógica pertencente a esses módulos só para preencher a estrutura planejada.** A arquitetura deve emergir das responsabilidades reais, não de uma árvore imaginada previamente.

---

## 4. Fase Posterior: Limpeza e Auditoria de Código Morto (Dead Code Audit)

> **Regra de Ouro:** Primeiro organizamos os armários (modularização), depois descobrimos quais tranqueiras ninguém usa (limpeza). Nunca inverter essa ordem.

### Objetivo
Remover código comprovadamente inalcançável e não utilizado, **sem alterar comportamento**, após a modularização expor com clareza o que era realmente necessário e o que era resíduo enterrado em monólitos de 1.200 linhas.

### Escopo Elegível
* Imports não utilizados.
* Exports órfãos (0 imports externos, 0 chamadas internas, 0 testes, 0 rotas).
* Helpers privados inalcançáveis.
* Tipos e interfaces abandonados.
* Componentes React sem consumidor.
* Classes CSS comprovadamente órfãs.
* Dependências `npm` não utilizadas.
* Assets estáticos comprovadamente não referenciados.
* Compatibilidades antigas que possam ser **PROVADAS** desnecessárias.

### Lista de Proteção Sagrada (NUNCA remover automaticamente por falta de import estático)
Ferramentas de análise estática (Knip, ESLint, tsc) tratam ausência de `import` como código morto, mas no ecossistema deste projeto existem entrypoints implícitos que **JAMAIS** devem ser apagados automaticamente:
1. **Migrations SQL aplicadas (`migrations/*.sql`):** São o histórico executável e imutável do banco D1.
2. **Cloudflare Pages Functions (`functions/api/**`):** A própria convenção de arquivos/pastas define a rota HTTP; elas não possuem imports estáticos externos.
3. **Webhooks (`functions/api/webhooks/**`):** Entrypoints acionados externamente por gateways (Mercado Pago).
4. **Service Workers (`public/sw-admin.js`):** Script executado diretamente pelo navegador em thread separada.
5. **Scripts operacionais e de validação (`scripts/**`):** Executados via CLI (`node scripts/...`).
6. **Assets referenciados dinamicamente ou por string:** Ícones PWA, badges, manifests (`/icons/*`, `/admin-manifest.webmanifest`, `favicon.svg`).
7. **Código chamado dinamicamente ou por reflexão.**
8. **Fallbacks de recuperação e offline:** Páginas estáticas de contingência (`admin-offline.html`).
9. **Código de compatibilidade:** Somente remover após provar documental e tecnicamente que o banco de produção e clientes legados não dependem dele.

### Metodologia de Execução
1. **Lista de Suspeitos, não Sentença de Morte:** O output de ferramentas (Knip, `rg`, `tsc`) gera uma lista para investigação criteriosa, nunca um comando `rm` cego.
2. **Classificação em 3 Níveis:**
   * **Certeza Alta:** Helper privado dentro do arquivo sem nenhuma chamada interna.
   * **Precisa de Investigação:** Export público sem consumidor óbvio (verificar se é contrato de rota, fixture de teste ou chamado dinamicamente).
   * **Preservar:** Entrypoints, contratos públicos e código de proteção.
3. **Remoção em Lotes Pequenos e Categorizados:**
   * Commits cirúrgicos e atômicos (ex.: `cleanup: remove unused frontend components`, `cleanup: remove dead ledger helpers`, `cleanup: remove unused npm dependencies`).
   * **Proibido** apocalipse de 8.000 linhas deletadas de uma vez só.
4. **Validação Obrigatória a Cada Lote:**
   * `npx tsc --noEmit`
   * Testes automatizados direcionados
   * `npm run build`
   * `git diff --check`

---

## 5. Estado Atual do Repositório (Baseline)

* **Branch:** `main`
* **Baseline Funcional:** `165a216` (`rp-doces: add web push notification test`)
* **Commit do Roadmap Original:** `b50bcf6`
* **Refinamento da Fase 0 e Limites:** `a8a9a4d`
* **Status:** Working tree 100% limpo e sincronizado com `origin/main`.
* **Funcionalidade recente:** PWA V2 Web Push implementado com badge monocromático Android e endpoint de teste (`POST /api/admin/push/test`) com 24/24 testes aprovados.

---

## 6. Como Iniciar a Próxima Sessão

Ao abrir o projeto no Antigravity no computador de casa:
> *"Li o `MODULARIZACAO.md`. Vamos iniciar a Fase 0 de mapeamento do Alvo 1 (`comandaLedger.ts`)."*
