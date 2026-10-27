# Estratégia de testes e critérios de qualidade

## 1. Princípios da bancada de testes

A arquitetura de testes da R&P Doces foi projetada para execução rápida, verificação determinística de concorrência e uso mínimo de dependências externas de teste.

### 1.1 Ferramentas principais

- **Executor nativo de testes**: os testes usam o executor nativo do Node.js (`node --test`) com asserções padrão (`node:assert/strict`).
- **Formato dos arquivos**: as suítes são escritas como módulos ES (`tests/*.test.mjs`).
- **Execução rápida**: os testes evitam automação pesada de navegador para as regras centrais de negócio, executando em memória contra simulações locais do ambiente de borda do Cloudflare Workers.

---

## 2. Emulação do D1 em memória com Miniflare

O Cloudflare D1 executa SQLite nos nós de borda do Cloudflare Workers. Para testar interações com o banco de forma fiel sem acessar a infraestrutura remota da Cloudflare, as suítes usam Miniflare (`tests/helpers/b3.mjs`):

```js
import { Miniflare } from "miniflare";

// Worker de ponte dos testes, executado diretamente no workerd
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

### 2.1 Empacotamento dinâmico de módulos

- Os módulos-fonte da aplicação em `functions/` são empacotados em memória com `esbuild` no início da execução dos testes.
- Isso permite testar rotas TypeScript reais de produção com a semântica nativa de lotes do D1, sem gerar artefatos em disco.

### 2.2 Aplicação integral das migrações

- Antes de executar as asserções, a fixture de teste carrega e executa todas as migrações SQL de `migrations/*.sql` em ordem alfabética.
- Instruções e corpos de gatilhos são extraídos e executados no D1 em memória, garantindo que os casos rodem contra o schema completo de produção.

---

## 3. Testes de concorrência e condições de corrida

Ambientes de borda frequentemente recebem requisições concorrentes que tentam acessar o mesmo estoque ou pedido. A suíte utiliza pontos de sincronização determinísticos em vez de esperas arbitrárias.

### 3.1 Pontos de interceptação determinísticos no banco

Para simular condições de corrida de forma confiável (como dois checkouts disputando a última unidade ou chaves de idempotência conflitantes):

1. A fixture oferece um mecanismo de interceptação na camada que envolve o banco (`db.hook`).
2. Duas requisições são iniciadas simultaneamente (`ambas(req1, req2)`).
3. A interceptação pausa a primeira requisição após sua fase de leitura, permitindo que a segunda avance.
4. Quando a barreira é liberada, ambas tentam suas gravações atômicas em lote ao mesmo tempo, testando restrições `CHECK` do SQLite, colisões de chaves únicas e comportamento de rollback de forma determinística.

---

## 4. Organização da suíte

1. **Idempotência e operações (`tests/a1.test.mjs`)**:
   - Verifica que repetir chaves de operação idênticas retorna resultados armazenados sem duplicar mutações.
   - Testa que reutilizar chaves com corpos de requisição modificados retorna HTTP `409 Conflict`.
2. **Reconciliação de pagamentos e registro financeiro (`tests/b1*.test.mjs`, `tests/b2*.test.mjs`, `tests/b3*.test.mjs`)**:
   - Valida processamento de webhooks, reconciliação por GET ao Mercado Pago e tratamento de reembolsos.
   - Verifica que liquidações de pedidos, pagamentos parciais e registros de reembolso preservam os valores monetários.
3. **Gestão de estoque e pedidos (`tests/comanda-viva-*.test.mjs`, `tests/stock*.test.mjs`)**:
   - Valida retenção de reservas, baixas físicas após confirmação de pagamento e liberações por cancelamento.
4. **Análise de migrações e schema (`tests/check-d1-migrations.test.mjs`)**:
   - Verifica continuidade da numeração, marcadores de schema e segurança das consultas somente de leitura.

---

## 5. Critérios de verificação de qualidade

Antes de integrar alterações ou implantar:

- **Continuidade das migrações**: execute `node --test tests/check-d1-migrations.test.mjs` para verificar a integridade das migrações.
- **Verificação de tipos**: execute `npm run typecheck` para verificar a tipagem estrita do TypeScript em `src/` e `functions/`.
- **Suíte automatizada**: execute `node --test tests/*.test.mjs` para rodar testes de domínio, integração e interface.
