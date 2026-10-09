<a id="changelog"></a>

# Histórico de alterações

<a id="100--unreleased"></a>

## 1.0.0 — Não publicado

Primeira versão formal preparada para a aplicação R&P Doces existente. A data de publicação e a tag de release serão registradas somente após a aprovação da release e a verificação do deploy.

<a id="included"></a>

### Funcionalidades incluídas

- Storefront com Home, catálogo e detalhes dos produtos, persistência do carrinho, checkout, acompanhamento de pedidos, navegação responsiva e temas claro/escuro.
- Painel administrativo, gestão de produtos e categorias, imagens de produtos no R2, configurações da loja, despesas discriminadas e gestão de pedidos.
- Autenticação administrativa com cookies de sessão, papéis OWNER/ADMIN, gestão de administradores, verificação de senha e proteção do último proprietário ativo.
- Pedidos criados pela storefront ou pelo admin, pagamentos manuais, atualização de status, arquivamento e histórico de eventos.
- Reserva, liberação, baixa e reposição de estoque com constraints no banco e proteções transacionais.
- Criação de pagamentos Pix pelo Mercado Pago, chaves de operação estáveis, validação de webhooks assinados, sincronização de status e recuperação de requisições inconclusivas.
- Troca de itens, cancelamento de linhas inteiras, reembolsos manuais e pelo Mercado Pago, alocações de pagamentos e fluxos de anulação de pedidos.
- Ledger financeiro em centavos inteiros, tratamento idempotente de replay/conflito e reconciliação explícita dos estados de pagamento e estoque.
- Migrações sequenciais do Cloudflare D1 e migration guard somente leitura antes do deploy.
- Assinaturas administrativas de Web Push, entrega e novas tentativas, erros sanitizados e leases de claim renováveis baseados em token para recuperar eventos abandonados. A entrega usa semântica at-least-once; duplicações raras continuam possíveis.
- Harnesses direcionados de regressão de domínio/UI, testes locais de concorrência no D1, E2E com Playwright, typechecks de frontend/Functions e CI no GitHub Actions.
- Verificações same-origin em mutações, headers de segurança, limites de requisições no login/checkout, atualizações pelo Dependabot e auditoria de dependências de produção.
- Backup local do D1, verificação de checksum, restauração normalizada, verificações de migrações/schema/constraints e procedimentos documentados de rollback.
- Verificação do SHA após o deploy e smoke somente leitura no pipeline de publicação.
- IDs de correlação de requisições propagados pelas Pages Functions e alertas operacionais estruturados nos logs, sem destino externo para alertas.

<a id="release-conditions-and-known-limits"></a>

### Condições de release e limitações conhecidas

- Siga o [checklist de release](docs/RELEASE-CHECKLIST.md); a convenção de tag é `v1.0.0`. Preparar esta entrada não cria tag, GitHub Release nem deploy.
- Vulnerabilidades altas/críticas em produção bloqueiam a release. Os achados moderados atuais do React Router estão analisados na [aceitação de risco](docs/architecture/dependency-risk-acceptance.md); a migração para React Router 7 está planejada separadamente após a v1.0.
- Um exercício local descartável de backup/restauração recuperou dados e exports de forma idêntica. Isso não comprova compatibilidade de dumps remotos, restauração de produção nem rollback real do Pages.
- O operador da release deve confirmar backups de produção, status das migrações D1, um deployment saudável conhecido para rollback, resultados de CI/auditoria do SHA da release e smoke após o deploy.
- Não estão configurados backups agendados do D1 de produção, backups do R2 nem observabilidade/entrega de alertas externos.
