-- Migration 0034: flag booleana de novidade no produto
--
-- Adiciona a coluna `novo` à tabela `produtos` para indicar produtos em destaque
-- de novidade no catálogo.
--
-- NOT NULL DEFAULT 0 garante compatibilidade total com produtos preexistentes
-- sem necessidade de backfill.
--
-- Não altera tabelas financeiras, de estoque, de pedidos ou de autenticação.
-- Segura para aplicação direta no D1 de produção (aditiva).

ALTER TABLE produtos ADD COLUMN novo INTEGER NOT NULL DEFAULT 0 CHECK (novo IN (0, 1));
