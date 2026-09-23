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
**Diagnóstico:** É o centro de gravidade financeiro/contábil dos pedidos (cálculo de projeções de saldo, alocações de itens, pagamentos manuais no balcão e estornos administrativos).

**Estrutura pretendida:**
```text
functions/lib/
  comandaLedger.ts               # Fachada que reexporta todos os submódulos para manter compatibilidade
  ledger/
    types.ts                     # Interfaces contábeis, enums e tipos compartilhados
    projection.ts                # Projeções contábeis e consolidação de saldos
    allocations.ts               # Alocação de pagamentos a itens e consumo de reservas
    adminPayments.ts             # Registro e processamento de pagamentos manuais
    adminRefunds.ts              # Regras e lançamentos contábeis de estornos/reembolsos
```

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
**Diagnóstico:** Concentra geração de QRCode/Copia-e-Cola, consulta de status remoto, substituição de cobranças Pix expiradas e lógica de estorno Pix Mercado Pago.

**Estrutura pretendida:**
```text
functions/lib/
  comandaPix.ts                  # Fachada reexportando submódulos
  pix/
    types.ts                     # Tipos e contratos de resposta Pix
    generation.ts                # Criação e regeneração de cobranças Pix Mercado Pago
    statusCheck.ts               # Verificação ativa e resolução de estados remotos
    refunds.ts                   # Execução e validação de devoluções Pix
```

---

## 4. Estado Atual do Repositório (Baseline)

* **Branch:** `main`
* **Último Commit:** `165a216` (`rp-doces: add web push notification test`)
* **Status:** Working tree 100% limpo e sincronizado com `origin/main`.
* **Funcionalidade recente:** PWA V2 Web Push implementado com badge monocromático Android e endpoint de teste (`POST /api/admin/push/test`) com 24/24 testes aprovados.

---

## 5. Como Iniciar a Próxima Sessão

Ao abrir o projeto no Antigravity no computador de casa:
> *"Li o `MODULARIZACAO.md`. Vamos iniciar a execução do Alvo 1 (`comandaLedger.ts`)."*
