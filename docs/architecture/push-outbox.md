<a id="durable-web-push-outbox"></a>

# Outbox durável de Web Push

A confirmação de pagamento e a criação manual de pedido pago aguardam o registro em
`push_eventos` e depois publicam apenas `{ pedidoId, evento: "PEDIDO_PAGO" }` em
`PUSH_QUEUE`. Nunca aguardam o transporte Web Push. Falhas de publicação na fila
são sanitizadas e registradas; a intenção persistida continua recuperável mesmo
quando a inserção inicial na outbox falha. A exclusão do autor original do pedido
manual é persistida como `exclude_usuario_id`; replays não a sobrescrevem.
Eventos existentes usam `NULL`.

Por compatibilidade, um envio direto pode adotar uma exclusão para um evento
legado `PENDENTE` cuja exclusão seja `NULL`, com zero tentativas e sem token de claim.
Não pode substituir uma exclusão existente nem uma política já adquirida ou tentada.

A migração `0037` adiciona `push_pedido_pago` e `push_exclude_usuario_id` como
metadados operacionais em `pedido_pagamentos`. A transição Pix que notifica registra
a intenção no `UPDATE` protegido existente; uma criação manual paga registra a
intenção e uma cópia do ID do autor no `INSERT`/batch de pagamento existente.
Status do pagamento e intenção são commitados juntos, inclusive quando a execução
para antes da reconciliação ou do registro na outbox. Nenhuma inserção em
`push_eventos`, operação de Queue ou transporte é adicionada à transação financeira,
e seus valores, proteções e ordem das instruções permanecem inalterados.

A recuperação agendada primeiro reconstrói até cinco eventos ausentes, em ordem
de ID do pagamento, a partir de intenções explícitas cujo pagamento está `PAGO`.
Nunca usa o status agregado `pedidos.status_pagamento = 'PAGO'` como evidência de
intenção. Pagamentos existentes/históricos, pagamentos manuais comuns posteriores
e sincronização Pix interna sem o ambiente de notificação mantêm a intenção padrão
zero. Aprovações MP inválidas não podem definir o marcador. A cópia da exclusão não
tem FK, portanto sobrevive à limpeza de `registrado_por_usuario_id` quando um
administrador é excluído. A reconstrução usa `NOT EXISTS` e `ON CONFLICT DO NOTHING`:
não pode reiniciar `ENVIADO`, um claim ativo, tentativas com falha nem uma política de
destinatários existente. A intenção é mantida para recuperação; `push_eventos`
continua sendo a única máquina de estados de entrega.

O D1 é a única autoridade de entrega. `workers/push.ts` consome identificadores e
chama `processarPushEventoPersistido`, reutilizando o CAS existente, o lease
renovável de 120 segundos, a proteção por token, a seleção de destinatários e o
transporte sequencial. Mensagens duplicadas e consumidores concorrentes não podem
adquirir um claim ativo nem reenviar um evento `ENVIADO`. A entrega continua
at-least-once: aceitação remota seguida de crash antes da conclusão local pode
causar uma duplicação na recuperação.

O consumidor confirma o processamento de falhas de negócio persistidas. Uma
exceção de infraestrutura causa retry da Queue apenas quando não é possível
observar um estado coerente `FALHA`/`ENVIADO`. A reentrega da Queue tem três retries;
não aumenta as tentativas do D1 nem ignora sua elegibilidade. O handler agendado
uma vez por minuto varre até cinco eventos elegíveis na ordem existente. Recupera
leases `PENDENTE` expirados, inclusive mensagens não publicadas, e `FALHA` após o
backoff existente de 30 segundos, com o limite existente de três tentativas. Uma
exceção após o claim pode deixar um lease até sua expiração. Nunca recupere um lease
ainda ativo.

<a id="deployment"></a>

## Deploy

Pages permite produtores de Queue; o consumidor/handler agendado é um Worker
separado, não uma rota de Pages. Consulte [bindings do Pages](https://developers.cloudflare.com/pages/functions/bindings/#queue-producers)
e [APIs de Queues](https://developers.cloudflare.com/queues/configuration/javascript-apis/).
O CI existente publica apenas Pages; atualizações do Worker devem ser publicadas
separadamente. Os testes não realizam mutações remotas nem deploys.

<a id="first-bootstrap-wrangler-311417"></a>

### Primeiro bootstrap (Wrangler 3.114.17)

Suspenda o deploy de main/Pages até concluir todas as etapas abaixo. Esta sequência
é para o primeiro provisionamento de `rp-doces-push`, não para substituir um
consumidor já ativo. O entrypoint de bootstrap tem apenas uma resposta HTTP inerte,
e sua configuração não tem D1, consumidor de Queue, rotas nem cron. Comandos de
secrets podem publicar uma nova versão, mas ela ainda será o Worker de bootstrap
inerte.

Use a conta Cloudflare apropriada, nesta ordem exata:

```sh
npx wrangler d1 migrations apply rp-doces-db --remote
npx wrangler queues create rp-doces-push
npx wrangler deploy --config wrangler.push.bootstrap.toml
npx wrangler secret bulk C:\private\rp-doces-vapid.json --config wrangler.push.bootstrap.toml
npx wrangler secret list --config wrangler.push.bootstrap.toml
# STOP unless all three expected secrets are present and their source values validated.
npx wrangler deploy --config wrangler.push.toml --keep-vars
npx wrangler secret list --config wrangler.push.toml
```

O caminho JSON privado é um exemplo fora do repositório. Prepare o arquivo com
segurança, contendo exatamente `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e
`VAPID_SUBJECT`, todos com os valores válidos existentes. Nunca imprima nem commite
seu conteúdo. Verifique que o upload em lote reporte três sucessos e que
`secret list` mostre os três nomes; nomes sozinhos não comprovam valores VAPID
válidos. Pare em qualquer erro. Não execute comandos `secret put` sequenciais
contra a configuração do consumidor ativo.

O comando de migração deve aplicar `0036` e `0037` antes de ativar o Worker. A
criação da Queue precede todo binding de Queue. Após o deploy ativo, verifique na
Cloudflare se `rp-doces-push` tem o binding D1, consumidor de Queue, cron de uma vez
por minuto, os três secrets e nenhum log de falha de configuração. Só então libere
o deploy normal de Pages pelo CI, com o binding produtor `PUSH_QUEUE`. Até esse
critério ser atendido, mantenha a versão anterior do Pages atendendo produção.
Ambientes preview/locais devem usar recursos D1/Queue isolados.

Validado localmente pela ajuda/código-fonte do Wrangler instalado e pelos dois
dry-runs de deploy. Wrangler 3.114.17 suporta `secret bulk`, `secret list` e
`--keep-vars`, mas não o `deploy --secrets-file` mais recente documentado pela
Cloudflare. Seu comando bulk atualiza todos os secrets fornecidos em uma única
requisição de configurações; `--keep-vars` também preserva os bindings de secrets
no upload final. A Cloudflare documenta que
[comandos de secrets fazem deploy imediatamente](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret)
e o [provisionamento de secrets em lote](https://developers.cloudflare.com/workers/configuration/secrets/).
Nenhuma atualização da CLI nem deploy remoto faz parte desta alteração.

Verifique os logs do Worker, backlog da fila e `push_eventos` após o deploy,
incluindo a exclusão do autor manual e a recuperação agendada. Um backlog maior
que cinco eventos elegíveis por minuto pode exigir ajuste de capacidade separado.
A ausência de configuração VAPID consome o orçamento existente de tentativas com
falha; verifique os secrets antes de habilitar o cron. Uma indisponibilidade do D1
no registro da outbox não apaga a intenção commitada com o pagamento; execuções
posteriores do cron a reconstroem quando o D1 volta a ficar disponível. Se a própria
gravação financeira falhar, não são commitados pagamento nem intenção. Esta
alteração não torna a entrega Web Push um pré-requisito para sucesso do pagamento.

Para rollback, mantenha a migração aditiva. Reverta a aplicação para um SHA conhecido
e desabilite o novo consumidor/cron do Worker antes de reativar a entrega síncrona.
Não exclua os dados da outbox; eventos não concluídos continuam regidos pelo D1.
