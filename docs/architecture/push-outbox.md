# Caixa de saída durável de Web Push

A confirmação de pagamento e a criação de pedido manual já pago aguardam o registro
em `push_eventos` e, em seguida, publicam somente `{ pedidoId, evento: "PEDIDO_PAGO" }`
em `PUSH_QUEUE`. Nunca aguardam o transporte Web Push. Falhas de publicação na fila
têm os dados sensíveis removidos antes do registro em log; a intenção persistida
continua recuperável mesmo quando a inserção inicial na caixa de saída falha.
A exclusão do autor original do pedido manual é persistida em `exclude_usuario_id`;
reexecuções não a sobrescrevem. Eventos existentes usam `NULL`.

Por compatibilidade, um envio direto pode adotar uma exclusão para um evento legado
`PENDENTE` cuja exclusão seja `NULL`, com zero tentativas e sem token de aquisição.
Não pode substituir uma exclusão existente nem uma política já adquirida ou utilizada
em uma tentativa.

A migração `0037` adiciona `push_pedido_pago` e `push_exclude_usuario_id` como metadados
operacionais de `pedido_pagamentos`. A transição Pix que gera notificação registra
a intenção em seu `UPDATE` condicional existente; a criação manual já paga registra
a intenção e uma cópia do ID do autor no `INSERT`/lote de pagamento existente.
Status de pagamento e intenção são confirmados juntos, inclusive quando a execução
para antes da reconciliação ou do registro na caixa de saída. Nenhuma inserção em
`push_eventos`, operação de fila ou transporte é adicionada à transação financeira;
seus valores, condições de proteção e ordem das instruções permanecem iguais.

A recuperação agendada primeiro reconstrói até cinco eventos ausentes, em ordem de
ID de pagamento, a partir de intenções explícitas cujo pagamento esteja `PAGO`.
Nunca usa o agregado `pedidos.status_pagamento = 'PAGO'` como evidência de intenção.
Pagamentos existentes/históricos, pagamentos manuais comuns posteriores e
sincronização interna de Pix sem o ambiente de notificação mantêm a intenção padrão
zero. Aprovações inválidas do MP não podem definir o marcador. A cópia da exclusão
não tem FK e, portanto, sobrevive à limpeza de `registrado_por_usuario_id` na exclusão
de um administrador. A reconstrução usa `NOT EXISTS` e `ON CONFLICT DO NOTHING`:
não pode reiniciar `ENVIADO`, uma aquisição ativa, tentativas com falha ou uma política
de destinatários existente. A intenção é mantida para recuperação; `push_eventos`
continua sendo a única máquina de estados da entrega.

O D1 é a única autoridade da entrega. `workers/push.ts` consome identificadores e
chama `processarPushEventoPersistido`, reutilizando o CAS existente, a concessão
renovável de 120 segundos, a proteção por token contra executores obsoletos, a seleção
de destinatários e o transporte sequencial. Mensagens duplicadas e consumidores
concorrentes não conseguem adquirir uma concessão ativa nem reenviar um evento
`ENVIADO`. A entrega continua sendo pelo menos uma vez (at-least-once): aceitação
remota seguida de falha antes da conclusão local pode causar duplicidade na recuperação.

O consumidor confirma o processamento de falhas de negócio persistidas. Uma exceção
de infraestrutura provoca nova tentativa na fila somente quando não é possível
observar um estado coerente `FALHA`/`ENVIADO`. A fila permite três novas tentativas
de entrega; isso não aumenta as tentativas no D1 nem ignora sua elegibilidade.
O handler agendado a cada minuto percorre até cinco eventos elegíveis na ordem
existente. Recupera concessões expiradas de eventos `PENDENTE`, inclusive mensagens
não publicadas, e eventos `FALHA` após o intervalo de espera existente de 30 segundos,
respeitando o teto de três tentativas. Uma exceção após a aquisição pode deixar uma
concessão até sua expiração. Nunca recupere uma concessão ainda ativa.

## Implantação

O Pages oferece suporte a produtores de fila; o consumidor/handler agendado é um
Worker separado, não uma rota Pages. Veja [vínculos do Pages](https://developers.cloudflare.com/pages/functions/bindings/#queue-producers)
e [APIs de Queues](https://developers.cloudflare.com/queues/configuration/javascript-apis/).
O CI existente publica somente Pages; atualizações do Worker devem ser implantadas
separadamente. Os testes não executam mutações remotas nem implantações.

### Inicialização pela primeira vez (Wrangler 3.114.17)

Mantenha a implantação de main/Pages suspensa até concluir todos os passos abaixo.
Esta sequência é para o primeiro provisionamento de `rp-doces-push`, não para substituir
um consumidor já ativo. O ponto de entrada de inicialização tem somente uma resposta
HTTP inerte, e sua configuração não tem D1, consumidor de fila, rotas ou cron.
Comandos de segredos podem publicar uma nova versão, mas ela ainda será o Worker
inerte de inicialização.

Use a conta Cloudflare apropriada, nesta ordem exata:

```sh
npx wrangler d1 migrations apply rp-doces-db --remote
npx wrangler queues create rp-doces-push
npx wrangler deploy --config wrangler.push.bootstrap.toml
npx wrangler secret bulk C:\private\rp-doces-vapid.json --config wrangler.push.bootstrap.toml
npx wrangler secret list --config wrangler.push.bootstrap.toml
# PARE se os três segredos esperados não estiverem presentes e seus valores de origem validados.
npx wrangler deploy --config wrangler.push.toml --keep-vars
npx wrangler secret list --config wrangler.push.toml
```

O caminho do JSON privado é um exemplo fora do repositório. Prepare o arquivo com
segurança, contendo exatamente `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`,
todos com os valores válidos existentes. Nunca imprima nem versione seu conteúdo.
Confira se o envio em lote informa três sucessos e se `secret list` mostra os três
nomes; os nomes sozinhos não comprovam que os valores VAPID sejam válidos. Pare em
qualquer erro. Não execute comandos `secret put` sequenciais com a configuração
do consumidor ativo.

O comando de migração deve aplicar tanto `0036` quanto `0037` antes de ativar o Worker.
A criação da fila deve preceder qualquer vínculo de fila. Após a implantação ativa,
verifique na Cloudflare se `rp-doces-push` tem o vínculo D1, consumidor de fila, cron
a cada minuto, os três segredos e nenhum log de falha de configuração.
Só então libere a implantação normal do Pages pelo CI com o vínculo produtor
`PUSH_QUEUE`. Até essa liberação, mantenha a versão anterior do Pages em produção.
Ambientes de prévia/locais devem usar recursos D1/Queue isolados.

Validado localmente com a ajuda e o código-fonte do Wrangler instalado e com as duas
simulações de implantação. O Wrangler 3.114.17 oferece `secret bulk`, `secret list`
e `--keep-vars`, mas não a opção mais recente `deploy --secrets-file` documentada
pela Cloudflare. Seu comando em lote atualiza todos os segredos fornecidos em uma
única requisição de configuração; `--keep-vars` também preserva os vínculos de segredos
no envio final. A Cloudflare documenta que
[comandos de segredos implantam imediatamente](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret)
e descreve o [provisionamento de segredos em lote](https://developers.cloudflare.com/workers/configuration/secrets/).
Esta alteração não inclui atualização da CLI nem implantação remota.

Confira os logs do Worker, o acúmulo de mensagens na fila e `push_eventos` após a
implantação, incluindo exclusão do autor manual e recuperação agendada. Um acúmulo
maior que cinco eventos elegíveis por minuto pode exigir ajuste de capacidade em
trabalho separado. Configuração VAPID ausente consome o limite existente de tentativas
com falha; confira os segredos antes de habilitar o cron. Uma indisponibilidade do D1
no registro da caixa de saída não apaga a intenção confirmada com o pagamento;
execuções posteriores do cron a reconstroem quando o D1 volta a ficar disponível.
Se a própria gravação financeira falhar, nem pagamento nem intenção são confirmados.
Esta alteração não torna a entrega Web Push um pré-requisito para o sucesso do pagamento.

Para reverter, preserve a migração aditiva. Reverta a aplicação para um SHA conhecido
e desative o novo consumidor/cron do Worker antes de reativar a entrega síncrona.
Não exclua os dados da caixa de saída; eventos inacabados continuam sob controle do D1.
