import { z } from "zod";

export const OrderItemSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  pedido_id: z.coerce.number().optional(),
  produto_id: z.coerce.number().nullable().optional(),
  produto_nome: z.string().nullable().optional(),
  quantidade: z.coerce.number().default(0),
  valor_unitario_centavos: z.coerce.number().default(0),
  valor_total_centavos: z.coerce.number().default(0),
  estoque_baixado_em: z.string().nullable().optional(),
  adicionado_por_usuario_id: z.coerce.number().nullable().optional(),
  adicionado_em: z.string().nullable().optional()
});

export const OrderSchema = z.object({
  id: z.coerce.number().int().positive(),
  token_publico: z.string().nullable().optional(),
  produto_id: z.coerce.number().nullable().optional(),
  produto_nome: z.string().nullable().optional(),
  quantidade: z.coerce.number().default(0),
  valor_unitario_centavos: z.coerce.number().default(0),
  valor_total_centavos: z.coerce.number().default(0),
  cliente_nome: z.string().nullable().optional(),
  cliente_email: z.string().nullable().optional(),
  cliente_whatsapp: z.string().nullable().optional(),
  tipo_entrega: z.string().nullable().optional(),
  observacao: z.string().nullable().optional(),
  metodo_pagamento: z.string().nullable().optional(),
  status_pagamento: z.string().nullable().default("PENDENTE"),
  status_pedido: z.string().nullable().default("NOVO"),
  status_comanda: z.enum(["ABERTA", "ENCERRADA"]).nullable().default("ABERTA"),
  origem_pedido: z.string().nullable().optional(),
  mp_order_id: z.string().nullable().optional(),
  mp_payment_id: z.string().nullable().optional(),
  mp_status: z.string().nullable().optional(),
  mp_status_detail: z.string().nullable().optional(),
  criado_em: z.string().nullable().optional(),
  atualizado_em: z.string().nullable().optional(),
  pago_em: z.string().nullable().optional(),
  estoque_baixado_em: z.string().nullable().optional(),
  reserva_status: z.string().nullable().optional(),
  itens: z.array(OrderItemSchema).default([])
});

export const OrdersResponseSchema = z.object({
  pedidos: z.array(OrderSchema)
});

export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
