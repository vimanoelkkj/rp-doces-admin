# Confirmação pontual de Pix em staging

`POST /api/admin/pedidos/:id/pix/recuperar` recebe somente
`{"pagamentoId": <inteiro positivo seguro>}`. Requer sessão ativa OWNER,
mesma origem, host HTTPS `staging.rpdoces.com.br`, `APP_ENV=staging` e
`MP_TEST_MODE=orders_pix`. Outros métodos retornam 405; produção é recusada.
Todas as respostas usam `Cache-Control: no-store`.

O ORD consultado vem do pagamento local vinculado ao pedido da URL. A rota
faz um único GET Orders autenticado, com o prazo do cliente compartilhado.
Não aceita ORD, PAY, referência, status ou valor enviados pelo cliente como
autoridade financeira. Não faz POST no MP, polling, sweep, expiração ou
recuperação de outras operações.

## Contrato do núcleo

A rota usa `syncPaymentFromMp` com `confirmationOnly: true` e
`expectedPedidoId`. O modo restrito exige pagamento SITE/PIX_MP elegível,
uma única operação CHECKOUT_SITE/SITE vinculada ao mesmo pedido, fase
REMOTO_CONHECIDO ou CONCLUIDA, PAY correspondente e referência persistida.
Recusa observação local de reembolso, países ausentes/diferentes de BR/BRA,
valores divergentes, métodos diferentes de Pix/bank_transfer, Orders ou
Payments sem processed/accredited e snapshots de reembolso parcial.
Valores pagos, quando fornecidos pelo provedor, também devem corresponder.

A marca de verificação nasce exclusivamente no GET do cliente Orders. O
núcleo valida ORD/PAY inequívocos, valor, total, método e referência inclusive
em replay PAGO. Não insere um novo recebimento, refund, alocação ou operação.
As recusas do modo restrito não escrevem diagnóstico nem projeções.

O guard financeiro revalida a identidade do ledger, pedido, token público,
valor, origem, chave local e o snapshot das operações na própria escrita.
Também recusa uma observação concorrente de refunded. Os mesmos predicados,
acrescidos de status PAGO, protegem cada escrita da projeção e do batch de
estoque, incluindo replay. A baixa reutiliza as regras por item e o líquido
do ledger, com rollback transacional D1. Uma reserva vencida continua
convertível; uma reserva liberada depende de estoque suficiente.

O chamador de aprovação nunca finaliza/libera um estado terminal vencedor
de uma corrida. Cancelamento, refund e expiração legítimos continuam usando
o contrato normal do núcleo. A confirmação restrita não converge trocas,
não registra intenção push, não enfileira notificações e não promove o
status operacional do pedido.

## Resultado e repetição

- 200: `ok`, `confirmacaoPersistida` e `transicionou`, com
  `finalizacaoPendente: false`.
- 202: confirmação PAGO persistida, com `finalizacaoPendente: true`.
  A falha física não desfaz o recebimento; repetir a mesma recuperação pode
  concluir os efeitos restantes, sem nova baixa dos itens já processados.
- 409: confirmação recusada ou conflito. O resultado distingue uma
  transição que esta chamada já persistiu de uma recusa anterior à escrita.
- 502: GET remoto falhou ou retornou identidade/formato inválido.
- 503: configuração ausente ou falha local. Pode haver resultado financeiro
  inconclusivo após falha de infraestrutura; o retry é idempotente.

Respostas e logs da rota não expõem payload MP, referência pública, QR,
credenciais ou exceções do provedor. O evento de resultado contém apenas
ator/pedido/pagamento locais e resultado resumido.

## Evidências e limites

As reproduções iniciais confirmaram quatro riscos: finalização terminal
após CAS perdido, replay PAGO de valor divergente, referência alterada antes
da escrita e PAY divergente na operação. A revisão também reproduziu uma
observação refunded concorrente apagada pela aprovação. Os testes em
`payment-confirmation-restricted.test.mjs` e `admin-pix-recovery.test.mjs`
usam D1/Miniflare descartável, cliente GET real e respostas MP simuladas.
Cobrem recusas sem mutações, concorrência, rollback físico, replays, guards
de acesso/ambiente e preservação do status operacional.

O isolamento do binding DB é verificado pelos gates de publicação existentes;
as flags de runtime não atestam o UUID do D1. Este PR não publica a rota,
não migra D1 e não executa recuperação real. O pedido #23 não foi consultado
nem reconciliado neste trabalho.

Skills aplicadas: using-agent-skills, ponytail, git-workflow-and-versioning,
test-driven-development, api-and-interface-design, security-and-hardening,
incremental-implementation e code-review-and-quality. Inventário de chamadores:
webhook, pedidoStatus, sweeps, inconclusiveRecovery e pedidoAnulacao. Nenhum
desses chamadores foi convertido ao modo restrito.

Referência de transações:
[API D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
