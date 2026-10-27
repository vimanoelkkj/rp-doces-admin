# Arquitetura do registro financeiro

## 1. Princípios e invariantes

O domínio financeiro da R&P Doces segue os princípios de um registro financeiro (ledger): recebimentos e desembolsos históricos são registrados como fatos individuais. As posições financeiras são derivadas dinamicamente, em vez de sobrescrever registros históricos.

### 1.1 Centavos inteiros (`*_centavos`)

Todos os valores monetários do código, schema do banco, APIs e cálculos no cliente são representados em centavos inteiros (`INTEGER` no SQLite e `number` no TypeScript restrito ao domínio inteiro):

```sql
valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0)
```

- **Banco de dados**: as definições do schema impõem `INTEGER NOT NULL` e `CHECK (valor_centavos > 0)`.
- **Aplicação**: tipos de ponto flutuante (`REAL`, `FLOAT`) são evitados por convenção. As interfaces TypeScript representam moeda em centavos inteiros.
- **Apresentação**: a formatação de exibição (conversão de centavos inteiros para textos monetários em BRL) ocorre exclusivamente na fronteira da interface, usando `Intl.NumberFormat`.
- **Regra de arredondamento**: cálculos intermediários que exigem divisão (como descontos por item ou alocações parciais) aplicam regras explícitas de arredondamento inteiro (`Math.round` ou cascatas de floor/ceil) para garantir a conservação dos centavos.

---

## 2. Estrutura do schema financeiro

O estado financeiro de um pedido é distribuído entre tabelas dedicadas:

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

### 2.1 Imutabilidade e ciclo de vida dos pagamentos (`pedido_pagamentos`)

- **Transições do ciclo de vida**: linhas de `pedido_pagamentos` são criadas com `status = 'PENDENTE'` e avançam pelo ciclo (`PAGO`, `CANCELADO`, `EXPIRADO`, `FALHOU`).
- **Imutabilidade contábil**: por convenção da aplicação, quando uma linha de pagamento chega ao estado liquidado (`PAGO`), seu valor recebido (`valor_centavos`) nunca é reduzido nem editado diretamente.
- **Separação dos reembolsos**: reduções monetárias, cancelamentos e devoluções a clientes não sobrescrevem a linha original de pagamento; são gravados como registros individuais e aditivos em `pedido_reembolsos`.

### 2.2 Reembolsos aditivos (`pedido_reembolsos`)

- Reembolsos representam eventos financeiros individuais de saída, ligados diretamente a um pagamento de origem específico.
- Os atributos incluem `pedido_id`, `pagamento_id`, `valor_centavos`, `origem` (`'MERCADO_PAGO'` | `'MANUAL'`), `status` (`'PENDENTE'` | `'REEMBOLSADO'` | `'FALHOU'`) e uma `idempotency_key` única.
- Vários reembolsos parciais podem referenciar o mesmo pagamento, até o limite total recebido.

### 2.3 Alocação proporcional de pagamentos (`pedido_pagamento_alocacoes`)

- Quando um pedido com vários itens é pago, o pagamento é associado aos itens individuais por `pedido_pagamento_alocacoes`.
- Essa alocação registra a distribuição exata dos valores liquidados entre os itens, permitindo rastrear cancelamentos, substituições e reembolsos por item sem ambiguidade na atribuição da receita.

---

## 3. Modelo de agregação dinâmica

Para evitar anomalias de dados decorrentes de colunas de saldo mutáveis, o saldo líquido e o status de liquidação do pedido são projetados dinamicamente a partir dos registros financeiros:

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
- Pagamentos excedentes ou saldos parciais são expostos de forma transparente pela diferença entre créditos e débitos agregados.

---

## 4. Protocolo de idempotência (padrão A1)

Mutações financeiras (criação de pedido, registro de pagamento e solicitação de reembolso) evitam gravações duplicadas em novas tentativas e duplicações de rede por meio do padrão de idempotência A1.

### 4.1 Geração da chave no cliente (`src/lib/operationKey.ts`)

1. O cliente gera uma `operationKey` (UUID v4 ou texto estável no formato `^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$`) antes da primeira transmissão de rede.
2. A requisição envia `operationKey` e o corpo de dados ao endpoint da API.
3. O servidor calcula `fingerprint(payload)` de `functions/lib/operacaoIdentity.ts`. O formato é `<version>:<canonical JSON>`, atualmente `1:<canonical JSON>` (`FINGERPRINT_VERSAO = 1`). A função auxiliar privada `canonical` ordena recursivamente as chaves dos objetos, omite propriedades cujo valor é `undefined` e preserva a ordem dos arrays. Os demais valores seguem a semântica de `JSON.stringify`, incluindo `null` e `undefined` em arrays.

Cada ponto de chamada seleciona os campos passados a `fingerprint(payload)`; a função auxiliar não seleciona campos nem inclui automaticamente a requisição inteira. Por exemplo, o checkout inclui pares ordenados de ID/quantidade dos itens, `nome`, `whatsapp` e `recado`, mas exclui preços resolvidos pelo servidor. A chave de operação e as verificações de tipo/escopo/ator são separadas dessa identidade dos dados.

O fingerprint é uma identidade determinística, canônica e versionada dos dados, usada para detectar reutilização incompatível da mesma chave de operação. Não é hash, assinatura, HMAC, mecanismo de autenticação nem proteção criptográfica contra adulteração. A deduplicação usa a chave de operação: dados idênticos com chaves diferentes continuam sendo operações distintas.

### 4.2 Execução no servidor e tratamento de reexecução (`pedido_operacoes`)

O banco mantém um registro autoritativo de operações (`migrations/0012_operacoes_idempotencia.sql`):

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

### 4.3 Protocolo de aquisição atômica em lote

1. **Registro atômico**: a criação dos registros locais de negócio (por exemplo, `pedidos` e `pedido_pagamentos`) e a aquisição da operação (`pedido_operacoes` com `fase='LOCAL_CRIADA'`) são executadas juntas em uma única transação `env.DB.batch()`.
2. **Resolução de concorrência**:
   - Se duas requisições idênticas disputam a operação, um lote tem sucesso e adquire o índice único `uq_pedido_operacoes_key`.
   - A requisição concorrente falha por violação de unicidade em `operation_key`, provocando rollback automático de todo o seu lote.
3. **Fluxo de reexecução**:
   - Em caso de conflito, o handler busca a operação existente por `buscarOperacao`.
   - `conflitoOperacao` verifica a compatibilidade nesta ordem: tipo (`OPERACAO_CONFLITO_TIPO`), escopo e ator (`OPERACAO_CONFLITO_ESCOPO`), depois versão e texto exato do fingerprint (`OPERACAO_CONFLITO_PAYLOAD`).
   - Se todas as verificações coincidirem, o servidor retorna com segurança o resultado anterior (por exemplo, via `replayCheckout`).
   - Reutilização incompatível retorna HTTP `409 Conflict`, bloqueando tentativas de mutação conflitantes. Uma versão diferente do fingerprint também é um conflito de dados, nunca um corpo equivalente.
