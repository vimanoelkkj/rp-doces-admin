# Rollback do Admin V2

O Admin V2 nasce isolado em `/admin-v2` e não substitui `/admin` durante a validação.

## Regra

- `/admin` continua sendo o painel de produção.
- `/admin-v2` usa a mesma API, sessão e banco, sem alterar contratos do backend.
- Nenhum redirecionamento para V2 deve ser criado antes da aprovação explícita.

## Se houver problema

1. Pare de usar `/admin-v2`.
2. Continue operando normalmente por `/admin`.
3. Reverta somente os arquivos do V2 se necessário.
4. Não reverta D1, R2, Mercado Pago ou autenticação, pois esta fase não altera essas camadas.
