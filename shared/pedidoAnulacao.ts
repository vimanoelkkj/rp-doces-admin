export interface PedidoAnulacao {
  id: number;
  pedido_id: number;
  motivo: string;
  estoque_acao: "DEVOLVER" | "MANTER";
  criado_por_usuario_id: number | null;
  usuario_nome: string;
  criado_em: string;
  total_original_centavos: number;
  bruto_original_centavos: number;
  reembolsado_original_centavos: number;
  liquido_original_centavos: number;
  estoque_snapshot: string;
}
