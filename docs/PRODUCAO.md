# Operação segura de produção

Este documento reúne procedimentos para deploy, backup e incidentes da R&P Doces.
Ele não autoriza alterações diretas no banco de produção.

## Regras de segurança

- Nunca alterar migrations já aplicadas; criar uma nova migration.
- Nunca executar migrations ou arquivos SQL com `--remote` sem backup recente e revisão.
- Nunca restaurar um backup diretamente em produção como primeira tentativa de correção.
- Nunca editar manualmente status de pagamento ou marcadores de baixa de estoque.
- Nunca compartilhar secrets, tokens, passkeys, backups SQL ou links assinados de exportação.
- Checkout, Mercado Pago, estoque, autenticação e Web Push são código crítico.
- Antes de uma ação crítica, registrar horário, motivo e responsável.

## Rotina antes de publicar

1. Confirmar que a aplicação está operando normalmente no Admin.
2. Criar o backup em horário de baixo movimento, pois o D1 pode ficar temporariamente indisponível:

   ```bash
   npm run backup:production -- --confirm-production
   ```

3. Validar o backup mais recente em D1 local isolado:

   ```bash
   npm run backup:verify
   ```

4. Rodar os testes:

   ```bash
   npm test
   ```

5. Conferir branch e working tree:

   ```bash
   git status
   git branch --show-current
   ```

6. Se necessário, publicar uma prévia:

   ```bash
   npm run deploy:preview
   ```

7. Publicar produção somente pela proteção automatizada:

   ```bash
   npm run deploy:production
   ```

O deploy de produção exige `main`, working tree limpo e testes aprovados.

## Falha logo após um deploy

1. Parar novos deploys e anotar o horário aproximado da falha.
2. Verificar se o problema também ocorre no Admin e no checkout público.
3. Consultar os logs das Pages Functions no painel da Cloudflare sem exibir secrets ou dados pessoais.
4. Em **Cloudflare Pages > rp-doces > Deployments**, localizar o último deploy de produção estável e bem-sucedido.
5. No menu de três pontos desse deploy, usar **Rollback to this deployment** e confirmar. Deploys de preview não são alvos válidos de rollback.
6. Confirmar depois do rollback:
   - carregamento do site público;
   - login do Admin;
   - listagem de produtos e pedidos;
   - ausência de novos erros de Functions.
7. Corrigir o problema em uma branch separada e repetir testes e preview.

Um rollback de código não reverte migrations nem alterações feitas no D1.

## Pagamento aprovado que não aparece no sistema

1. Não criar outro pagamento e não marcar o pedido manualmente como pago.
2. Conferir no Mercado Pago se o pagamento pertence ao mesmo `mp_order_id`/pedido.
3. Conferir o histórico de entrega do webhook e o status HTTP retornado:
   - `200`: evento reconhecido;
   - `401`: assinatura inválida ou secret divergente;
   - `502`: falha transitória; o Mercado Pago deve tentar novamente;
   - `503`: configuração do webhook ausente.
4. Abrir a aba de pedidos do Admin. A listagem reconcilia pedidos pendentes com o Mercado Pago.
5. Aguardar alguns segundos e atualizar uma vez; evitar atualizações contínuas.
6. Se continuar divergente, preservar logs e IDs antes de alterar qualquer dado.

Endpoint configurado:

```text
/api/webhooks/mercadopago
```

## Pedido pago com estoque pendente

Um pedido está nesse estado quando está `PAGO`, mas ainda não possui
`estoque_baixado_em`.

1. Não reduzir o estoque manualmente e não editar `estoque_baixado_em`.
2. Abrir a listagem de pedidos no Admin.
3. A reconciliação aguarda pelo menos 15 segundos e tenta até quatro pedidos por vez.
4. A baixa reutiliza a operação idempotente e transacional existente:
   - todos os itens são baixados; ou
   - nenhum item é baixado.
5. Se houver estoque insuficiente, decidir operacionalmente como atender o cliente antes de aumentar estoque no Admin.
6. Depois de corrigir o estoque real, abrir novamente a listagem para permitir nova tentativa.
7. Se persistir, parar e revisar logs; não executar SQL corretivo improvisado.

## Falha ou atraso do Web Push

- O Web Push é uma notificação auxiliar; o pedido no D1 e no Admin é a fonte de verdade.
- Confirmar primeiro o pagamento e o pedido no Admin.
- Não repetir baixa de estoque para tentar reenviar notificação.
- Verificar configuração VAPID e inscrições somente depois de preservar o estado do pedido.

## Backup e recuperação

Os backups ficam em `.private-backups/`, ignorados pelo Git, e podem conter dados
pessoais de clientes.

Criar backup:

```bash
npm run backup:production -- --confirm-production
```

Validar automaticamente o backup mais recente em D1 local:

```bash
npm run backup:verify
```

Validar um arquivo específico:

```bash
npm run backup:verify -- --file .private-backups/NOME.sql
```

O verificador bloqueia `--remote`. Para uma restauração real de produção:

1. interromper mudanças e reduzir novas operações no site;
2. criar outro backup do estado atual, mesmo que esteja inconsistente;
3. confirmar conta Cloudflare, banco `rp-doces-db` e arquivo exato;
4. revisar migrations e impacto em pedidos criados depois do backup;
5. obter uma segunda confirmação humana;
6. preparar e revisar separadamente o comando de restauração;
7. validar imediatamente pedidos, itens, produtos, usuários e passkeys.

Não manter neste documento um comando pronto de restauração remota: ele deve ser
montado e revisado para o incidente específico.

## Checklist após recuperação

- [ ] Site público carrega.
- [ ] Produtos e estoque aparecem corretamente.
- [ ] Login e passkey do Admin funcionam.
- [ ] Pedidos históricos continuam visíveis com todos os itens.
- [ ] Pedido pendente pode ser reconciliado.
- [ ] Pedido pago não sofre segunda baixa de estoque.
- [ ] Webhook não apresenta erros persistentes.
- [ ] Web Push não interfere no processamento do pedido.
- [ ] Backup do incidente foi guardado em local privado.
- [ ] Causa e ações tomadas foram registradas.
