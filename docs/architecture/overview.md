<a id="architecture-overview"></a>

# Visão geral da arquitetura

<a id="1-system-topology"></a>

## 1. Topologia do sistema

A aplicação RP Doces é estruturada como uma aplicação web nativa de edge, publicada no Cloudflare Pages e Pages Functions, com Cloudflare D1 (SQLite serverless) para persistência transacional e Cloudflare R2 para armazenamento de assets.

```
+-------------------------------------------------------------------+
|                         Client Layer                              |
|   Vite + React (SPA) + Tailwind CSS + Lucide React                |
|   State: Local storage / Client-side stores                      |
+---------------------------------+---------------------------------+
                                  |
                                  | HTTPS / JSON
                                  v
+---------------------------------+---------------------------------+
|                   Cloudflare Pages Functions                      |
|                      Edge API (/api/*)                            |
|                                                                   |
|   Routing & Middleware:                                           |
|     - Request contextualization (functions/api/...)               |
|     - Auth verification (session cookies / token checks)          |
|                                                                   |
|   Domain Services (functions/lib/):                               |
|     - paymentSync: Gateway reconciliation (Mercado Pago)          |
|     - stock.ts: Reservation & physical deduction logic            |
|     - ledger/: Financial ledger projections & allocations         |
|     - operacoes.ts: Operation lifecycle & idempotency keys        |
|     - D1 Native Bindings (env.DB): Batch transactional execution  |
+-------------------+-------------------------------+---------------+
                    |                               |
                    v                               v
+-------------------+---------------+   +-----------+---------------+
|          Cloudflare D1            |   |       Cloudflare R2       |
|    (Distributed SQLite Engine)    |   |     (Object Storage)      |
|                                   |   |                           |
|   - Financial Ledger Tables       |   |   - Catalog Images        |
|   - Inventory & Reservations      |   |   - Static Media Assets   |
|   - Orders & Operation Tracking   |   +---------------------------+
+-----------------------------------+
```

---

<a id="2-layers-and-boundaries"></a>

## 2. Camadas e limites

<a id="21-client-application-src"></a>

### 2.1 Aplicação cliente (`src/`)

- Aplicação de página única construída com React e TypeScript.
- Comunica-se com endpoints `/api/*` por meio de payloads JSON.
- Implementa padrões de requisições transacionais idempotentes gerando chaves de operação no cliente (`operationKey`) e acompanhando o estado no cliente.

<a id="22-edge-functions--api-endpoints-functionsapi"></a>

### 2.2 Functions de edge e endpoints de API (`functions/api/`)

- Handlers serverless de requisições executados no runtime do Cloudflare Workers/Pages Functions.
- Valida os parâmetros recebidos antes de iniciar operações de persistência.
- Isola os fluxos públicos de checkout das interfaces de gestão administrativa.
- Converte webhooks recebidos e ações do cliente em batches transacionais atômicos executados por `env.DB.batch()`.

<a id="23-domain-logic-layer-functionslib"></a>

### 2.3 Camada de lógica de domínio (`functions/lib/`)

- Encapsula transições de estado, cálculos financeiros e operações de estoque.
- Funções puras e módulos de domínio determinísticos que recebem bindings de banco e modelos de domínio como entradas.
- Contém clientes de gateways e sincronizadores de dados responsáveis por validar respostas de provedores externos.

<a id="24-persistence-layer-migrations-and-cloudflare-d1"></a>

### 2.4 Camada de persistência (`migrations/` e Cloudflare D1)

- Schema relacional gerenciado por scripts SQL de migração sequenciais (`migrations/*.sql`).
- Usa constraints do SQLite (`CHECK`, `FOREIGN KEY`, `UNIQUE`) para garantir invariantes referenciais e de negócio no próprio motor do banco.

---

<a id="3-trust-boundaries-and-security-model"></a>

## 3. Limites de confiança e modelo de segurança

1. **Limite do cliente não confiável**:
   - O navegador é tratado como ambiente não confiável.
   - Preços, níveis de estoque, totais de pedidos e status de pagamento são recalculados e verificados no servidor, que é a fonte de autoridade.
   - Os valores enviados pelo cliente são validados contra os dados do catálogo no momento da reserva.

2. **Limite de integridade do banco**:
   - Invariantes estruturais são garantidas por constraints do SQLite (condições `CHECK` sobre níveis de estoque, referências `FOREIGN KEY` nos itens e constraints `UNIQUE` sobre chaves de pagamentos e operações).
   - Atualizações atômicas de múltiplas tabelas são executadas com `env.DB.batch()`, garantindo execução integral ou nenhuma execução do batch de instruções.

3. **Limite do gateway externo**:
   - Payloads de webhooks externos são tratados como indícios não verificados.
   - Atualizações de status do gateway exigem verificação por consulta à API do provedor, como fonte de autoridade, antes de aplicar mutações nas tabelas locais do ledger.

---

<a id="4-key-design-invariants-and-enforcement-levels"></a>

## 4. Invariantes centrais de projeto e níveis de garantia

- **Precisão monetária**: todos os valores monetários são representados e armazenados como centavos inteiros (`*_centavos` como `INTEGER` no SQLite, `number` no TypeScript dentro dos limites seguros de inteiros). Valores de ponto flutuante para moeda são proibidos por convenção arquitetural e revisão de código.
- **Ledger financeiro append-only**: após a liquidação, os fatos de pagamento registrados são tratados como imutáveis pela aplicação. Reversões de estado, ajustes e reembolsos são registrados como linhas aditivas em `pedido_reembolsos`, em vez de alterações destrutivas dos pagamentos originais.
- **Proteção da reserva de estoque**: a venda acima do estoque é impedida por constraints estruturais do banco (`CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`) combinadas com atualizações atômicas em batch no Cloudflare D1.
- **Operações idempotentes**: as mutações aceitam uma chave de operação que impede processamento duplicado em novas tentativas de rede ou envios concorrentes, por meio de indexação única no banco e verificações transacionais de replay.
