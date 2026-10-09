<a id="dedicated-staging-environment"></a>

# Ambiente dedicado de staging

> **NUNCA execute reset, DROP ou DELETE contra recursos de produção.**
> Produção usa `rp-doces`, `rp-doces-db`, `rp-doces-images` e `rp-doces-push`.
> Este runbook não autoriza nada automaticamente: provisionamento, secrets,
> migrações, primeiro deploy e qualquer reset são operações manuais separadas.

<a id="architecture-and-isolation"></a>

## Arquitetura e isolamento

| Recurso                   | Staging                   | Configuração                             |
| ------------------------- | ------------------------- | ---------------------------------------- |
| Pages                     | `rp-doces-staging`        | `wrangler.staging.toml`                  |
| D1 / `DB`                 | `rp-doces-db-staging`     | Configurações de Pages e do Worker ativo |
| R2 / `PRODUCT_IMAGES`     | `rp-doces-images-staging` | Configuração de Pages                    |
| Queue / `PUSH_QUEUE`      | `rp-doces-push-staging`   | Produtor em Pages, consumidor no Worker  |
| Worker                    | `rp-doces-push-staging`   | `wrangler.push.staging.toml`             |
| Primeiro bootstrap inerte | `rp-doces-push-staging`   | `wrangler.push.staging.bootstrap.toml`   |

O Worker reutiliza `workers/push.ts`; o bootstrap inerte reutiliza
`workers/push-bootstrap.ts`. Política de entrega, CAS, leases, operações
financeiras, estoque e migrações são idênticos aos de produção. Não é introduzida
uma variação do schema. O consumidor mantém batch de tamanho 1, timeout de 1 segundo,
três retries de Queue e cron de uma vez por minuto. O CI publica apenas Pages;
atualizações do Worker continuam manuais.

Comece com `https://rp-doces-staging.pages.dev`. Confirme a URL do projeto após a
criação; `STAGING_URL` pode selecionar `https://staging.rpdoces.com.br` depois que
DNS, certificado e domínio personalizado do Pages estiverem configurados. O
validador rejeita URLs de produção e credenciais, caminhos ou query strings nessa
variável.

A **branch de produção do projeto Pages separado é `staging`**. A Cloudflare chama
seu slot estável de `production`, embora o ambiente da aplicação seja staging.
Por isso, o verificador de deploy usa `env=production` dentro do projeto
`rp-doces-staging`. Ele nunca consulta o projeto de produção. Use Direct Upload,
sem integração Git que ignore o critério de aprovação do CI no GitHub.

<a id="prerequisites-and-github-configuration"></a>

## Pré-requisitos e configuração do GitHub

Use o Wrangler **3.114.17** fixado no lockfile, Node 24, a conta Cloudflare pretendida
e um checkout limpo com essas configurações de staging. Não atualize o Wrangler
para este procedimento. Os comandos abaixo **não** foram executados remotamente
por esta alteração.

Crie o GitHub Environment `staging`, restringindo as branches de deploy a `staging`.
Preencha os três secrets do ambiente de forma independente:

| Secret do ambiente                 | Finalidade                                             |
| ---------------------------------- | ------------------------------------------------------ |
| `STAGING_CLOUDFLARE_ACCOUNT_ID`    | Conta que contém os recursos de staging                |
| `STAGING_CLOUDFLARE_API_TOKEN`     | Publicação e verificação de deploy do Pages de staging |
| `STAGING_CLOUDFLARE_D1_READ_TOKEN` | Token separado com apenas Account / D1 / Read          |

Variáveis do ambiente:

| Variável                 | Valor                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `STAGING_DEPLOY_ENABLED` | Inicialmente `false`; explicitamente `true` apenas após provisionamento              |
| `STAGING_URL`            | Inicialmente `https://rp-doces-staging.pages.dev`; o valor padrão opcional é o mesmo |

O GitHub expõe variáveis do ambiente após o início do job. A chave de habilitação
é avaliada deliberadamente dentro do job protegido, não no `if` do job. Valores
ausentes ou diferentes de `true` pulam a publicação e geram um resumo.
`DEPLOY_ENABLED` continua exclusivo do job de produção existente.

Staging referencia apenas os três secrets GitHub `STAGING_CLOUDFLARE_*`. Produção
mantém os nomes genéricos originais. Com staging habilitado, qualquer secret de
staging ausente causa falha na primeira verificação, antes da consulta ao HEAD,
instalação, verificação de migrações ou publicação; não há fallback para um secret
genérico de produção. Defina os secrets prefixados no Environment `staging`, usando
tokens emitidos de forma independente e com privilégio mínimo. Nunca coloque
valores de produção sob um nome `STAGING_*` em qualquer escopo do GitHub.

O workflow associa os secrets prefixados do GitHub às variáveis genéricas de
ambiente de processo exigidas pelo Wrangler e pelo verificador de migrações
inalterado. Esses nomes de variáveis de runtime não referenciam secrets GitHub de
produção. A etapa de build de staging define explicitamente a variável não secreta
`VITE_APP_ENV=staging`; produção não a define.

Proteção futura recomendada para branches: exigir o check agregado `CI` em
`staging` e `main`; promover para main as alterações validadas em staging quando
aplicável. Esta tarefa não altera proteções remotas.

<a id="initial-provisioning-exact-order"></a>

## Provisionamento inicial: ordem exata

Mantenha `STAGING_DEPLOY_ENABLED=false` durante todo o provisionamento. Cada comando
abaixo é uma **operação manual futura**. Verifique a identidade da conta antes de
qualquer mutação.

<a id="1-create-d1-and-insert-its-actual-id"></a>

### 1. Criar o D1 e inserir seu ID real

```sh
npx wrangler d1 create rp-doces-db-staging --config wrangler.staging.toml
```

Copie o `database_id` de staging retornado para o bloco `[[d1_databases]]` de
**ambos** os arquivos `wrangler.staging.toml` e `wrangler.push.staging.toml`,
substituindo `STAGING_D1_ID_REPLACE_AFTER_CREATE`. Nunca copie o ID de produção.
O bootstrap não tem binding D1 e não precisa de ID. O placeholder deliberadamente
não é um UUID; `--require-provisioned` o rejeita antes de o CI consultar D1 ou publicar.

```sh
node scripts/check-staging-config.mjs --require-provisioned
npx wrangler d1 migrations apply DB --remote --config wrangler.staging.toml
npx wrangler d1 migrations list DB --remote --config wrangler.staging.toml
```

Aplique **todas** as migrações do repositório, não só a mais recente. São os mesmos
arquivos usados em produção. O CI apenas verifica o histórico/schema remoto;
nunca aplica SQL.

Os dados iniciais opcionais devem ser SQL sintético revisado, com clientes
fictícios, credenciais de teste e arquivos independentes de imagens de teste.
Nunca restaure um dump de produção, importe PII nem copie imagens de produção
automaticamente. Apenas após validar o isolamento:

```sh
npx wrangler d1 execute DB --remote --config wrangler.staging.toml --file /secure/staging-synthetic-seed.sql
```

Prepare esse arquivo separadamente; ele não é fornecido por esta tarefa.
Provisione um administrador dedicado de teste usando a configuração existente
de autenticação e hashes seguros de senha. Não copie administrador/sessão de produção.

<a id="2-create-the-bucket-queue-and-pages-project"></a>

### 2. Criar o bucket, a fila e o projeto Pages

```sh
npx wrangler r2 bucket create rp-doces-images-staging --config wrangler.staging.toml
npx wrangler queues create rp-doces-push-staging --message-retention-period-secs 86400 --config wrangler.staging.toml
npx wrangler queues info rp-doces-push-staging --config wrangler.staging.toml
npx wrangler pages project create rp-doces-staging --production-branch staging
```

A criação da Queue deve solicitar explicitamente **86400 segundos** de retenção.
Omitir essa opção falhou com o plano/CLI de produção atual. Antes da implantação,
é esperado haver zero produtores/consumidores; depois, verifique quantidade de
produtores >= 1 e consumidores = 1, com apenas Pages/Worker de staging conectados.

O TOML de Pages fornece `PRODUCT_IMAGES` e `PUSH_QUEUE` na publicação. Mantenha
o bucket privado; as rotas de imagens existentes da aplicação o servem. Não
reutilize `rp-doces-images`. Envie imagens sintéticas apenas pelo admin de staging.

<a id="3-prepare-independent-vapid-and-sandbox-credentials"></a>

### 3. Preparar VAPID e credenciais sandbox independentes

Gere um novo par VAPID separadamente e com segurança, fora desta tarefa. Ele deve
ser diferente do de produção. Prepare um JSON privado fora do repositório com
exatamente `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Use uma URI de
contato apropriada para staging no subject. Nunca imprima nem commite secrets.

Prepare um JSON privado separado para Pages contendo:

- `MP_ACCESS_TOKEN`: credenciais explicitamente emitidas para integração de teste/sandbox.
- `MP_WEBHOOK_SECRET`: secret de assinatura desta aplicação/webhook de teste independente.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: o **mesmo par de staging**
  provisionado no Worker de staging.

Os endpoints de diagnóstico inspecionados usam `MP_ACCESS_TOKEN` e a autenticação
administrativa comum; atualmente não há secret adicional de diagnóstico a
provisionar. Nunca invente nem copie credenciais de produção. Não coloque secrets
em `VITE_*`.

Configure o webhook de teste em `<STAGING_URL>/api/webhooks/mercadopago`, começando
pelo domínio Pages. Não aponte credenciais/webhooks de teste para `rpdoces.com.br`.
A aplicação usa Orders API. `mp_order_id` armazena ORD e `mp_payment_id` armazena
a transação PAY. Assine o evento **Order** do Mercado Pago; apenas GET
`/v1/orders/{ORD}` fornece autoridade financeira. Chamadas à Payments API foram
removidas dos fluxos ativos. Consulte [o contrato de cutover](MP_ORDERS.md) antes
de habilitar essa integração em um ambiente com pagamentos legados. Confirme o
suporte atual aos fluxos Pix/reembolso/webhook de teste na documentação pertinente
do Mercado Pago antes de depender de simulação manual de pagamento. Provisionar
staging não garante que todas as transições externas de pagamento sandbox possam
ser simuladas. Se um fluxo sandbox não for suportado, mantenha-o desabilitado e
use mocks/testes locais determinísticos; nunca substitua por token de produção
nem pagamento real para contornar uma limitação do sandbox.

Só o TOML de Pages de staging define a variável não secreta `MP_TEST_MODE=orders_pix`.
As Functions selecionam explicitamente o pagador oficial do simulador
(`test_user_br@testuser.com`, `first_name=APRO`) para checkout, Pix administrativo
e diagnósticos. As configurações de produção omitem essa variável e preservam o
pagador real; formatos de token, hostnames e `VITE_APP_ENV` nunca selecionam esse
modo do servidor. `BR` e `BRA` identificam o Brasil. A flag não provisiona
credenciais nem garante disponibilidade de busca/reembolso. Reembolsos parciais
iguais usam um conjunto REF persistido antes do envio e uma diferença única,
não apenas o valor. Um retry por idempotência após 409 mantém a chave e reconcilia
por GET. Linhas legadas continuam fail-closed, mas não podem ocupar o batch de
varredura Orders; o cutover de produção ainda exige concluir/reconciliar cobranças
legadas e intenções de reembolso.

<a id="4-bootstrap-the-inert-worker-then-activate-it"></a>

### 4. Fazer bootstrap do Worker inerte e depois ativá-lo

Comandos de secrets do Wrangler 3.114.17 podem publicar uma versão imediatamente.
**Somente no primeiro provisionamento**, use o bootstrap inerte sem D1, consumidor
de Queue nem cron:

```sh
npx wrangler deploy --config wrangler.push.staging.bootstrap.toml
npx wrangler secret bulk /secure/staging-vapid.json --config wrangler.push.staging.bootstrap.toml
npx wrangler secret list --config wrangler.push.staging.bootstrap.toml
```

Pare, a menos que o comando bulk reporte três sucessos e que os nomes/valores
independentes de origem tenham sido validados. Nomes sozinhos não comprovam um par
de chaves válido. Nunca use essa configuração de bootstrap em um Worker já ativo:
ela desconecta seu consumidor/cron. Não execute comandos de secrets sequenciais
contra o consumidor ativo.

```sh
npx wrangler deploy --config wrangler.push.staging.toml --keep-vars
npx wrangler secret list --config wrangler.push.staging.toml
npx wrangler queues info rp-doces-push-staging --config wrangler.staging.toml
npx wrangler pages secret bulk /secure/staging-pages.json --project-name rp-doces-staging
npx wrangler pages secret list --project-name rp-doces-staging
```

Verifique o nome do Worker, D1 de staging, fila, cron e os três secrets VAPID.
O bootstrap deve terminar antes do deploy do consumidor ativo. Em releases
posteriores do código do Worker, valide o isolamento e use a configuração ativa
com `--keep-vars`; não repita o bootstrap. Releases de Pages e Worker são operações
separadas.

<a id="5-validate-schema-with-a-read-only-token"></a>

### 5. Validar o schema com token somente leitura

Em um shell configurado com conta e token de leitura **exclusivos de staging**:

```powershell
$env:WRANGLER_TOML = 'wrangler.staging.toml'
$env:D1_DATABASE_ID = '<actual-staging-database-id>'
$env:CLOUDFLARE_API_TOKEN = ''
node scripts/check-d1-migrations.mjs
```

Para essa operação manual da CLI, forneça as variáveis genéricas de processo
`CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_D1_READ_TOKEN` com as credenciais de staging
correspondentes a `STAGING_CLOUDFLARE_ACCOUNT_ID` e `STAGING_CLOUDFLARE_D1_READ_TOKEN`
do GitHub. Use o mecanismo aprovado de secrets; não cole valores no histórico do
shell. Exija histórico íntegro e verificação bem-sucedida do schema mais recente.
O texto da CLI de verificação de migrações existente pode dizer "production";
a configuração/ID explícitos determinam o destino real de staging.

<a id="6-enable-the-first-pages-deployment"></a>

### 6. Habilitar o primeiro deploy de Pages

Commite os dois IDs D1 reais de staging por um PR revisado, faça merge para
`staging`, depois defina a variável `STAGING_DEPLOY_ENABLED=true` no Environment
`staging` e acione um novo push para essa branch. Também é possível reexecutar um
run após habilitar a variável se seu SHA continuar sendo o HEAD da branch.
Todo o CI deve passar primeiro.

O job de staging verifica credenciais e HEAD, instala as dependências fixadas no
lockfile, valida o isolamento de recursos, verifica migrações somente leitura,
compila com `VITE_APP_ENV=staging`, verifica o HEAD novamente, envia para
`rp-doces-staging`, verifica SHA completo/sucesso pela API Cloudflare e depois
executa a suíte smoke somente leitura. Runs substituídos/desabilitados não
publicam. Se o HEAD avançar durante o build, verificação e smoke são pulados,
a menos que esse run tenha realizado o upload.

**Wrangler Pages 3.114.17 rejeita `--config`.** Imediatamente antes do upload,
o job copia `wrangler.staging.toml` para `wrangler.toml` no checkout descartável.
Isso não modifica a configuração de produção commitada. O comando de upload
suportado é:

```sh
npx wrangler pages deploy dist --project-name rp-doces-staging --branch staging --commit-hash "$GITHUB_SHA" --commit-dirty=false
```

Nunca o execute manualmente no checkout normal com configuração de produção.
Prefira o job do CI; qualquer release manual excepcional deve usar um checkout
limpo e descartável de staging, preparar sua configuração ali e passar pelas
mesmas verificações de isolamento/migrações/HEAD/build. Nenhum comando de deploy
deste documento foi executado como parte da preparação do repositório.

<a id="smoke-and-post-deploy-checklist"></a>

## Smoke e checklist pós-deploy

```powershell
$env:SMOKE_BASE_URL = 'https://rp-doces-staging.pages.dev'
node scripts/smoke-production.mjs
```

O script inalterado usa apenas GET: HTML/asset, catálogo, configuração da loja,
rejeição de admin não autenticado e comportamento de rota ausente. Não testa
gravações, pagamentos externos, uploads nem entrega de push. Exija:

- SHA e URL do projeto corretos na Cloudflare e no resumo de deploy do GitHub.
- Badge `STAGING` visível no admin autenticado; ausente de builds de produção.
- Bindings D1/R2/Queue isolados e nenhum endpoint/chave de produção em staging.
- Produtor da Queue >= 1, consumidor = 1; cron saudável do Worker uma vez por minuto.
- Acesso do admin de teste e upload de catálogo/imagens sintéticas funcionando apenas em staging.
- Assinatura VAPID/notificação de teste independente; inspeção dos logs sanitizados do Worker.
- Testes de pagamento/webhook sandbox apenas onde houver suporte; nenhuma cobrança financeira real.
- Nenhuma publicação automática por integração Git fora desse workflow protegido.

<a id="safe-staging-reset"></a>

## Reset seguro de staging

Não forneça scripts destrutivos genéricos. Use o painel da Cloudflare para um
reset aprovado separadamente e revisado manualmente **apenas de `rp-doces-db-staging`**.
Primeiro defina `STAGING_DEPLOY_ENABLED=false`, pare o consumidor/cron de staging
e isole o tráfego para impedir replay de mensagens da Queue contra IDs recriados.
Descarte mensagens da Queue de staging ou recrie **somente** a fila de staging
antes de retomar. Registre o ID D1 atual de staging e compare-o com ambas as
configurações e o painel; exija uma segunda revisão confirmando que o ID/nome de
produção não foi selecionado.

Se recriar o D1, atualize ambos os IDs de staging, aplique todas as migrações,
restaure apenas dados sintéticos, reconstrua/valide bindings, publique novamente
o Worker de staging e repita o checklist de schema/smoke antes de reabilitar a
publicação. Assinaturas existentes de autenticação/push devem ser restabelecidas.
Nunca exclua recursos D1/R2/Queue/Worker/Pages de produção.

<a id="troubleshooting-and-local-validation-limits"></a>

## Diagnóstico de problemas e limites da validação local

- Placeholder rejeitado: insira o UUID do D1 de staging recém-criado em ambas as configurações.
- Deploy pulado: verifique a chave do Environment `staging`, a branch e o HEAD atual.
- Credenciais ausentes: preencha todos os secrets do ambiente de staging; não use secrets de produção do repositório como fallback. A disponibilidade do recurso de ambientes no plano GitHub é pré-requisito do provisionamento.
- Migration guard bloqueado: aplique manualmente as migrações ausentes de staging com sua configuração explícita e tente novamente. Nunca adicione aplicação de migrações ao CI.
- Badge ausente: o build de staging deve receber `VITE_APP_ENV=staging`; mudar uma variável de Pages no servidor após o build não altera o bundle compilado.
- Verificador de API não encontra o SHA: a branch de produção de Pages deve ser `staging`; verifique o slot estável do projeto separado, permissões do token e propagação na Cloudflare.
- Smoke do domínio personalizado falha: mantenha `STAGING_URL` em Pages até DNS/TLS estarem prontos.
- Push ausente: verifique o par VAPID independente nos dois serviços, admin ativo, bindings da Queue, backlog e cron do Worker; não altere invariantes de entrega.
- Criação de Queue falha: especifique explicitamente `--message-retention-period-secs 86400`.

O `deploy --dry-run` do Worker gera o bundle com segurança, sem publicação remota.
O deploy de Pages **não tem dry-run** na versão instalada. A validação de Pages
se limita à interpretação local da configuração Wrangler, testes de bindings/
isolamento e compilação da aplicação; existência de recursos, permissões da conta
e comportamento real do runtime exigem a implantação manual futura. A validação
local deve usar diretório temporário vazio e diretório de configurações do
Wrangler isolado para evitar ler `.dev.vars` ou credenciais privadas. A validação
do Vite deve usar `envDir` temporário se puderem existir arquivos `.env*` privados.

Durante essa alteração, quatro testes CLI existentes do migration guard abortaram
no encerramento de processos filhos em Node 24.19 / Windows com uma assertion nativa
`UV_HANDLE_CLOSING` (saída 3221226505 em vez do código de bloqueio esperado).
A repetição isolada reproduziu o problema; o guard e esses testes ficaram
inalterados. Não considere essa validação local totalmente aprovada: reexecute a
suíte inalterada no runner Linux do CI e investigue separadamente a falha nativa
do runtime.

Referências: [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/),
[ambientes de deploy do GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[integração Pix com Mercado Pago Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/websites/pix).
