# Visão geral da arquitetura

## 1. Topologia do sistema

A aplicação R&P Doces é estruturada como uma aplicação web nativa de borda, implantada no Cloudflare Pages e no Pages Functions. Ela utiliza Cloudflare D1 (SQLite sem servidor) para persistência transacional e Cloudflare R2 para armazenamento de arquivos.

```
+-------------------------------------------------------------------+
|                         Camada cliente                            |
|   Vite + React (SPA) + Tailwind CSS + Lucide React                  |
|   Estado: armazenamento local / repositórios de estado no cliente  |
+---------------------------------+---------------------------------+
                                  |
                                  | HTTPS / JSON
                                  v
+---------------------------------+---------------------------------+
|                   Cloudflare Pages Functions                      |
|                      API de borda (/api/*)                         |
|                                                                   |
|   Roteamento e middleware:                                        |
|     - Contextualização de requisições (functions/api/...)          |
|     - Autenticação (cookies de sessão / verificação de tokens)     |
|                                                                   |
|   Serviços de domínio (functions/lib/):                            |
|     - paymentSync: reconciliação com o gateway (Mercado Pago)      |
|     - stock.ts: lógica de reserva e baixa física                  |
|     - ledger/: projeções e alocações do registro financeiro        |
|     - operacoes.ts: ciclo de operações e chaves de idempotência    |
|     - Vínculos nativos D1 (env.DB): execução transacional em lote   |
+-------------------+-------------------------------+---------------+
                    |                               |
                    v                               v
+-------------------+---------------+   +-----------+---------------+
|          Cloudflare D1            |   |       Cloudflare R2       |
|    (Mecanismo SQLite distribuído) |   | (Armazenamento de objetos) |
|                                   |   |                           |
|   - Tabelas do registro financeiro|   |   - Imagens do catálogo    |
|   - Estoque e reservas            |   |   - Arquivos estáticos    |
|   - Pedidos e rastreio de operações|  +---------------------------+
+-----------------------------------+
```

---

## 2. Camadas e fronteiras

### 2.1 Aplicação cliente (`src/`)

- Aplicação de página única construída com React e TypeScript.
- Comunica-se com os endpoints `/api/*` por meio de corpos de requisição e resposta em JSON.
- Implementa padrões de requisição transacional idempotente, gerando chaves de operação (`operationKey`) e acompanhando o estado no cliente.

### 2.2 Funções de borda e endpoints da API (`functions/api/`)

- Handlers de requisição sem servidor executados no ambiente Cloudflare Workers/Pages Functions.
- Validam os parâmetros de entrada antes de iniciar operações de persistência.
- Isolam os fluxos públicos de checkout das interfaces de gestão administrativa.
- Traduzem webhooks recebidos e ações do cliente em lotes transacionais atômicos executados por `env.DB.batch()`.

### 2.3 Camada de lógica de domínio (`functions/lib/`)

- Encapsula transições de estado, cálculos financeiros e operações de estoque.
- Contém funções puras e módulos determinísticos de domínio que recebem vínculos de banco e modelos de domínio como entrada.
- Contém clientes de gateway e sincronizadores de dados responsáveis por validar respostas de provedores externos.

### 2.4 Camada de persistência (`migrations/` e Cloudflare D1)

- Schema relacional gerenciado por scripts SQL sequenciais de migração (`migrations/*.sql`).
- Utiliza restrições SQLite (`CHECK`, `FOREIGN KEY`, `UNIQUE`) para garantir invariantes referenciais e de negócio no mecanismo do banco.

---

## 3. Fronteiras de confiança e modelo de segurança

1. **Fronteira do cliente não confiável**:
   - O navegador é tratado como um ambiente não confiável.
   - Preços, níveis de estoque, totais de pedidos e status de pagamento são recalculados e verificados pelo servidor, que é a fonte autoritativa.
   - Valores fornecidos pelo cliente são validados contra os dados do catálogo no momento da reserva.

2. **Fronteira de integridade do banco**:
   - Invariantes estruturais são garantidos por restrições SQLite (`CHECK` nos níveis de estoque, referências `FOREIGN KEY` nos itens e restrições `UNIQUE` nas chaves de pagamentos e operações).
   - Atualizações atômicas em várias tabelas usam `env.DB.batch()`, garantindo que o lote de instruções seja executado integralmente ou revertido.

3. **Fronteira do gateway externo**:
   - Corpos de webhooks externos são tratados como indícios não verificados.
   - Atualizações de status do gateway exigem verificação por consulta à API autoritativa do provedor antes de alterar o estado nas tabelas locais do registro financeiro.

---

## 4. Invariantes principais e níveis de garantia

- **Precisão monetária**: todos os valores monetários são representados e armazenados em centavos inteiros (`*_centavos` como `INTEGER` no SQLite e `number` no TypeScript dentro dos limites de inteiros seguros). Valores monetários em ponto flutuante são proibidos por convenção arquitetural e revisão de código.
- **Registro financeiro aditivo**: após a liquidação, os fatos de pagamento registrados são tratados como imutáveis pela aplicação. Reversões de estado, ajustes e reembolsos são registrados como linhas adicionais em `pedido_reembolsos`, em vez de alterações destrutivas nos pagamentos originais.
- **Proteção da reserva de estoque**: vendas acima do estoque são impedidas por restrições estruturais do banco (`CHECK (estoque_reservado >= 0 AND estoque_reservado <= estoque)`) combinadas com atualizações atômicas em lote no Cloudflare D1.
- **Operações idempotentes**: mutações aceitam uma chave de operação que impede processamento duplicado em novas tentativas de rede ou envios concorrentes, por meio de índices únicos e verificações transacionais de reexecução.
