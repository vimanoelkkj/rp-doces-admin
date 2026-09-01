import { z } from "zod";

export const DashboardOrderItemSchema = z.object({
  pedido_id: z.coerce.number().optional(),
  produto_id: z.coerce.number().nullable().optional(),
  produto_nome: z.string().nullable().optional(),
  quantidade: z.coerce.number().default(0),
  valor_unitario_centavos: z.coerce.number().default(0),
  valor_total_centavos: z.coerce.number().default(0),
  estoque_baixado_em: z.string().nullable().optional()
});

export const DashboardOrderSchema = z.object({
  id: z.coerce.number(),
  cliente_nome: z.string().nullable().optional(),
  cliente_email: z.string().nullable().optional(),
  cliente_whatsapp: z.string().nullable().optional(),
  quantidade: z.coerce.number().default(0),
  valor_total_centavos: z.coerce.number().default(0),
  status_pagamento: z.string().nullable().default("PENDENTE"),
  status_pedido: z.string().nullable().default("NOVO"),
  criado_em: z.string().nullable().optional(),
  atualizado_em: z.string().nullable().optional(),
  pago_em: z.string().nullable().optional(),
  itens: z.array(DashboardOrderItemSchema).default([])
});

export const DashboardOrdersResponseSchema = z.object({
  pedidos: z.array(DashboardOrderSchema)
});

export type DashboardOrder = z.infer<typeof DashboardOrderSchema>;
export type DashboardOrderItem = z.infer<typeof DashboardOrderItemSchema>;
