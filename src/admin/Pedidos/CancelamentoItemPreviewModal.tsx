import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import "./CancelamentoItemPreviewModal.css";

interface PreviewPagamento {
  pagamentoId: number;
  pagamentoAlocacaoId: number;
  metodo: string;
  valorAlocadoCentavos: number;
  valorJaReembolsadoDaAlocacaoCentavos: number;
  coberturaEfetivaCentavos: number;
  reembolsoPropostoCentavos: number;
}

interface CancelamentoPreview {
  pedidoId: number;
  item: {
    id: number;
    nome: string;
    quantidade: number;
    valorCentavos: number;
    statusItem: string;
    estoqueEstado: string;
  };
  financeiro: {
    valorItemCentavos: number;
    coberturaConfirmadaCentavos: number;
    valorNaoPagoCentavos: number;
    reembolsoNecessarioCentavos: number;
  };
  pagamentos: PreviewPagamento[];
  estoque: {
    estadoAtual: string;
    acaoPadrao: "LIBERAR_RESERVA" | "NAO_REPOR" | "NENHUMA";
  };
  bloqueios: Array<{ codigo: string; mensagem: string }>;
  cancelamentoExecutavel: boolean;
}

interface Props {
  orderId: number;
  itemId: number;
  onClose: () => void;
}

const dinheiro = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    centavos / 100,
  );

const METODOS: Record<string, string> = {
  PIX_MP: "Pix Mercado Pago",
  PIX_EXTERNO: "Pix externo",
  CARTAO: "Cartão",
  DINHEIRO: "Dinheiro",
  A_COMBINAR: "A combinar",
};

function textoEstoque(preview: CancelamentoPreview) {
  const { acaoPadrao } = preview.estoque;
  if (acaoPadrao === "LIBERAR_RESERVA") {
    const unidades = preview.item.quantidade === 1 ? "unidade" : "unidades";
    return `A reserva de ${preview.item.quantidade} ${unidades} será liberada em uma futura execução do cancelamento.`;
  }
  if (acaoPadrao === "NAO_REPOR") {
    return "Produto já baixado do estoque. O cancelamento não irá repor estoque automaticamente.";
  }
  if (preview.estoque.estadoAtual === "REPOSTO") {
    return "O estoque deste item já foi reposto. Nenhum novo efeito físico será aplicado.";
  }
  return "Este item não exige alteração física de estoque.";
}

export default function CancelamentoItemPreviewModal({ orderId, itemId, onClose }: Props) {
  const modalProps = useAdminModal(true, onClose);
  const [preview, setPreview] = useState<CancelamentoPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/pedidos/${orderId}/itens/${itemId}/cancelamento-preview`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Falha ao calcular o cancelamento");
        return body as CancelamentoPreview;
      })
      .then((body) => {
        if (ativo) setPreview(body);
      })
      .catch((err) => {
        if (ativo) setError(err.message);
      })
      .finally(() => {
        if (ativo) setLoading(false);
      });
    return () => {
      ativo = false;
    };
  }, [itemId, orderId]);

  return createPortal(
    <div className="cancelpreview-overlay" {...modalProps}>
      <section className="cancelpreview-card" role="dialog" aria-modal="true">
        <header className="cancelpreview-header">
          <div>
            <span className="cancelpreview-kicker">Preview financeiro</span>
            <h3>Cancelar item</h3>
          </div>
          <button type="button" className="cancelpreview-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        {loading && <div className="cancelpreview-state">Calculando impacto...</div>}
        {error && <div className="cancelpreview-error">{error}</div>}

        {preview && (
          <div className="cancelpreview-content">
            <div className="cancelpreview-product">
              <strong>{preview.item.nome}</strong>
              <span>
                {preview.item.quantidade}x · {dinheiro(preview.item.valorCentavos)}
              </span>
            </div>

            <div className="cancelpreview-values">
              <div><span>Valor do item</span><strong>{dinheiro(preview.financeiro.valorItemCentavos)}</strong></div>
              <div><span>Valor já pago associado</span><strong>{dinheiro(preview.financeiro.coberturaConfirmadaCentavos)}</strong></div>
              <div><span>Valor ainda não pago</span><strong>{dinheiro(preview.financeiro.valorNaoPagoCentavos)}</strong></div>
              <div className="cancelpreview-values-refund">
                <span>Valor que precisaria ser devolvido</span>
                <strong>{dinheiro(preview.financeiro.reembolsoNecessarioCentavos)}</strong>
              </div>
            </div>

            <div className="cancelpreview-section">
              <span className="cancelpreview-label">Pagamentos envolvidos</span>
              {preview.pagamentos.filter((p) => p.reembolsoPropostoCentavos > 0).length === 0 ? (
                <p className="cancelpreview-muted">Nenhum pagamento confirmado cobre este item.</p>
              ) : (
                <div className="cancelpreview-payments">
                  {preview.pagamentos
                    .filter((pagamento) => pagamento.reembolsoPropostoCentavos > 0)
                    .map((pagamento) => (
                      <div key={pagamento.pagamentoAlocacaoId}>
                        <span>{METODOS[pagamento.metodo] ?? pagamento.metodo}</span>
                        <strong>
                          {dinheiro(pagamento.reembolsoPropostoCentavos)} {pagamento.metodo === "DINHEIRO" ? "a devolver" : "a estornar"}
                        </strong>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="cancelpreview-stock">
              <span className="cancelpreview-label">Estoque</span>
              <p>{textoEstoque(preview)}</p>
            </div>

            {preview.bloqueios.map((bloqueio) => (
              <div className="cancelpreview-block" key={bloqueio.codigo}>
                {bloqueio.mensagem}
              </div>
            ))}

            <div className="cancelpreview-footer">
              <span>Cancelamento ainda não disponível nesta etapa.</span>
              <button type="button" onClick={onClose}>Fechar</button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
