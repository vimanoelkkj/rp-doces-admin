<a id="financial-ledger-architecture"></a>

# Arquitetura do ledger financeiro

<a id="1-principles-and-invariants"></a>

## 1. Princípios e invariantes

O domínio financeiro da RP Doces segue princípios de ledger: recebimentos e desembolsos históricos são registrados como fatos individuais. As posições financeiras são derivadas dinamicamente, sem sobrescrever registros históricos.

<a id="11-integer-cents-centavos"></a>

### 1.1 Centavos inteiros (`*_centavos`)

Todos os valores monetários no código, schema do banco, APIs e cálculos do cliente são representados como centavos inteiros (`INTEGER` no SQLite, `number` no TypeScript restrito ao domínio dos inteiros):

```sql
valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0)
```

- **Banco de dados**: as definições do schema garantem `INTEGER NOT NULL` e `CHECK (valor_centavos > 0)`.
- **Aplicação**: tipos de ponto flutuante (`REAL`, `FLOAT`) são evitados por convenção. As interfaces TypeScript representam moeda em centavos inteiros.
- **Apresentação**: a formatação para exibição, convertendo centavos inteiros em strings de moeda BRL, ocorre estritamente no limite da UI, com `Intl.NumberFormat`.
- **Regra de arredondamento**: cálculos intermediários que exigem divisão, como descontos por item ou alocações parciais, aplicam regras explícitas de arredondamento inteiro (`Math.round` ou sequências de floor/ceil) para garantir a conservação dos centavos.

---

<a id="2-ledger-schema-structure"></a>

## 2. Estrutura do schema do ledger

O estado financeiro de um pedido é distribuído entre tabelas específicas do ledger:

```
+--------------------------+
|         pedidos          |
|--------------------------|
| id (PK, INTEGER)         |
| valor_total_centavos     |
| status_pagamento         |
+------------+-------------+
             |
             | 1:N
             +-------------------------------+
             |                               |
             v                               v
+----------------------------+     +----------------------------+
|     pedido_pagamentos      |     |     pedido_reembolsos      |
|----------------------------|     |----------------------------|
| id (PK, INTEGER)           |     | id (PK, INTEGER)           |
| pedido_id (FK)             |     | pedido_id (FK)             |
| metodo (CHECK enum)        |     | pagamento_id (FK)          |
| valor_centavos             |     | origem (CHECK enum)        |
| status (CHECK enum)        |     | metodo (CHECK enum)        |
| mp_payment_id (INDEX)      |     | valor_centavos             |
| idempotency_key (UNIQUE)   |     | status (CHECK enum)        |
| criado_em, atualizado_em   |     | mp_refund_id               |
| pago_em, cancelado_em      |     | idempotency_key (UNIQUE)   |
+-------------+--------------+     | motivo, criado_em          |
              |                    +----------------------------+
              | 1:N
              v
+------------------------------+
|  pedido_pagamento_alocacoes  |
|------------------------------|
| id (PK, INTEGER)             |
| pagamento_id (FK)            |
| pedido_item_id (FK)          |
| valor_centavos               |
| criado_em                    |
+------------------------------+
```

<a id="21-immutability-and-lifecycle-of-payments-pedidopagamentos"></a>

### 2.1 Imutabilidade e ciclo de vida dos pagamentos (`pedido_pagamentos`)

- **Transições de ciclo de vida**: as linhas de `pedido_pagamentos` são criadas com `status = 'PENDENTE'` e avançam pelo ciclo de vida (`PAGO`, `CANCELADO`, `EXPIRADO`, `FALHOU`).
- **Imutabilidade contábil**: por convenção da aplicação, quando um pagamento atinge o estado liquidado (`PAGO`), seu valor de entrada (`valor_centavos`) nunca é reduzido nem editado na própria linha.
- **Separação dos reembolsos**: reduções monetárias, cancelamentos e devoluções ao cliente não sobrescrevem o pagamento original; são gravados como registros individuais e aditivos em `pedido_reembolsos`.

<a id="22-additive-refunds-pedidoreembolsos"></a>

### 2.2 Reembolsos aditivos (`pedido_reembolsos`)

- Reembolsos representam eventos financeiros individuais de saída, vinculados diretamente a um pagamento de origem específico.
- Os atributos incluem `pedido_id`, `pagamento_id`, `valor_centavos`, `origem` (`'MERCADO_PAGO'` | `'MANUAL'`), `status` (`'PENDENTE'` | `'REEMBOLSADO'` | `'FALHOU'`) e uma `idempotency_key` única.
- Múltiplos reembolsos parciais podem referenciar o mesmo pagamento, até o valor total recebido.

<a id="23-proportional-payment-allocation-pedidopagamentoalocacoes"></a>

### 2.3 Alocação proporcional dos pagamentos (`pedido_pagamento_alocacoes`)

- Quando um pedido com múltiplos itens é pago, o pagamento é associado a cada item por `pedido_pagamento_alocacoes`.
- Essa alocação registra a distribuição exata dos valores liquidados entre os itens, permitindo acompanhar cancelamento, substituição e reembolso por item sem atribuição ambígua de receita.

---

<a id="3-dynamic-aggregation-model"></a>

## 3. Modelo de agregação dinâmica

Para evitar anomalias causadas por colunas mutáveis de saldo, o saldo líquido e o status de liquidação do pedido são projetados dinamicamente a partir das linhas do ledger:

```sql
SELECT
  p.id,
  p.valor_total_centavos,
  COALESCE(SUM(pg.valor_centavos), 0) AS total_pago_centavos,
  COALESCE(SUM(rb.valor_centavos), 0) AS total_reembolsado_centavos,
  (COALESCE(SUM(pg.valor_centavos), 0) - COALESCE(SUM(rb.valor_centavos), 0)) AS saldo_liquido_centavos
FROM pedidos p
LEFT JOIN pedido_pagamentos pg
  ON pg.pedido_id = p.id AND pg.status = 'PAGO'
LEFT JOIN pedido_reembolsos rb
  ON rb.pedido_id = p.id AND rb.status = 'REEMBOLSADO'
WHERE p.id = ?
GROUP BY p.id;
```

- Um pedido está liquidado quando `saldo_liquido_centavos >= p.valor_total_centavos`.
- Pagamentos excedentes ou saldos parciais são apresentados de forma transparente pela diferença entre créditos e débitos agregados.

---

<a id="4-idempotency-protocol-a1-pattern"></a>

## 4. Protocolo de idempotência (padrão A1)

Mutações financeiras, como criação de pedidos, registro de pagamentos e pedidos de reembolso, evitam gravações duplicadas em novas tentativas e duplicações de rede por meio do padrão de idempotência A1.

<a id="41-client-key-generation-srcliboperationkeyts"></a>

### 4.1 Geração de chave no cliente (`src/lib/operationKey.ts`)

1. O cliente gera uma `operationKey` (UUID v4 ou string formatada estável compatível com `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`) antes da primeira transmissão de rede.
2. A requisição transmite a `operationKey` e o payload ao endpoint da API.
3. O servidor calcula `fingerprint(payload)` com `functions/lib/operacaoIdentity.ts`. O formato é `<version>:<canonical JSON>`, atualmente `1:<canonical JSON>` (`FINGERPRINT_VERSAO = 1`). O helper privado `canonical` ordena recursivamente as chaves dos objetos, omite propriedades de objetos cujo valor é `undefined` e preserva a ordem dos arrays. Os demais valores seguem a semântica de `JSON.stringify`, incluindo `null` e `undefined` em arrays.

Cada chamador seleciona os campos enviados a `fingerprint(payload)`; o helper não seleciona campos nem inclui automaticamente a requisição inteira. Por exemplo, o checkout inclui pares ordenados de ID/quantidade dos itens, `nome`, `whatsapp` e `recado`, mas exclui preços resolvidos pelo servidor. A chave de operação e as verificações de tipo/escopo/ator são separadas dessa identidade do payload.

O fingerprint é uma identidade de payload determinística, canônica e versionada, usada para detectar reutilização incompatível da mesma chave de operação. Não é hash, assinatura, HMAC, mecanismo de autenticação nem proteção criptográfica contra adulteração. A deduplicação usa a chave de operação: payloads idênticos com chaves diferentes continuam sendo operações distintas.

<a id="42-server-side-execution-and-replay-handling-pedidooperacoes"></a>

### 4.2 Execução no servidor e tratamento de replay (`pedido_operacoes`)

O banco mantém um ledger de operações como fonte de autoridade (`migrations/0012_operacoes_idempotencia.sql`):

```sql
CREATE TABLE pedido_operacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  tipo TEXT NOT NULL,
  escopo TEXT NOT NULL,
  ator_usuario_id INTEGER,
  fingerprint_versao INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  fase TEXT NOT NULL DEFAULT 'LOCAL_CRIADA',
  pedido_id INTEGER,
  pagamento_id INTEGER,
  reembolso_id INTEGER,
  resultado TEXT,
  erro TEXT,
  mp_idempotency_key TEXT,
  mp_request TEXT,
  mp_payment_id TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX uq_pedido_operacoes_key ON pedido_operacoes(operation_key);
```

<a id="43-atomic-batch-claim-protocol"></a>

### 4.3 Protocolo de claim atômico em batch

1. **Registro atômico**: a criação dos registros locais de negócio, como `pedidos` e `pedido_pagamentos`, e o claim da operação (`pedido_operacoes` com `fase='LOCAL_CRIADA'`) são executados juntos em uma única transação `env.DB.batch()`.
2. **Resolução de condições de corrida**:
   - Se duas requisições idênticas disputarem a execução, um batch é concluído e ocupa o índice único `uq_pedido_operacoes_key`.
   - A requisição concorrente falha com uma violação de constraint única em `operation_key`, acionando rollback automático de todo o seu batch.
3. **Fluxo de replay**:
   - Em caso de conflito, o handler busca a operação existente por `buscarOperacao`.
   - `conflitoOperacao` verifica a compatibilidade nesta ordem: tipo (`OPERACAO_CONFLITO_TIPO`), escopo e ator (`OPERACAO_CONFLITO_ESCOPO`), depois versão do fingerprint e string exata (`OPERACAO_CONFLITO_PAYLOAD`).
   - Se todas as verificações coincidirem, o servidor reproduz o resultado com segurança, por exemplo, por `replayCheckout`.
   - A reutilização incompatível retorna HTTP `409 Conflict`, bloqueando tentativas de mutação conflitantes. Uma versão diferente do fingerprint também é conflito de payload, nunca payload equivalente.
