# Arquitetura das migrações do banco de dados

## 1. Mecanismo e ciclo de vida das migrações

A camada de persistência usa Cloudflare D1, um banco relacional distribuído sem servidor baseado em SQLite. As migrações do banco são armazenadas como arquivos SQL sequenciais em `migrations/`:

```
migrations/
  0001_products.sql
  0002_orders.sql
  ...   (um arquivo por alteração de schema, em sequência estrita)
```

### 1.1 Regras de sequência

- Os nomes dos arquivos seguem um prefixo de quatro dígitos preenchido com zeros, seguido de um identificador descritivo em snake_case (`XXXX_name.sql`).
- A numeração é contínua, sem lacunas ou duplicatas, começando em `0001`. O diretório `migrations/` é a fonte da verdade para o intervalo atual (`ls migrations`).
- As migrações evoluem somente para a frente: migrações históricas já aplicadas nos ambientes de implantação nunca são editadas, excluídas ou reordenadas. Qualquer evolução posterior do schema ou correção deve ser introduzida por uma nova migração.

---

## 2. Evolução aditiva do schema

Devido às propriedades arquiteturais do SQLite em ambientes de borda sem servidor, a evolução do schema segue uma diretriz de projeto aditivo:

1. **Alterações não destrutivas**:
   - Prefira `ALTER TABLE ... ADD COLUMN` com valor `DEFAULT` seguro ou permissão de valor nulo.
   - A descontinuação de colunas ocorre em etapas:
     - Etapa 1: adicionar a nova coluna; atualizar a aplicação para escrever nas duas e ler da nova.
     - Etapa 2: preencher os dados históricos, se necessário.
     - Etapa 3: interromper o uso da coluna obsoleta.
2. **Valores padrão determinísticos**:
   - Indicadores numéricos e valores de status definem padrões explícitos (por exemplo, `DEFAULT 0`).
   - Timestamps usam expressões padrão do SQLite (por exemplo, `CURRENT_TIMESTAMP`).
3. **Recriações controladas de tabelas**:
   - Quando limitações do SQLite exigem modificar restrições de coluna ou chaves primárias que `ALTER TABLE` não consegue alterar diretamente, aplica-se reconstrução de tabela (`table__novo`) com proteções rigorosas de chaves estrangeiras.

---

## 3. A armadilha da exclusão em cascata com chaves estrangeiras no SQLite

O SQLite garante integridade referencial por chaves estrangeiras, mas exige tratamento deliberado durante recriações de tabelas.

### 3.1 O problema da cascata

No SQLite, recriar tabelas com chaves estrangeiras ativas pode ter efeitos destrutivos:

- Se uma tabela filha tem chave estrangeira referenciando uma tabela pai com `ON DELETE CASCADE`:
- Executar `DROP TABLE parent;` aciona a regra de cascata e exclui silenciosamente todas as linhas referenciadas nas tabelas filhas.
- Usar `PRAGMA defer_foreign_keys = ON;` adia a validação das restrições até o commit da transação, mas **não impede que `DROP TABLE` execute os gatilhos de cascata**.

### 3.2 Procedimento seguro de recriação de tabela

Ao modificar uma tabela SQLite de forma que exija recriação (por exemplo, alterar chaves primárias ou ajustar restrições):

```sql
-- 1. Desativar a verificação de chaves estrangeiras durante a reconstrução do schema
PRAGMA foreign_keys = OFF;

-- 2. Criar a tabela substituta com o schema desejado
CREATE TABLE tabela_nova (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ...
);

-- 3. Copiar os dados existentes para a nova tabela
INSERT INTO tabela_nova (id, ...)
SELECT id, ...
FROM tabela_antiga;

-- 4. Excluir a tabela obsoleta (sem acionar exclusões em cascata)
DROP TABLE tabela_antiga;

-- 5. Renomear a nova tabela para o nome canônico
ALTER TABLE tabela_nova RENAME TO tabela_antiga;

-- 6. Recriar os índices e gatilhos associados
CREATE INDEX idx_tabela_antiga_ref ON tabela_antiga(ref_id);

-- 7. Reativar a verificação de chaves estrangeiras
PRAGMA foreign_keys = ON;

-- 8. Verificar a integridade referencial de todo o banco
PRAGMA foreign_key_check;
```

---

## 4. Verificação e ferramentas de migração

A verificação automatizada protege as migrações antes da implantação:

- **Análise estática (`scripts/check-d1-migrations.mjs`)**:
  - Valida a continuidade numérica dos nomes dos arquivos, sem lacunas.
  - Verifica marcadores de schema, declarações de objetos e padrões seguros de migração em um ambiente Cloudflare D1 simulado.
- **Execução de testes em memória (`tests/check-d1-migrations.test.mjs`)**:
  - Valida scripts de migração contra interfaces REST D1 simuladas e instâncias Miniflare.
  - Garante que todo DDL execute sem erros de sintaxe, colisões de índices ou falhas de dependência circular.
