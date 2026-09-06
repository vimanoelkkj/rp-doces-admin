CREATE TABLE IF NOT EXISTS app_remote_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  atualizado_por INTEGER,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (atualizado_por) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_remote_config_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  atualizado_por INTEGER,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (atualizado_por) REFERENCES usuarios_admin(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_remote_config_history_revision
  ON app_remote_config_history(revision);

INSERT OR IGNORE INTO app_remote_config (id, revision, config_json)
VALUES (
  1,
  10,
  '{"schema_version":1,"revision":10,"min_app_version_code":1,"poll_seconds":30,"theme":"system","maintenance":{"enabled":false,"eyebrow":"MANUTENÇÃO","title":"Voltamos em instantes","message":"O painel está temporariamente indisponível enquanto fazemos um ajuste."},"update":{"eyebrow":"ATUALIZAÇÃO NECESSÁRIA","title":"Atualize o R&P Doces","message":"Há uma versão mais recente do aplicativo disponível.","url":""},"navigation":{"dashboard":true,"products":true,"orders":true,"admins":true,"store":true},"dashboard_banner":{"enabled":false,"eyebrow":"AVISO","title":"","message":"","tone":"accent"},"features":{"dashboard_metrics":true,"dashboard_flavors":true,"dashboard_receivables":true,"dashboard_recent_orders":true,"dashboard_attention":true,"orders_manual_create":true,"paid_order_notifications":true},"dashboard_section_order":["metrics","flavors","receivables","recent_orders","attention"]}'
);

INSERT OR IGNORE INTO app_remote_config_history (revision, config_json)
SELECT revision, config_json FROM app_remote_config WHERE id = 1;
