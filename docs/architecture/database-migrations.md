# Database Migrations Architecture

## 1. Engine and Migration Lifecycle

The persistence layer uses Cloudflare D1, a distributed serverless relational database built on SQLite. Database migrations are stored as sequential SQL files under `migrations/`:

```
migrations/
  0001_products.sql
  0002_orders.sql
  ...
  0033_produto_detalhes.sql
```

### 1.1 Sequencing Rules

- Migration filenames adhere to a 4-digit zero-padded prefix followed by a snake_case descriptive identifier (`XXXX_name.sql`).
- Numbering is strictly continuous without gaps or duplicates (currently spanning 33 migrations, from `0001` through `0033`).
- Migrations are strictly forward-only: historical migrations already applied to deployment environments are never edited, deleted, or reordered. Any subsequent schema evolution or bugfix must be introduced via a new migration.

---

## 2. Additive Schema Evolution

Due to the architectural properties of SQLite in serverless edge environments, schema evolution follows an additive design guideline:

1. **Non-Destructive Alterations**:
   - Prefer `ALTER TABLE ... ADD COLUMN` with a safe `DEFAULT` value or nullable constraint.
   - Column deprecations are phased:
     - Phase 1: Add new column; update application code to write to both and read from new.
     - Phase 2: Backfill historical data if needed.
     - Phase 3: Cease usage of the obsolete column.
2. **Deterministic Defaults**:
   - Numeric flags or status values define explicit default values (e.g., `DEFAULT 0`).
   - Timestamps utilize standard SQLite expressions (e.g., `CURRENT_TIMESTAMP`).
3. **Controlled Table Recreations**:
   - When SQLite limitations require modifying column constraints or primary keys that `ALTER TABLE` cannot accomplish directly, table reconstruction (`table__novo`) is applied with strict foreign key safeguards.

---

## 3. The SQLite Foreign Key Cascade Trap

SQLite enforces referential integrity through foreign keys, but requires deliberate handling during table recreations.

### 3.1 The Cascade Problem

In SQLite, executing a table recreation pattern while foreign keys are active can have destructive side effects:

- If a child table has a foreign key referencing a parent table with `ON DELETE CASCADE`:
- Executing `DROP TABLE parent;` triggers the cascade rule and silently deletes all referenced rows in child tables.
- Using `PRAGMA defer_foreign_keys = ON;` defers constraint validation until transaction commit, but **does not prevent `DROP TABLE` from executing cascade triggers**.

### 3.2 Safe Table Recreation Procedure

When modifying a table in SQLite that requires recreation (e.g., changing primary keys or adjusting constraints):

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

## 4. Verification and Migration Tooling

Automated verification protects migrations prior to deployment:

- **Static Linting (`scripts/check-d1-migrations.mjs`)**:
  - Validates numeric continuity of migration filenames without gaps.
  - Verifies schema markers, object declarations, and safe migration patterns against a simulated Cloudflare D1 environment.
- **In-Memory Test Execution (`tests/check-d1-migrations.test.mjs`)**:
  - Validates migration scripts against mock D1 REST interfaces and Miniflare instances.
  - Ensures all DDL executes cleanly without syntax errors, index collisions, or circular dependency failures.
