<a id="database-migrations-architecture"></a>

# Arquitetura de migrações do banco de dados

<a id="1-engine-and-migration-lifecycle"></a>

## 1. Motor e ciclo de vida das migrações

A camada de persistência usa Cloudflare D1, um banco relacional distribuído e serverless baseado em SQLite. As migrações do banco são armazenadas como arquivos SQL sequenciais em `migrations/`:

```
migrations/
  0001_products.sql
  0002_orders.sql
  ...   (one file per schema change, strictly sequential)
```

<a id="11-sequencing-rules"></a>

### 1.1 Regras de sequenciamento

- Os nomes das migrações seguem um prefixo de quatro dígitos preenchido com zeros, seguido de um identificador descritivo em snake_case (`XXXX_name.sql`).
- A numeração é estritamente contínua, sem lacunas ou duplicações, começando em `0001`. O diretório `migrations/` é a fonte de verdade para o intervalo atual (`ls migrations`).
- As migrações são estritamente forward-only: migrações históricas já aplicadas aos ambientes de deploy nunca são editadas, excluídas ou reordenadas. Qualquer evolução posterior do schema ou correção deve ser introduzida por uma nova migração.

---

<a id="2-additive-schema-evolution"></a>

## 2. Evolução aditiva do schema

Devido às propriedades arquiteturais do SQLite em ambientes edge serverless, a evolução do schema segue uma orientação de projeto aditivo:

1. **Alterações não destrutivas**:
   - Prefira `ALTER TABLE ... ADD COLUMN` com um valor `DEFAULT` seguro ou uma constraint que permita nulos.
   - A descontinuação de colunas ocorre em fases:
     - Fase 1: adicione a nova coluna; atualize o código da aplicação para gravar nas duas e ler da nova.
     - Fase 2: faça o backfill dos dados históricos, se necessário.
     - Fase 3: interrompa o uso da coluna obsoleta.
2. **Valores padrão determinísticos**:
   - Flags numéricas ou valores de status definem valores padrão explícitos (por exemplo, `DEFAULT 0`).
   - Timestamps usam expressões padrão do SQLite (por exemplo, `CURRENT_TIMESTAMP`).
3. **Recriações controladas de tabelas**:
   - Quando limitações do SQLite exigem modificar constraints de colunas ou chaves primárias que `ALTER TABLE` não consegue alterar diretamente, aplica-se a reconstrução da tabela (`table__novo`) com proteções rigorosas de chaves estrangeiras.

---

<a id="3-the-sqlite-foreign-key-cascade-trap"></a>

## 3. A armadilha de cascade das chaves estrangeiras no SQLite

O SQLite garante a integridade referencial por meio de chaves estrangeiras, mas exige tratamento deliberado durante recriações de tabelas.

<a id="31-the-cascade-problem"></a>

### 3.1 O problema do cascade

No SQLite, executar uma recriação de tabela com as chaves estrangeiras ativas pode ter efeitos colaterais destrutivos:

- Se uma tabela filha tem uma chave estrangeira que referencia uma tabela pai com `ON DELETE CASCADE`:
- Executar `DROP TABLE parent;` aciona a regra de cascade e exclui silenciosamente todas as linhas referenciadas nas tabelas filhas.
- Usar `PRAGMA defer_foreign_keys = ON;` adia a validação das constraints até o commit da transação, mas **não impede que `DROP TABLE` execute triggers de cascade**.

<a id="32-safe-table-recreation-procedure"></a>

### 3.2 Procedimento seguro de recriação de tabelas

Ao modificar uma tabela no SQLite de forma que exija recriação (por exemplo, mudar chaves primárias ou ajustar constraints):

```sql
-- 1. Disable foreign key enforcement during the schema rebuild
PRAGMA foreign_keys = OFF;

-- 2. Create the replacement table with the target schema
CREATE TABLE tabela_nova (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ...
);

-- 3. Copy existing data into the new table
INSERT INTO tabela_nova (id, ...)
SELECT id, ...
FROM tabela_antiga;

-- 4. Drop the obsolete table (no cascading deletes triggered)
DROP TABLE tabela_antiga;

-- 5. Rename the new table to the canonical name
ALTER TABLE tabela_nova RENAME TO tabela_antiga;

-- 6. Re-create associated indices and triggers
CREATE INDEX idx_tabela_antiga_ref ON tabela_antiga(ref_id);

-- 7. Re-enable foreign key enforcement
PRAGMA foreign_keys = ON;

-- 8. Verify referential integrity across the entire database
PRAGMA foreign_key_check;
```

---

<a id="4-verification-and-migration-tooling"></a>

## 4. Verificação e ferramentas de migração

A verificação automatizada protege as migrações antes do deploy:

- **Lint estático (`scripts/check-d1-migrations.mjs`)**:
  - Valida a continuidade numérica dos nomes das migrações, sem lacunas.
  - Verifica marcadores de schema, declarações de objetos e padrões seguros de migração em um ambiente Cloudflare D1 simulado.
- **Execução de testes em memória (`tests/check-d1-migrations.test.mjs`)**:
  - Valida os scripts de migração com interfaces REST D1 simuladas e instâncias do Miniflare.
  - Garante que todo o DDL seja executado sem erros de sintaxe, colisões de índices ou falhas de dependências circulares.
