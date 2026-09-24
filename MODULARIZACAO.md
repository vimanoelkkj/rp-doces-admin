# Manual de Arquitetura e Engenharia — R&P Doces

Este documento constitui o **manual arquitetural oficial e definitivo** do repositório `rp-doces`. Ele consolida a organização modular dos subsistemas, os contratos de interface pública, as garantias de idempotência e concorrência, os protocolos críticos de reconciliação (A1, B2, B3, B4, R3), a higiene do repositório e os fluxos de dados essenciais da plataforma.

Qualquer desenvolvedor ou agente deve seguir rigorosamente as regras, contratos e invariantes aqui documentados.

---

## 1. Princípios e Regras de Ouro

1. **Modularizar por Domínio e Responsabilidade, NUNCA por Tamanho de Arquivo:**
   - A modularização não visa atingir métricas cosméticas de linhas de código, mas isolar domínios contábeis, regras de negócio e limites de contexto coesos.
   - No React, não desintegrar interfaces em micro-arquivos sem identidade de tela (ex.: `PedidoTitle.tsx`, `PedidoButton.tsx`). Cada submódulo representa uma parte visual e operacional coesa.

2. **Invariância de Contrato e Fachadas Explícitas:**
   - Módulos refatorados sob `functions/lib/` expõem seus contratos públicos através de **fachadas explícitas** (`comandaLedger.ts`, `comandaPix.ts`, `paymentSync.ts`).
   - Nenhum endpoint de rota (`functions/api/**`) ou suíte de teste altera seus caminhos de importação quando a lógica interna de um domínio é reorganizada.
   - Cálculos contábeis, triggers, chaves compostas e garantias de idempotência são estritamente preservados.

3. **Passos Curtos e Seguros (Evolução Incremental):**
   - Refatorações de núcleo são executadas em etapas isoladas, seguidas de validação imediata:
     - `npx tsc --noEmit`
     - `npm run build`
     - `git diff --check`
     - Execução de testes automatizados direcionados ou da suíte completa.

4. **Fase 0 Obrigatória — Mapeamento Analítico Sem Edições:**
   - Antes de modificar o núcleo de um domínio, realiza-se um levantamento estático: dependências, exports públicos, consumidores reais, potenciais ciclos e agrupamentos funcionais.
   - Apenas após validação analítica comprovada é autorizado o corte ou movimentação de código.

5. **Integridade de Código Morto e Lista de Proteção Sagrada:**
   - Primeiro modulariza-se por responsabilidade; apenas após expor com clareza os limites é autorizada a auditoria de código morto.
   - Nunca remover código sem auditoria prévia de consumidores reais e referências dinâmicas.

---

## 2. Histórico da Modularização Concluída (Alvos 1 a 5)

A reorganização modular do núcleo do projeto foi integralmente concluída em cinco grandes alvos prioritários, reduzindo a complexidade de monólitos históricos e estabelecendo subsistemas isolados:

| Alvo | Componente / Arquivo Original | Linhas Originais | Arquitetura Resultante | Linhas da Fachada / Orquestrador | Redução Concentrada |
| :---: | :--- | :---: | :--- | :---: | :---: |
| **Alvo 1** | `functions/lib/comandaLedger.ts` | 1.247 | Subsistema `functions/lib/ledger/` (7 módulos contábeis) | 81 linhas | **-93,5%** |
| **Alvo 2** | `src/admin/Pedidos/PedidoDetalheModal.tsx` | 1.236 | Orquestrador + `src/admin/Pedidos/PedidoDetalhe/` (6 submódulos) | 249 linhas | **-79,9%** |
| **Alvo 3** | `functions/lib/comandaPix.ts` | 1.069 | Subsistema `functions/lib/pix/` (5 módulos de cobrança) | 34 linhas | **-96,8%** |
| **Alvo 4** | `functions/lib/paymentSync.ts` | 705 | Subsistema `functions/lib/paymentSync/` (7 módulos de sincronização) | 43 linhas | **-93,9%** |
| **Alvo 5** | `functions/api/admin/pedidos.ts` | 719 | Rota HTTP + `functions/lib/adminPedidos/` (6 módulos operacionais) | 111 linhas | **-84,6%** |
| **TOTAL** | — | **4.976** | **4 subsistemas backend + 1 subsistema frontend** | **518 linhas** | **-89,6%** |

---

## 3. Visão Geral dos Subsistemas Centrais (`functions/lib/`)

A inteligência de negócio da aplicação reside na pasta `functions/lib/`, estruturada em quatro grandes subsistemas de domínio no backend, complementados pela interface administrativa no frontend:

```text
functions/lib/
├── comandaLedger.ts              # Fachada pública do subsistema contábil
├── ledger/                       # Motor contábil (partidas dobradas, projeção, alocações)
│   ├── types.ts                  # Enums e interfaces contábeis fundamentais
│   ├── allocations.ts            # Algoritmos waterfall de alocação de itens e saldos
│   ├── projection.ts             # Projeção financeira agregada e recálculo
│   ├── adminOps.ts               # Reconciliação e replay de operações administrativas
│   ├── adminPayments.ts          # Registro de pagamentos manuais no balcão
│   ├── adminRefunds.ts           # Registro de estornos e reembolsos manuais
│   └── legacy.ts                 # Compatibilidade e materialização de pedidos legados
│
├── comandaPix.ts                 # Fachada pública do gateway Pix
├── pix/                          # Ciclo de vida de cobranças Pix (Mercado Pago Payments API)
│   ├── types.ts                  # Contratos de entrada e saída de Pix administrativo
│   ├── queries.ts                # Consultas de capacidade cobrável e Pix pendentes
│   ├── adminCharge.ts            # Geração atômica de Pix administrativo
│   ├── adminRegenerate.ts        # Regeneração segura com substituição de pendentes
│   └── replay.ts                 # Replay idempotente de cobranças Pix
│
├── paymentSync.ts                # Fachada pública de sincronização
├── paymentSync/                  # Sincronização convergente com gateways externos
│   ├── types.ts                  # Tipos de mapeamento e respostas de sincronização
│   ├── status.ts                 # Mapeador de estados PSP para status interno
│   ├── client.ts                 # Cliente HTTP resiliente para a API do Mercado Pago
│   ├── webhook.ts                # Validação HMAC SHA-256 e resolução de webhooks
│   ├── ledgerSync.ts             # Transições atômicas e expiração no ledger
│   ├── sweeps.ts                 # Varreduras periódicas de expiração e reservas
│   └── inconclusiveRecovery.ts   # Protocolo B3: recuperação de transações pendentes
│
├── adminPedidos/                 # Orquestração de comandos administrativos de pedidos
│   ├── types.ts                  # Interfaces de ambiente, bindings e contratos
│   ├── list.ts                   # Listagem com paginação e projeção financeira em lote
│   ├── manualValidation.ts       # Validação e sanitização de dados de balcão
│   ├── manualCreation.ts         # Criação transacional atômica com reserva física
│   ├── manualReplay.ts           # Replay de pedidos manuais duplicados
│   └── maintenance.ts            # Ações de manutenção de pedidos
│
└── [Frontend Admin]
    └── src/admin/Pedidos/PedidoDetalhe/
        ├── index.ts              # Reexport limpo
        ├── types.ts              # Tipagem do modal e abas
        ├── helpers.ts            # Utilitários de apresentação financeira
        ├── usePedidoDetalhe.ts   # Hook central de estado, polling e mutações
        ├── PedidoHeader.tsx      # Cabeçalho com identificação e status operacional
        ├── PedidoItens.tsx       # Tabela de itens, cancelamentos e trocas
        └── PedidoPagamento.tsx   # Painel financeiro, geração Pix e reembolsos
```

### Detalhamento dos Quatro Subsistemas Backend:

### 3.1. `ledger/` (Motor Contábil de Comandas)
- **Responsabilidade:** Fonte única da verdade financeira de pedidos. Implementa partidas financeiras com granularidade por item via alocação em cascata (*waterfall*), saldos remanescentes, pagamentos manuais no balcão e estornos parciais ou totais.
- **Fachada Pública:** `functions/lib/comandaLedger.ts`.
- **Principais Módulos Internos:**
  - `types.ts`: Interfaces contábeis, enums (`StatusFinanceiroAgregado`, `OrigemPagamentoLedger`) e tipos de projeção.
  - `allocations.ts`: Algoritmos waterfall para consumir itens abertos, priorizar débitos e abater trocas.
  - `projection.ts`: Recálculo da visão consolidada de saldo e preparação de projeções SQL.
  - `adminOps.ts`: Reconciliação e persistência de fatos administrativos com replay seguro.
  - `adminPayments.ts`: Lançamento e validação de pagamentos em dinheiro, cartão físico ou outros meios de balcão.
  - `adminRefunds.ts`: Lançamentos de estorno com validação de saldo líquido e limites do item.
  - `legacy.ts`: Materialização controlada de pedidos anteriores à migração do ledger.
- **Dependências Permitidas:** `pedidoFinanceiroSql.ts`, `pedidoReconcile.ts`. *(Nota: `ledger/` nunca importa `stock.ts` diretamente; a ponte financeira-física é feita exclusivamente por `pedidoReconcile.ts`).*
- **Invariantes Relevantes:**
  - O saldo cobrável e os pagamentos são avaliados e persistidos no **mesmo batch atômico** (`db.batch()`).
  - Nunca altera o valor original de um pagamento existente para estorná-lo; estornos criam registros independentes em `pedido_reembolsos`.
  - O status agregado de pagamento (`PENDENTE`, `PARCIAL`, `PAGO`) é uma **projeção pura derivada** via SQL atômico (`preparePedidoFinancialProjection` / `STATUS_FINANCEIRO_SQL`).

### 3.2. `pix/` (Orquestração Pix Administrativa)
- **Responsabilidade:** Controle de cobranças Pix geradas pelo lojista no painel de administração (via Mercado Pago Payments API, diferenciando-se do checkout público).
- **Fachada Pública:** `functions/lib/comandaPix.ts`.
- **Principais Módulos Internos:**
  - `types.ts`: Contratos de requisição e resposta de cobrança Pix no balcão.
  - `queries.ts`: Consultas de capacidade cobrável, pagamentos pendentes e verificação de concorrência.
  - `adminCharge.ts`: Criação transacional de cobrança Pix com envio ao gateway.
  - `adminRegenerate.ts`: Substituição de QR Code Pix expirado ou cancelado por nova cobrança válida.
  - `replay.ts`: Replay de cobrança idempotente já gerada anteriormente.
- **Dependências Permitidas:** `comandaLedger.ts`, `paymentSync.ts`, `stock.ts`, `mercadoPago.ts`.
- **Invariantes Relevantes:**
  - O `external_reference` no Mercado Pago para Pix administrativo utiliza o `idempotency_key` da tentativa local, garantindo unicidade sem conflitar com o `token_publico` do cliente.
  - A regeneração de um Pix substitui atomicamente pendências anteriores através de `substitui_pagamento_id`, evitando cobranças órfãs simultâneas para o mesmo saldo.

### 3.3. `paymentSync/` (Sincronização Convergente com Gateways)
- **Responsabilidade:** Garantir convergência entre a plataforma e os servidores externos do Mercado Pago. Processa webhooks, executa consultas sob demanda (*polling*), varreduras ativas (*sweeps*) e recuperação de falhas parciais.
- **Fachada Pública:** `functions/lib/paymentSync.ts`.
- **Principais Módulos Internos:**
  - `types.ts`: Interfaces de transições, mapeamento de eventos e payloads de webhook.
  - `status.ts`: Normalizador de status entre o Mercado Pago (`approved`, `in_process`, `rejected`, `refunded`) e o domínio contábil interno.
  - `client.ts`: Cliente HTTP com timeout estrito, retries determinísticos e tratamento de erros do PSP.
  - `webhook.ts`: Validação de assinatura criptográfica HMAC SHA-256 e resolução de eventos recebidos.
  - `ledgerSync.ts`: Execução de transições de status no banco D1 com atualização de estoque.
  - `sweeps.ts`: Varreduras em lote de expiração de reservas e cancelamento de cobranças abandonadas.
  - `inconclusiveRecovery.ts`: Protocolo B3 para resgate e convergência de transações em estado incerto.
- **Dependências Permitidas:** `comandaLedger.ts`, `comandaPix.ts`, `stock.ts`, `pedidoReconcile.ts`, `mercadoPago.ts`.
- **Invariantes Relevantes:**
  - Webhooks fora de ordem nunca revertem estados terminais (`PAGO`, `CANCELADO`, `REEMBOLSADO`, `FALHOU`).
  - A validação de assinatura HMAC SHA-256 é obrigatória antes de qualquer mutação provocada por webhook externo.

### 3.4. `adminPedidos/` (Orquestração de Pedidos do Lojista)
- **Responsabilidade:** Criação de comandas no balcão com validação sanitizada, listagem paginada enriquecida com projeções financeiras em lote via SQL preparado e execução de ações operacionais.
- **Ponto de Entrada Público:** Módulos consumidos via entrypoints dedicados por `functions/api/admin/pedidos.ts`.
- **Principais Módulos Internos:**
  - `types.ts`: Interfaces de ambiente, bindings e tipos de payload do balcão.
  - `list.ts`: Listagem paginada enriquecida com projeção financeira contábil em batch (`preparePedidoFinancialProjection`).
  - `manualValidation.ts`: Validação rigorosa de itens, estoque disponível, dados do cliente e sanitização.
  - `manualCreation.ts`: Criação atômica em batch D1 (inserção do pedido, itens, reserva de estoque físico, registro da operação A1 e pagamento balcão inicial quando aplicável).
  - `manualReplay.ts`: Replay idempotente da resposta original caso a mesma `operationKey` seja reenviada.
  - `maintenance.ts`: Ações de manutenção e higienização operacional de pedidos.
- **Dependências Permitidas:** `comandaLedger.ts`, `stock.ts`, `pedidoFinanceiroSql.ts`, `pedidoReconcile.ts`, `operacoes.ts`, `auth.ts`.
- **Invariantes Relevantes:**
  - Criação de pedido manual é idempotente via `operationKey` (A1).
  - Reserva física de estoque e persistência contábil ocorrem no **mesmo batch atômico** D1.
  - A listagem de pedidos nunca recalcula status financeiro em memória no JavaScript; deriva em lote via SQL (`preparePedidoFinancialProjection`).

---

## 4. Regras de Importação e Dependências

Para evitar dependências circulares ocultas e garantir a estabilidade da arquitetura, o repositório adota três regras estritas de importação:

```text
    ┌──────────────────────────────────────────────┐
    │ Consumidor Externo                           │
    │ (functions/api/**, tests/**, scripts/**)     │
    └──────────────────────┬───────────────────────┘
                           │ (DEVE importar pela Fachada)
                           ▼
    ┌──────────────────────────────────────────────┐
    │ Fachada Pública                              │
    │ (comandaLedger.ts, comandaPix.ts, etc.)      │
    └──────────────────────┬───────────────────────┘
                           │ (Delega para submódulos)
                           ▼
    ┌──────────────────────────────────────────────┐
    │ Módulos Internos do Subsistema               │
    │ (ledger/projection.ts, ledger/allocations.ts)│
    └──────────────────────────────────────────────┘
```

1. **Consumidores Externos Importam Exclusivamente pela Fachada:**
   - Rotas de API HTTP (`functions/api/**`), componentes de UI e testes automatizados devem importar símbolos de domínio através do arquivo de fachada:
     - `functions/lib/comandaLedger.ts` para o domínio contábil.
     - `functions/lib/comandaPix.ts` para o ciclo Pix.
     - `functions/lib/paymentSync.ts` para sincronização com gateways.
   - Isso blinda o consumidor externo contra refatorações na organização física das pastas internas.

2. **Módulos Internos Comunicam-se Diretamente:**
   - Arquivos dentro de um mesmo domínio podem importar diretamente seus irmãos (ex.: `ledger/adminPayments.ts` importa de `./allocations` e `./types`).

3. **REGRA PROIBIDA: Módulo Interno NUNCA Importa de sua Própria Fachada:**
   - É terminantemente proibido que um submódulo interno (ex.: `ledger/projection.ts`, `pix/adminCharge.ts`, `paymentSync/ledgerSync.ts`) importe qualquer símbolo de sua própria fachada (`comandaLedger.ts`, `comandaPix.ts`, `paymentSync.ts`).
   - Essa violação cria dependências circulares (`fachada -> submódulo -> fachada`) que quebram bundlers (esbuild, Vite) e geram runtime `undefined`.

---

## 5. Fachadas Públicas Deliberadas vs Módulos Legados

É essencial não confundir a finalidade de **fachadas públicas** com **módulos de compatibilidade legada**:

| Arquivo | Natureza Arquitetural | Função no Sistema |
| :--- | :--- | :--- |
| `comandaLedger.ts` | **Fachada Pública Deliberada** | Gateway estável de exportação do subsistema `ledger/`. Não é um resto temporário de refatoração, mas uma decisão de design permanente para blindar chamadores externos contra mudanças internas. |
| `comandaPix.ts` | **Fachada Pública Deliberada** | Gateway estável de exportação do subsistema `pix/`. |
| `paymentSync.ts` | **Fachada Pública Deliberada** | Gateway estável de exportação do subsistema `paymentSync/`. |
| `ledger/legacy.ts` | **Módulo Interno de Compatibilidade** | Contém código adaptador para ler esquemas de pedidos criados antes da introdução do motor de partidas dobradas (ex.: `ensureLegacyPaymentMaterialized`). **Não é uma fachada** e não deve ser importado fora de `ledger/` ou de sua fachada. |

---

## 6. Invariantes do Domínio Contábil e de Negócio

1. **Idempotência Universal (A1 / UUID v4):**
   - Comandos com efeitos colaterais monetários ou físicos aceitam um cabeçalho/campo `operationKey` (UUID v4 gerado pelo cliente).
   - O par `(operation_key, operacao)` é gravado na tabela `pedido_operacoes`.
   - Se o cliente reenviar a mesma requisição (devido a perda de conexão, timeout ou clique duplo), o servidor intercepta a duplicidade e retorna o replay exato da resposta original, sem reexecutar descontos de estoque ou novos pagamentos.

2. **CAS (Compare-And-Swap / Atualização Condicional):**
   - Atualizações em estados críticos de pedidos e de estoque utilizam predicados atômicos na cláusula `WHERE` (ex.: `WHERE id = ? AND status_pagamento = 'PENDENTE'`, ou `WHERE estoque_estado IN ('RESERVADO', 'SEM_RESERVA', 'LIBERADO')`).
   - Se duas requisições concorrentes tentarem baixar o mesmo estoque ou transicionar a mesma cobrança, apenas a primeira vence o CAS; a segunda detecta 0 linhas afetadas e comporta-se de forma segura (no-op ou replay).

3. **Atomicidade Transacional via D1 `batch()`:**
   - O Cloudflare D1 executa blocos atômicos através do método `db.batch([stmt1, stmt2, ...])`.
   - Operações compostas (ex.: cadastrar pagamento + registrar alocações em cascata por item) são executadas atomicamente em um único roundtrip `all-or-nothing`. Não existe estado intermediário visível no banco.

4. **Concorrência de Estoque e Saldo:**
   - A conferência de saldo cobrável ocorre **dentro da subquery SQL do INSERT** do pagamento, não sobre dados carregados previamente em memória no JavaScript.
   - O estoque de produtos opera com trava de reserva (`estoque_reservado`) com tempo de expiração (*TTL*). O estoque físico real só é baixado (`estoque_baixado_em`) mediante a confirmação contábil definitiva (`status = 'PAGO'`).

5. **Imutabilidade de Lançamentos de Pagamento e Estorno:**
   - Estornos parciais ou totais nunca sobrescrevem ou deletam linhas de `pedido_pagamentos`.
   - O reembolso gera um evento independente em `pedido_reembolsos`, mantendo a trilha de auditoria bancária intacta.
   - O valor líquido pago de um pedido é sempre calculado como $\sum(\text{pagamentos PAGO}) - \sum(\text{reembolsos REEMBOLSADO})$.

6. **Reconciliação Convergente (Passo 4c-2):**
   - O status financeiro agregado do pedido (`pedidos.status_pagamento`) converge deterministicamente pela consulta SQL consolidada (`STATUS_FINANCEIRO_SQL`), nunca por variáveis temporárias em memória no JavaScript.

7. **Webhooks Fora de Ordem e Estados Terminais:**
   - Um evento de pagamento que atinge um estado terminal (`PAGO`, `CANCELADO`, `REEMBOLSADO`, `FALHOU`) é irreversível perante notificações desordenadas subsequentes.
   - Notificações atrasadas do gateway reportando estados intermediários (`pending`, `in_process`) são descartadas como no-op seguro.

8. **Recuperação Inconclusiva de Transações:**
   - Quando uma transação é aprovada no gateway externo mas a conexão entre o Worker e o banco D1 sofre timeout antes da gravação do resultado, o estado local permanece temporariamente divergente.
   - A rotina de varredura ativa B3 detecta e reconcilia essas transações de forma não-destrutiva.

---

## 7. Protocolos Críticos: A1, B2, B3, B4 e R3

O ecossistema do R&P Doces é protegido por cinco protocolos determinísticos de consistência:

| Protocolo | Finalidade Principal | Problema que Evita | Módulos Envolvidos |
| :---: | :--- | :--- | :--- |
| **A1** | **Idempotência de Intenções Administrativas** | Evita que duplicidades na UI ou rede dupliquem pagamentos manuais, cancelamentos de itens, trocas ou novas comandas. | `operacoes.ts`, `comandaLedger.ts`, `adminPedidos/` |
| **B2** | **Reconciliação Ativa do Checkout Pix** | Impede que uma confirmação bancária do cliente seja perdida se o pagamento for aprovado pelo gateway no mesmo instante da expiração local. | `paymentSync/ledgerSync.ts`, `pedido-status.ts` |
| **B3** | **Recuperação de Falhas e Operações Inconclusivas** | Resgata operações interrompidas antes da conclusão de efeitos colaterais e converge divergências entre o banco local e o gateway. | `paymentSync/inconclusiveRecovery.ts`, `pedidoReconcile.ts` |
| **B4** | **Proteção Mútua de Reservas em Regeneração** | Impede que a expiração de uma cobrança Pix cancelada/antiga libere o estoque de um pedido que já gerou um novo Pix ativo. | `pix/queries.ts`, `pix/adminRegenerate.ts`, `paymentSync/sweeps.ts` |
| **R3** | **Hardening de Reembolsos e Trocas em Cadeia** | Garante regras LIFO de estorno (dinheiro primeiro), protege contra devoluções superiores ao valor pago e mantém linhagem de trocas. | `financialCoverage.ts`, `ledger/adminRefunds.ts`, `mpRefund.ts` |

### Detalhamento dos Protocolos:

### Protocolo A1 (Idempotência Operacional)
- **Cenário:** O operador administrativo registra um pagamento manual de R$ 50,00 ou aprova uma troca de itens e a conexão oscila. O operador clica novamente no botão.
- **Solução:** Toda requisição envia uma `operationKey` única (UUID v4). A camada `operacoes.ts` persiste a chave na tabela `pedido_operacoes` com lock de unicidade. A segunda execução detecta o registro e responde instantaneamente com o mesmo payload da primeira, garantindo que o saldo seja consumido apenas uma vez.

### Protocolo B2 (Proteção de Expiração no Checkout)
- **Cenário:** O cliente faz o Pix no último minuto do cronômetro. O banco aprova, mas o Worker local disparou o timeout de reserva de 30 minutos.
- **Solução:** Antes de liberar o estoque e declarar o pedido expirado, a rotina de verificação consulta diretamente a API do Mercado Pago. Caso o gateway acuse aprovação, a expiração local é revertida e o pedido é promovido diretamente a `PAGO`, protegendo a compra do consumidor.

### Protocolo B3 (Recuperação Inconclusiva)
- **Cenário:** O webhook do Mercado Pago foi recebido, o registro financeiro foi persistido no banco, mas a conexão caiu antes de atualizar o status derivado do pedido ou notificar a cozinha.
- **Solução:** A rotina de varredura `recuperarOperacoesInconclusivas` detecta pedidos cujo ledger acusa pagamento confirmado mas cujos efeitos derivados (status operacional ou reconciliação física) não foram concluídos, reparando o pedido de forma convergente e não-destrutiva.

### Protocolo B4 (Proteção de Concorrência entre Pix Ativos)
- **Cenário:** Um cliente pediu para trocar de celular e o lojista gerou um novo QR Code Pix no balcão. Poucos segundos depois, o primeiro Pix (antigo) atinge o tempo limite de expiração.
- **Solução:** A varredura de expiração (`liberarReservasVencidasLocalmente`) executa a consulta `getPixAdminPendentesAtivos()`. Ela identifica que o pedido possui uma cobrança Pix sucessora pendente e **retém a reserva de estoque**, cancelando apenas a linha expirada sem prejudicar o cliente.

### Protocolo R3 (Hardening de Reembolsos e Linhagem)
- **Cenário:** Um pedido de R$ 30,00 foi pago parte em Pix e parte em Dinheiro. O cliente troca um doce de R$ 15,00 por um de R$ 10,00 e solicita a devolução da diferença de R$ 5,00.
- **Solução:** A função de estorno aplica ordem **LIFO contábil**: prioriza pagamentos mais recentes e meios físicos em espécie antes de disparar estornos parciais eletrônicos via API bancária. Valida que o total devolvido respeita rigorosamente o teto pago daquele item original ou de seus ancestrais na árvore genealógica de trocas.

---

## 8. Diagramas dos Fluxos Críticos

### Fluxo A: Checkout Pix (Storefront do Cliente)

```text
[Cliente]                 [checkout.ts]              [Mercado Pago]             [D1 Database]
   │                           │                           │                          │
   │─── POST /api/checkout ───>│                           │                          │
   │    (itens + cliente)      │── Valida estoque e preços ──────────────────────────>│
   │                           │<── Reserva estoque (ATIVA com TTL) ──────────────────│
   │                           │                           │                          │
   │                           │── POST /v1/payments ─────>│                          │
   │                           │<── QR Code + Copia e Cola │                          │
   │                           │                           │                          │
   │                           │── INSERT pedido + pagamento PENDENTE (batch) ───────>│
   │<── Retorna QR Code e Token│                           │                          │
   │                           │                           │                          │
   ▼                           ▼                           ▼                          ▼
[Cliente paga no banco] ───> [Mercado Pago processa] ───> [Dispara Webhook (Fluxo B)]
```

---

### Fluxo B: Processamento de Webhook Mercado Pago

```text
[Mercado Pago]           [webhooks/mercadopago.ts]       [paymentSync]             [D1 Database]
   │                              │                            │                         │
   │─── POST com HMAC SHA-256 ───>│                            │                         │
   │                              │── Valida assinatura HMAC   │                         │
   │                              │── syncPaymentFromMp() ────>│                         │
   │                              │                            │── Busca status atual ──>│
   │                              │                            │<── Status local ────────│
   │                              │                            │                         │
   │                              │                            │── Se estado terminal:   │
   │                              │                            │   Retorna no-op seguro  │
   │                              │                            │                         │
   │                              │                            │── Se aprovado (PAGO):   │
   │                              │                            │   1. UPDATE pagamento   │
   │                              │                            │   2. Baixa de estoque   │
   │                              │                            │   3. Web Push cozinha   │
   │                              │                            │   (no mesmo batch) ────>│
   │<── 200 OK imediato ──────────│                            │                         │
```

---

### Fluxo C: Sincronização e Reconciliação (Polling de Pedido)

```text
[AcompanharPedido.tsx]        [api/pedido-status.ts]         [paymentSync]          [Mercado Pago]
        │                              │                           │                      │
        │── Polling GET a cada 3s ────>│                           │                      │
        │                              │── refreshPedidoStatus() ─>│                      │
        │                              │                           │── GET /v1/payments ─>│
        │                              │                           │<── Status do gateway │
        │                              │                           │                      │
        │                              │                           │── Se divergir:       │
        │                              │                           │   Aplica transição   │
        │                              │                           │   convergente no D1  │
        │<── Status consolidado ───────│<──────────────────────────│                      │
```

---

### Fluxo D: Estorno e Reembolso Administrativo

```text
[Admin Modal]               [api/admin/pedidos/[id]/reembolsos.ts]         [comandaLedger]
      │                                       │                                   │
      │── POST com operationKey e valor ─────>│                                   │
      │                                       │── Verifica A1 em pedido_operacoes │
      │                                       │── registerManualRefund() ────────>│
      │                                       │                                   │── Confere saldo
      │                                       │                                   │── Ordem LIFO (R3)
      │                                       │                                   │── INSERT pedido_reembolsos
      │                                       │                                   │── Recalcula agregado
      │                                       │<── Confirmação e novo saldo ──────│   (no mesmo batch)
      │<── 200 OK + Detalhe financeiro ───────│
```

---

### Fluxo E: Criação de Pedido Manual (Balcão)

```text
[NovoPedidoModal.tsx]       [api/admin/pedidos.ts]       [adminPedidos/manualCreation]    [D1 Database]
        │                              │                               │                        │
        │── POST /api/admin/pedidos ──>│                               │                        │
        │   (com operationKey)         │── Valida token admin          │                        │
        │                              │── createManualPedido() ──────>│                        │
        │                              │                               │── Valida itens e preço │
        │                              │                               │── Executa batch:       │
        │                              │                               │   1. INSERT pedido     │
        │                              │                               │   2. INSERT itens      │
        │                              │                               │   3. Reserva estoque   │
        │                              │                               │   4. Registra operacao │
        │                              │                               │   5. Pagamento inicial │
        │                              │<── Retorna pedido criado ─────│── (se já pago no ato)─>│
        │<── 201 Created com dados ────│
```

---

### Fluxo F: Recuperação Inconclusiva (B3 Recovery Sweep)

```text
[Timer / Requisição Admin]        [inconclusiveRecovery.ts]     [Mercado Pago]      [D1 Database]
             │                                │                       │                  │
             │── Executa recuperação B3 ─────>│                       │                  │
             │                                │── Busca transações com divergência ─────>│
             │                                │<── Retorna lista de pagamentos pendentes │
             │                                │                       │                  │
             │                                │── Para cada pagamento inconclusivo:      │
             │                                │   1. Consulta status no gateway ────────>│
             │                                │   2. Compara com projeção local          │
             │                                │   3. Se aprovado: executa conciliação    │
             │                                │   4. Atualiza estoque e pedido ─────────>│
             │<── Relatório de reparos ───────│
```

---

## 9. Arquitetura de Testes Automatizados

O repositório adota uma abordagem de testes determinísticos executados em runtime Node.js nativo (`node --test`), simulando o ambiente Cloudflare Pages com banco D1 em memória (via Miniflare e esbuild in-memory):

- **Volume de Cobertura:** **47 suítes de teste** totalizando **721 testes automatizados** aprovados com 100% de sucesso no baseline completo.
- **Harness de Teste (`tests/helpers/b3.mjs`):**
  - Compila os módulos TypeScript de produção em memória usando `esbuild` antes de cada execução.
  - Sobe uma instância limpa de D1 isolada por teste, executando as migrações SQL oficiais em ordem cronológica.
  - Zero dependência de endpoints falsos ou mocks estáticos de banco: o código testado é exatamente o código que sobe para o Cloudflare.

### Comandos de Execução:
- **Runner Sequencial Completo:**
  ```bash
  npm test
  # Executa scripts/run-tests.mjs sobre todas as 47 suítes
  ```
- **Runner com Cache SHA-256:**
  ```bash
  npm run test:cached
  # Executa apenas as suítes cujos arquivos-fonte ou dependências sofreram alterações
  ```

> [!IMPORTANT]
> **Ressalva de Engenharia sobre Testes:**
> A aprovação dos 721 testes automatizados comprova a adesão do sistema a todos os cenários modelados e protege contra regressões estruturais. No entanto, testes automatizados **não equivalem a uma prova matemática formal de ausência de falhas**. Cenários de alta latência de rede, timeouts atípicos de PSP e permutações de milissegundos exigem conformidade contínua com os invariantes aqui definidos.

---

## 10. Higiene do Repositório e Gestão de Segredos

O repositório passou por auditoria forense completa para manter o código-fonte livre de configurações locais indevidas e resíduos de desenvolvimento:

1. **Arquivos Locais e de IDE Desindexados e Bloqueados:**
   - `.claude/` (configurações locais de IA/editor mantidas fora do Git).
   - `.qoder`, `.test-cache/`, `graphify*`, `backup*/`, `.vscode/`, `.idea/`, `test-logs/` bloqueados pelo `.gitignore`.
2. **Arquivos de Segredos e Variáveis de Ambiente:**
   - `.dev.vars`, `.env`, `.env.*` são terminantemente ignorados pelo Git (permitindo apenas `!.env.example`).
3. **Auditoria de Histórico:**
   - Varredura profunda em todo o grafo de commits confirmou que **nenhum segredo real de produção** (tokens Mercado Pago, chaves privadas VAPID ou senhas de banco) foi exposto no histórico do repositório.

---

## 11. Otimização Concluída de Assets (Imagens WebP)

Na etapa de otimização de ativos estáticos, todos os 7 assets de imagem PNG ativos do projeto foram convertidos para o codec moderno **WebP qualidade 85**:

| Imagem | Dimensões | Peso Original (PNG) | Peso Otimizado (WebP q85) | Economia (%) |
| :--- | :---: | :---: | :---: | :---: |
| `hero-cake.webp` | 1000 × 1120 | 1.426,1 KB (1.460.339 bytes) | **68,4 KB (70.026 bytes)** | **-95,2%** |
| `story-image.webp` | 800 × 600 | 739,4 KB (757.170 bytes) | **45,7 KB (46.816 bytes)** | **-93,8%** |
| `produto-encanto-frutas.webp` | 604 × 440 | 395,6 KB (405.050 bytes) | **18,6 KB (19.096 bytes)** | **-95,3%** |
| `produto-maracuja.webp` | 604 × 440 | 426,2 KB (436.425 bytes) | **27,2 KB (27.876 bytes)** | **-93,6%** |
| `produto-ninho-nutella.webp` | 604 × 440 | 360,8 KB (369.508 bytes) | **14,4 KB (14.770 bytes)** | **-96,0%** |
| `produto-prestigio.webp` | 604 × 440 | 376,3 KB (385.342 bytes) | **19,5 KB (19.956 bytes)** | **-94,8%** |
| `produto-pudim.webp` | 604 × 440 | 395,0 KB (404.637 bytes) | **19,0 KB (19.444 bytes)** | **-95,2%** |
| **TOTAL** | — | **4.218.471 bytes (~4,22 MB)** | **217.984 bytes (~0,22 MB)** | **-94,83%** |

- **Preservação de Dimensões e Retina:** As dimensões originais foram 100% preservadas (proporcionando nitidez 2x exata para telas Retina nos cards de 302×220 px e no Hero de 500×560 px). Nenhum redimensionamento foi necessário.
- **Transparência Perfeita:** `hero-cake.webp` preservou integralmente o canal alfa de transparência sem desbotamento periférico ($\text{PSNR} = \infty$).
- **Eliminação de Canais Falsos:** Os 5 produtos e a imagem institucional continham canal alfa inútil (255 uniforme exportado pelo Figma), devidamente limpo no WebP, reduzindo 25% de dados brutos desnecessários.

---

## 12. Metodologia de Dead Code e Lista de Proteção Sagrada

O repositório adota a premissa: *Primeiro modulariza-se por responsabilidade; apenas após expor com clareza os limites é autorizada a auditoria de código morto.*

### Lista de Proteção Sagrada (NUNCA remover automaticamente por falta de import estático):
1. **Migrations SQL aplicadas (`migrations/*.sql`):** São o histórico executável e imutável do banco D1.
2. **Cloudflare Pages Functions (`functions/api/**`):** A própria convenção de arquivos/pastas define a rota HTTP; elas não possuem imports estáticos externos.
3. **Webhooks (`functions/api/webhooks/**`):** Entrypoints acionados externamente por gateways (Mercado Pago).
4. **Service Workers (`public/sw-admin.js`):** Script executado diretamente pelo navegador em thread separada.
5. **Scripts operacionais e de validação (`scripts/**`):** Executados via CLI (`node scripts/...`).
6. **Assets referenciados dinamicamente ou por string:** Ícones PWA, badges, manifests (`/icons/*`, `/admin-manifest.webmanifest`, `favicon.svg`).
7. **Código chamado dinamicamente ou por reflexão.**
8. **Fallbacks de recuperação e offline:** Páginas estáticas de contingência (`admin-offline.html`).
9. **Código de compatibilidade legada:** Somente remover após provar documental e tecnicamente que o banco de produção e clientes legados não dependem dele.

---

## 13. Guia para Futuras Contribuições

### Antes de Criar um Novo Módulo:
1. **Definir Responsabilidade Clara:** Identifique o domínio correspondente (`ledger/`, `pix/`, `paymentSync/`, `adminPedidos/`). Não crie módulos gerais tipo `utils.ts` ou `helpers.ts` sem fronteira clara.
2. **Evitar Duplicação de Regra Financeira:** Todo cálculo financeiro ou contábil deve convergir com as regras centrais em `ledger/` e `pedidoFinanceiroSql.ts`.
3. **Respeitar a Fachada Pública:** Se a funcionalidade for consumida por rotas ou telas, exponha-a através da fachada pública do subsistema correspondente.
4. **Não Importar a Fachada nos Submódulos:** Garanta que seu módulo não importe de `comandaLedger.ts`, `comandaPix.ts` ou `paymentSync.ts`.
5. **Preservar Idempotência:** Toda operação com impacto monetário ou físico deve prever recepção de chave `operationKey`.
6. **Adicionar Testes:** Crie testes automatizados em `tests/` cobrindo cenários de sucesso, erro e reenvio concorrente da mesma requisição.

### Antes de Alterar Fluxos Financeiros ou de Banco de Dados:
1. **Entender os Invariantes:** Lembre-se de que estornos nunca deletam pagamentos, pedidos são agregados e estoque é físico vs reservado.
2. **Testar Concorrência e Replay:** Simule duas requisições concorrentes disparadas no mesmo milissegundo (usando `Promise.all` em testes Miniflare).
3. **Preservar Compatibilidade de Migrations:** Migrações SQL em `migrations/` são incrementais e imutáveis. Nunca edite uma migração já aplicada em produção.
4. **Executar a Validação Padrão:**
   ```bash
   npx tsc --noEmit && npm run build && git diff --check
   ```

---

## 14. Roadmap Futuro (Não Integrado na Arquitetura Atual)

Para fins de alinhamento técnico e de produto, os seguintes tópicos representam **possibilidades futuras de evolução** e **NÃO** fazem parte da arquitetura implementada:

- **Evolução Visual e Micro-animações Avançadas:**
  Adoção futura e planejada de bibliotecas especializadas de animação vetorial/3D (ex.: Motion (motion/react), GSAP ou Three.js). *Status atual: O projeto utiliza animações nativas em CSS puro (`PageTransition.css`, transições em `Homepage.css`).*
- **Purga de Blobs Históricos (git filter-repo):**
  Avaliação futura de reescrita de histórico Git para eliminar blobs de builds e imagens órfãs antigas caso o repositório cresça substancialmente. *Status atual: Não recomendado no momento para preservar a integridade das referências e hashes de commit.*
