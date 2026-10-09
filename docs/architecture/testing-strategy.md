<a id="testing-strategy-and-quality-gates"></a>

# Estratégia de testes e critérios de qualidade

<a id="1-test-harness-philosophy"></a>

## 1. Filosofia do harness de testes

A arquitetura de testes da RP Doces prioriza execução rápida, verificação determinística de concorrência e dependências externas mínimas para testes.

<a id="11-core-tooling"></a>

### 1.1 Ferramentas centrais

- **Runner nativo de testes**: os testes usam o runner nativo do Node.js (`node --test`) com assertions padrão (`node:assert/strict`).
- **Formato dos arquivos**: as suítes de testes são escritas como módulos ES (`tests/*.test.mjs`).
- **Execução rápida**: os testes evitam automação pesada de navegador para a lógica central de negócio e executam em memória contra simulações locais do ambiente edge do Cloudflare Workers.

---

<a id="2-in-memory-d1-emulation-with-miniflare"></a>

## 2. Emulação do D1 em memória com Miniflare

O Cloudflare D1 executa SQLite nos nós de edge do Cloudflare Workers. Para testar interações com o banco com precisão, sem acessar a infraestrutura remota da Cloudflare, as suítes executam Miniflare (`tests/helpers/b3.mjs`):

```js
import { Miniflare } from "miniflare";

// Test bridge worker running directly in workerd
const bridge = `export default {
  async fetch(request, env) {
    const { statements } = await request.json();
    try {
      const results = await env.DB.batch(
        statements.map(s => env.DB.prepare(s.sql).bind(...s.args))
      );
      return Response.json({ results });
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
};`;

const mf = new Miniflare({
  modules: true,
  script: bridge,
  cf: false,
  d1Databases: ["DB"],
  d1Persist: false
});
```

<a id="21-dynamic-module-bundling"></a>

### 2.1 Bundling dinâmico de módulos

- Os módulos-fonte da aplicação em `functions/` são empacotados em memória com `esbuild` no início da execução dos testes.
- Isso permite testar rotas reais de produção em TypeScript com a semântica nativa de batch do D1, sem gerar artefatos em disco.

<a id="22-full-migration-application"></a>

### 2.2 Aplicação de todas as migrações

- Antes de executar as assertions, a fixture de teste carrega e executa todas as migrações SQL de `migrations/*.sql` em ordem alfabética.
- As instruções e os corpos dos triggers são extraídos e executados contra o banco D1 em memória, garantindo que os casos de teste usem o schema completo de produção.

---

<a id="3-concurrency-and-race-condition-testing"></a>

## 3. Testes de concorrência e condições de corrida

Ambientes edge frequentemente recebem requisições concorrentes que tentam acessar o mesmo estoque ou pedido. A suíte usa hooks de sincronização determinísticos em vez de timeouts arbitrários.

<a id="31-deterministic-database-hooks"></a>

### 3.1 Hooks determinísticos de banco

Para simular condições de corrida de forma confiável, como dois checkouts disputando o último item disponível ou chaves de idempotência conflitantes:

1. A fixture de teste fornece um mecanismo de hook no wrapper do banco (`db.hook`).
2. Duas requisições são iniciadas simultaneamente (`ambas(req1, req2)`).
3. O hook pausa a execução da primeira requisição após a leitura, permitindo que a segunda avance.
4. Quando a barreira é liberada, ambas tentam suas gravações atômicas em batch simultaneamente, testando constraints `CHECK` do SQLite, colisões de chaves únicas e comportamento de rollback de forma determinística.

---

<a id="4-test-suite-organization"></a>

## 4. Organização da suíte de testes

1. **Idempotência e operações (`tests/a1.test.mjs`)**:
   - Verifica que o replay de chaves de operação idênticas devolve os resultados em cache sem mutações duplicadas.
   - Testa que reutilizar chaves com payloads modificados retorna HTTP `409 Conflict`.
2. **Reconciliação de pagamentos e ledger (`tests/b1*.test.mjs`, `tests/b2*.test.mjs`, `tests/b3*.test.mjs`)**:
   - Valida processamento de webhooks, reconciliação por GET do Mercado Pago e tratamento de reembolsos.
   - Verifica que liquidações de pedidos, pagamentos parciais e linhas de reembolso conservem os valores monetários.
3. **Estoque e gestão de pedidos (`tests/comanda-viva-*.test.mjs`, `tests/stock*.test.mjs`)**:
   - Valida reservas, baixas físicas após a confirmação de pagamento e liberações por cancelamento.
4. **Lint de migrações e schema (`tests/check-d1-migrations.test.mjs`)**:
   - Verifica continuidade da numeração das migrações, marcadores de schema e segurança das consultas somente leitura.

---

<a id="5-quality-verification-gates"></a>

## 5. Critérios de verificação de qualidade

Antes de integrar alterações ou fazer deploy:

- **Continuidade das migrações**: execute `node --test tests/check-d1-migrations.test.mjs` para verificar a integridade das migrações.
- **Checagem de tipos**: execute `npm run typecheck` para verificar o modo estrito do TypeScript em `src/` e `functions/`.
- **Suíte automatizada**: execute `node --test tests/*.test.mjs` para rodar os testes de domínio, integração e UI.
