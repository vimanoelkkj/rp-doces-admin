# Ambiente dedicado de homologação (staging)

> **NUNCA execute reset, DROP ou DELETE em recursos de produção.**
> Produção corresponde a `rp-doces`, `rp-doces-db`, `rp-doces-images` e `rp-doces-push`.
> Este guia não autoriza nada automaticamente: provisionamento, segredos, migrações,
> primeira implantação e qualquer reinicialização são operações manuais separadas.

## Arquitetura e isolamento

| Recurso               | Homologação               | Configuração                             |
| --------------------- | ------------------------- | ---------------------------------------- |
| Pages                 | `rp-doces-staging`        | `wrangler.staging.toml`                  |
| D1 / `DB`             | `rp-doces-db-staging`     | Configurações de Pages e do Worker ativo |
| R2 / `PRODUCT_IMAGES` | `rp-doces-images-staging` | Configuração do Pages                    |
| Fila / `PUSH_QUEUE`   | `rp-doces-push-staging`   | Produtor Pages, consumidor Worker        |
| Worker                | `rp-doces-push-staging`   | `wrangler.push.staging.toml`             |
| Inicialização inerte  | `rp-doces-push-staging`   | `wrangler.push.staging.bootstrap.toml`   |

O Worker reutiliza `workers/push.ts`; a inicialização inerte reutiliza
`workers/push-bootstrap.ts`. Política de entrega, CAS, concessões temporárias,
operações financeiras, estoque e migrações são idênticos aos de produção.
Não é introduzida uma variante do schema. O consumidor mantém lote de uma mensagem,
timeout de um segundo, três novas tentativas na fila e cron a cada minuto.
O CI implanta somente Pages; atualizações do Worker continuam manuais.

Comece com `https://rp-doces-staging.pages.dev`. Confirme a URL do projeto após
a criação; `STAGING_URL` pode depois selecionar `https://staging.rpdoces.com.br`
quando DNS, certificado e domínio personalizado do Pages estiverem configurados.
O validador rejeita URLs de produção, credenciais, caminhos ou parâmetros de consulta
nessa variável.

A **branch de produção do projeto Pages separado é `staging`**. A Cloudflare chama
seu slot estável de `production`, embora o ambiente da aplicação seja homologação.
Por isso, o verificador de implantação usa `env=production` dentro do projeto
`rp-doces-staging`. Ele nunca consulta o projeto de produção.
Use envio direto (Direct Upload), sem integração Git que contorne o bloqueio do CI
no GitHub.

## Pré-requisitos e configuração do GitHub

Use o Wrangler **3.114.17** fixado no projeto, Node 24, a conta Cloudflare pretendida
e um checkout limpo com essas configurações de homologação. Não atualize o Wrangler
para este procedimento. Os comandos abaixo **não** foram executados remotamente
por esta alteração.

Crie o ambiente (Environment) `staging` no GitHub, restringindo as branches de
implantação a `staging`. Cadastre os três segredos do ambiente de forma independente:

| Segredo do ambiente                | Finalidade                                                      |
| ---------------------------------- | --------------------------------------------------------------- |
| `STAGING_CLOUDFLARE_ACCOUNT_ID`    | Conta que contém os recursos de homologação                     |
| `STAGING_CLOUDFLARE_API_TOKEN`     | Publicação do Pages de homologação e verificação da implantação |
| `STAGING_CLOUDFLARE_D1_READ_TOKEN` | Token separado, somente com Account / D1 / Read                 |

Variáveis de ambiente:

| Variável                 | Valor                                                                          |
| ------------------------ | ------------------------------------------------------------------------------ |
| `STAGING_DEPLOY_ENABLED` | Inicialmente `false`; explicitamente `true` somente após provisionar           |
| `STAGING_URL`            | Inicialmente `https://rp-doces-staging.pages.dev`; o padrão opcional é o mesmo |

O GitHub expõe variáveis do ambiente após o início do job. O controle de habilitação
é avaliado deliberadamente dentro do job protegido, não em seu `if` externo.
Ausência do controle ou valor diferente de `true` pula a publicação e registra
um resumo. `DEPLOY_ENABLED` continua exclusivo do job de produção existente.

Homologação referencia somente os três segredos GitHub `STAGING_CLOUDFLARE_*`.
Produção mantém os nomes genéricos originais. Com homologação habilitada, qualquer
segredo ausente faz a primeira verificação falhar antes de consultar HEAD, instalar,
verificar migrações ou publicar; não há alternativa que use um segredo genérico de
produção. Defina os segredos prefixados no ambiente `staging`, com tokens emitidos
independentemente e de privilégio mínimo. Nunca coloque valores de produção sob
um nome `STAGING_*` em qualquer escopo do GitHub.

O workflow mapeia os segredos GitHub prefixados para as variáveis genéricas de
processo exigidas pelo Wrangler e pelo verificador de migrações inalterado. Esses
nomes de variáveis de execução não referenciam segredos GitHub de produção.
O build de homologação define explicitamente `VITE_APP_ENV=staging`, que não é
segredo; produção não define essa variável.

Proteção de branch recomendada para o futuro: exigir o check agregado `CI` tanto
em `staging` quanto em `main`; promover para main as alterações validadas em
homologação quando aplicável. Esta tarefa não altera proteções remotas.

## Provisionamento inicial: ordem exata

Mantenha `STAGING_DEPLOY_ENABLED=false` durante todo o provisionamento. Cada comando
abaixo é uma **operação manual futura**. Verifique a identidade da conta antes de
qualquer mutação.

### 1. Criar o D1 e inserir seu ID real

```sh
npx wrangler d1 create rp-doces-db-staging --config wrangler.staging.toml
```

Copie o `database_id` de homologação retornado para o bloco `[[d1_databases]]` de
**ambos** os arquivos `wrangler.staging.toml` e `wrangler.push.staging.toml`, substituindo
`STAGING_D1_ID_REPLACE_AFTER_CREATE`. Nunca copie o ID de produção. A inicialização
inerte não tem vínculo D1 e não precisa de ID. O marcador deliberadamente não é
um UUID; `--require-provisioned` o recusa antes que o CI consulte o D1 ou publique.

```sh
node scripts/check-staging-config.mjs --require-provisioned
npx wrangler d1 migrations apply DB --remote --config wrangler.staging.toml
npx wrangler d1 migrations list DB --remote --config wrangler.staging.toml
```

Aplique **todas** as migrações do repositório, não apenas a mais recente. São os
mesmos arquivos usados por produção. O CI só confere histórico/schema remoto;
nunca aplica SQL.

Dados iniciais opcionais devem ser SQL sintético revisado, com clientes fictícios,
credenciais de teste e arquivos de imagem independentes para teste. Nunca restaure
um dump de produção, importe dados pessoais identificáveis ou copie imagens de
produção automaticamente. Somente após validar o isolamento:

```sh
npx wrangler d1 execute DB --remote --config wrangler.staging.toml --file /secure/staging-synthetic-seed.sql
```

Prepare esse arquivo separadamente; ele não é fornecido por esta tarefa. Provisione
um administrador de teste dedicado usando a configuração de autenticação existente
do projeto e hashes de senha seguros. Não copie administrador/sessão de produção.

### 2. Criar o bucket, a fila e o projeto Pages

```sh
npx wrangler r2 bucket create rp-doces-images-staging --config wrangler.staging.toml
npx wrangler queues create rp-doces-push-staging --message-retention-period-secs 86400 --config wrangler.staging.toml
npx wrangler queues info rp-doces-push-staging --config wrangler.staging.toml
npx wrangler pages project create rp-doces-staging --production-branch staging
```

A criação da fila deve solicitar explicitamente **86400 segundos** de retenção.
Omitir essa opção causou falha com o plano/CLI de produção atual. Antes da implantação,
é esperado haver zero produtores/consumidores; depois, confira quantidade de
produtores >= 1 e consumidores = 1, com apenas Pages/Worker de homologação vinculados.

O TOML do Pages fornece `PRODUCT_IMAGES` e `PUSH_QUEUE` na publicação. Mantenha o
bucket privado; as rotas de imagens existentes na aplicação servem seu conteúdo.
Não reutilize `rp-doces-images`. Envie imagens sintéticas somente pelo admin de
homologação.

### 3. Preparar VAPID independente e credenciais de testes isolados

Gere um novo par VAPID separadamente e com segurança, fora desta tarefa. Ele deve
ser diferente do de produção. Prepare um JSON privado fora do repositório com
exatamente `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`. Use uma URI de
contato apropriada para homologação como subject. Nunca imprima nem versione segredos.

Prepare um JSON privado separado para o Pages contendo:

- `MP_ACCESS_TOKEN`: credenciais emitidas explicitamente para integração de teste/sandbox.
- `MP_WEBHOOK_SECRET`: segredo de assinatura desta aplicação/webhook de teste independente.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: o **mesmo par de homologação**
  provisionado no Worker de homologação.

Os endpoints de diagnóstico inspecionados usam `MP_ACCESS_TOKEN` e autenticação
administrativa comum; atualmente não há segredo adicional de diagnóstico para
provisionar. Nunca invente nem copie credenciais de produção. Não coloque segredos
em `VITE_*`.

Configure o webhook de teste em `<STAGING_URL>/api/webhooks/mercadopago`, começando
pelo domínio Pages. Não aponte credenciais/webhooks de teste para `rpdoces.com.br`.
A aplicação usa a Payments API, não a Orders API. Confirme o suporte atual a testes
dos fluxos Pix/reembolso/webhook na documentação correspondente do Mercado Pago
antes de depender de simulação manual de pagamento. Provisionar homologação não
garante que todas as transições externas de pagamento no sandbox possam ser simuladas.
Se um fluxo não tiver suporte no sandbox, mantenha-o desativado e use simulações/testes
locais determinísticos; nunca substitua por token de produção ou pagamento real
para contornar uma limitação do sandbox.

### 4. Inicializar o Worker inerte e depois ativá-lo

Comandos de segredos do Wrangler 3.114.17 podem publicar uma versão imediatamente.
**Somente no primeiro provisionamento**, use a inicialização inerte, sem D1,
consumidor de fila ou cron:

```sh
npx wrangler deploy --config wrangler.push.staging.bootstrap.toml
npx wrangler secret bulk /secure/staging-vapid.json --config wrangler.push.staging.bootstrap.toml
npx wrangler secret list --config wrangler.push.staging.bootstrap.toml
```

Pare se o comando em lote não informar três sucessos ou se os nomes e valores de
origem independentes não tiverem sido validados. Nomes sozinhos não comprovam um
par de chaves válido. Nunca use essa configuração de inicialização em um Worker já
ativo: ela desconecta seu consumidor/cron. Não execute comandos sequenciais de
segredos no consumidor ativo.

```sh
npx wrangler deploy --config wrangler.push.staging.toml --keep-vars
npx wrangler secret list --config wrangler.push.staging.toml
npx wrangler queues info rp-doces-push-staging --config wrangler.staging.toml
npx wrangler pages secret bulk /secure/staging-pages.json --project-name rp-doces-staging
npx wrangler pages secret list --project-name rp-doces-staging
```

Verifique nome do Worker, D1 de homologação, fila, cron e os três segredos VAPID.
A inicialização deve terminar antes da implantação do consumidor ativo. Em versões
posteriores do Worker, valide o isolamento e use a configuração ativa com
`--keep-vars`; não repita a inicialização. Publicações de Pages e Worker são operações
separadas.

### 5. Validar o schema com token somente de leitura

Em um shell configurado com conta e token de leitura **exclusivos de homologação**:

```powershell
$env:WRANGLER_TOML = 'wrangler.staging.toml'
$env:D1_DATABASE_ID = '<actual-staging-database-id>'
$env:CLOUDFLARE_API_TOKEN = ''
node scripts/check-d1-migrations.mjs
```

Para essa operação manual de CLI, forneça as variáveis genéricas de processo
`CLOUDFLARE_ACCOUNT_ID` e `CLOUDFLARE_D1_READ_TOKEN` com as credenciais de homologação
correspondentes a `STAGING_CLOUDFLARE_ACCOUNT_ID` e `STAGING_CLOUDFLARE_D1_READ_TOKEN`
do GitHub. Use o mecanismo aprovado de segredos; não cole valores no histórico
do shell. Exija histórico sem inconsistências e verificação bem-sucedida do schema
mais recente. O texto existente da CLI de migrações pode dizer "production";
a configuração e o ID explícitos determinam o destino real de homologação.

### 6. Habilitar a primeira implantação do Pages

Versione os dois IDs reais de D1 de homologação por um PR revisado, integre em
`staging`, defina a variável `STAGING_DEPLOY_ENABLED=true` no ambiente `staging`
e faça um novo push nessa branch. Também é possível reexecutar uma execução após
habilitar a variável, se seu SHA ainda for HEAD da branch. Todo o CI deve passar antes.

O job de homologação confere credenciais e HEAD, instala as dependências fixadas,
valida o isolamento de recursos, verifica migrações somente por leitura, compila
com `VITE_APP_ENV=staging`, confere HEAD novamente, envia para `rp-doces-staging`,
verifica SHA completo/sucesso pela API Cloudflare e executa os testes básicos
somente de leitura. Execuções superadas/desabilitadas não publicam. Se HEAD avançar
durante o build, verificação e testes básicos são pulados, salvo se a execução
tiver efetivamente enviado os arquivos.

**Wrangler Pages 3.114.17 rejeita `--config`.** Imediatamente antes do envio, o job
copia `wrangler.staging.toml` para `wrangler.toml` em seu checkout descartável.
Isso não altera a configuração de produção versionada. O comando de envio suportado é:

```sh
npx wrangler pages deploy dist --project-name rp-doces-staging --branch staging --commit-hash "$GITHUB_SHA" --commit-dirty=false
```

Nunca o execute manualmente no checkout normal com configuração de produção.
Prefira o job do CI; qualquer publicação manual excepcional deve usar um checkout
limpo e descartável de homologação, preparar ali sua configuração e passar pelos
mesmos critérios de isolamento/migrações/HEAD/build. Nenhum comando de implantação
deste documento foi executado na preparação do repositório.

## Testes básicos e lista de verificação após a implantação

```powershell
$env:SMOKE_BASE_URL = 'https://rp-doces-staging.pages.dev'
node scripts/smoke-production.mjs
```

O script inalterado usa somente GET: HTML/arquivo estático, catálogo, configuração
da loja, rejeição de acesso administrativo sem autenticação e comportamento de rota
inexistente. Não testa escritas, pagamentos externos, uploads ou entrega de push.
Exija:

- SHA e URL do projeto corretos na Cloudflare e no resumo de implantação do GitHub.
- Selo `STAGING` visível no admin autenticado; ausente dos builds de produção.
- Vínculos D1/R2/Queue isolados e nenhum endpoint/chave de produção em homologação.
- Produtores da fila >= 1 e consumidores = 1; cron do Worker saudável a cada minuto.
- Acesso do administrador de teste e envio de catálogo/imagens sintéticos funcionando somente em homologação.
- Inscrição VAPID independente e notificação de teste; inspecione os logs do Worker com dados sensíveis removidos.
- Testes de pagamento/webhook no sandbox somente onde houver suporte; nenhuma cobrança financeira real.
- Nenhuma publicação automática por integração Git fora deste workflow protegido.

## Reinicialização segura da homologação

Não forneça scripts destrutivos genéricos. Use o painel Cloudflare para uma
reinicialização aprovada separadamente e revisada manualmente, **somente de
`rp-doces-db-staging`**. Primeiro defina `STAGING_DEPLOY_ENABLED=false`, interrompa
consumidor/cron de homologação e isole o tráfego desse ambiente, para que mensagens
da fila não sejam reexecutadas contra IDs recriados. Descarte as mensagens de
homologação ou recrie **somente** a fila de homologação antes de retomar.
Registre o ID D1 atual e compare-o com ambas as configurações e com o painel;
exija uma segunda revisão de que o ID/nome de produção não está selecionado.

Se recriar o D1, atualize os dois IDs de homologação, aplique todas as migrações,
restaure somente dados sintéticos, reconstrua/valide os vínculos, reimplante o Worker
de homologação e repita a lista de verificação de schema/testes básicos antes de
reabilitar publicações. Autenticação e inscrições de push existentes devem ser
restabelecidas. Nunca exclua recursos D1/R2/Queue/Worker/Pages de produção.

## Solução de problemas e limites da validação local

- Marcador recusado: insira o UUID do D1 de homologação recém-criado nas duas configurações.
- Implantação pulada: confira controle de habilitação do ambiente `staging`, branch e HEAD atual.
- Credenciais ausentes: cadastre todos os segredos de homologação; não use segredos de produção
  do repositório como alternativa. Disponibilidade dos recursos de ambiente no plano GitHub
  é um pré-requisito do provisionamento.
- Verificador de migrações bloqueado: aplique manualmente as migrações pendentes de homologação
  com sua configuração explícita e tente novamente. Nunca adicione aplicação de migrações ao CI.
- Selo ausente: o build deve receber `VITE_APP_ENV=staging`; alterar uma variável Pages no servidor
  após o build não modifica o pacote compilado.
- Verificador da API não encontra o SHA: a branch de produção do Pages deve ser `staging`;
  confira o slot estável do projeto separado, permissões do token e propagação na Cloudflare.
- Teste básico falha no domínio personalizado: mantenha `STAGING_URL` no Pages até DNS/TLS estarem prontos.
- Push ausente: confira o par VAPID independente nos dois serviços, administrador ativo,
  vínculos da fila, acúmulo de mensagens e cron do Worker; não altere os invariantes da entrega.
- Criação da fila falha: especifique explicitamente `--message-retention-period-secs 86400`.

`deploy --dry-run` do Worker empacota com segurança, sem publicação remota. A implantação
Pages **não tem modo de simulação** na versão instalada. Sua validação se limita à
interpretação local de configuração pelo Wrangler, testes de vínculos/isolamento e
compilação da aplicação; existência de recursos, permissões de conta e comportamento
real de execução exigem a futura implantação manual. A validação local deve usar
diretório temporário vazio e diretório de configuração do Wrangler isolado para
evitar leitura de `.dev.vars` ou credenciais privadas. A validação Vite deve usar
um `envDir` temporário se puderem existir arquivos `.env*` privados.

Durante esta alteração, quatro testes existentes da CLI de verificação de migrações
abortaram no encerramento do processo filho em Node 24.19 / Windows, com uma asserção
nativa `UV_HANDLE_CLOSING` (saída 3221226505 em vez do código de bloqueio esperado).
A repetição isolada reproduziu o problema; o verificador e os testes foram mantidos
inalterados. Não trate essa validação local como totalmente aprovada: reexecute a
suíte inalterada no executor Linux do CI e investigue separadamente a falha nativa
do ambiente de execução.

Referências: [envio direto do Cloudflare](https://developers.cloudflare.com/pages/get-started/direct-upload/),
[ambientes de implantação do GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[testes de integração da Payments API do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-test/make-test-purchase?scope=prod).
