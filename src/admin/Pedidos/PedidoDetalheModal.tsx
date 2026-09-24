import { createPortal } from "react-dom";
import { useAdminModal } from "../components/useAdminModal";
import ConfirmDialog from "../components/ConfirmDialog";
import "./PedidoDetalheModal.css";
import AdicionarItemModal from "./AdicionarItemModal";
import CancelamentoItemPreviewModal from "./CancelamentoItemPreviewModal";
import TrocarItemModal from "./TrocarItemModal";
import HistoricoComandaModal from "./HistoricoComandaModal";
import ExcluirPedidoModal from "./ExcluirPedidoModal";
import {
  STATUS_LABEL,
  STATUS_TYPE,
  formatarData,
  formatarPreco,
} from "./PedidoDetalhe/helpers";
import PedidoItens from "./PedidoDetalhe/PedidoItens";
import PedidoHeader from "./PedidoDetalhe/PedidoHeader";
import PedidoPagamento from "./PedidoDetalhe/PedidoPagamento";
import { usePedidoDetalhe } from "./PedidoDetalhe/usePedidoDetalhe";

interface PedidoDetalheModalProps {
  orderId: number;
  onClose: () => void;
  onStatusChanged?: () => void;
}

/* ── Component ── */
export default function PedidoDetalheModal({
  orderId,
  onClose,
  onStatusChanged,
}: PedidoDetalheModalProps) {
  const modalProps = useAdminModal(true, onClose);
  const detalhe = usePedidoDetalhe({ orderId, onClose, onStatusChanged });

  return createPortal(
    <div className="pedmodal-overlay" {...modalProps}>
      <div className="pedmodal-card">
        {/* Header */}
        <PedidoHeader
          orderId={orderId}
          pedido={detalhe.data?.pedido ?? null}
          anulado={detalhe.anulado}
          editandoNome={detalhe.editandoNome}
          clienteNome={detalhe.clienteNome}
          salvandoNome={detalhe.salvandoNome}
          nomeError={detalhe.nomeError}
          alterando={detalhe.alterando}
          arquivando={detalhe.arquivando}
          onIniciarEdicaoNome={detalhe.iniciarEdicaoNome}
          onCancelarEdicaoNome={() => detalhe.setEditandoNome(false)}
          onSalvarNome={detalhe.salvarNome}
          onClienteNomeChange={detalhe.setClienteNome}
          onAlterarStatus={detalhe.alterarStatus}
          onArquivar={detalhe.clicarArquivar}
          onExcluir={() => detalhe.setConfirmarExclusao(true)}
          onClose={onClose}
        />

        <div className="pedmodal-divider" />

        {/* Body */}
        {detalhe.loading && <div className="pedmodal-body">Carregando...</div>}
        {detalhe.error && <div className="pedmodal-body">{detalhe.error}</div>}
        {detalhe.data && (
          <div className="pedmodal-body">
            {detalhe.statusError && (
              <p className="pedmodal-status-error">{detalhe.statusError}</p>
            )}
            {detalhe.arquivamentoError && (
              <p className="pedmodal-status-error">{detalhe.arquivamentoError}</p>
            )}
            {/* Meta badges */}
            <div className="pedmodal-meta">
              <span className="pedmodal-badge pedmodal-badge--comanda">
                Comanda #{detalhe.data.pedido.id}
              </span>
              <span
                className={`pedmodal-badge pedmodal-badge--${STATUS_TYPE[detalhe.data.pedido.status_pedido]}`}
              >
                {STATUS_LABEL[detalhe.data.pedido.status_pedido]}
              </span>
              {detalhe.anulado && <span className="pedmodal-badge pedmodal-badge--red">Anulado</span>}
              {detalhe.data.pedido.arquivado === 1 && (
                <span className="pedmodal-badge pedmodal-badge--archived">
                  Arquivado
                </span>
              )}
              <span className="pedmodal-meta-date">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="#8c7a76"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="12" height="11" rx="2" />
                  <line x1="2" y1="7" x2="14" y2="7" />
                  <line x1="5" y1="1.5" x2="5" y2="4" />
                  <line x1="11" y1="1.5" x2="11" y2="4" />
                </svg>
                {formatarData(detalhe.data.pedido.criado_em)} · Retirada
              </span>
            </div>

            {detalhe.data.anulacao && (
              <section className="pedmodal-anulacao" aria-label="Anulação">
                <h3>Anulação</h3>
                <p>{formatarData(detalhe.data.anulacao.criado_em)} · {detalhe.data.anulacao.usuario_nome}</p>
                <p>Motivo: {detalhe.data.anulacao.motivo || "Não informado"}</p>
                <p>{detalhe.data.anulacao.estoque_acao === "DEVOLVER"
                  ? "Produtos baixados repostos e reservas liberadas, quando aplicável."
                  : "Estoque mantido como estava."}</p>
                <p>Impacto nos totais: -{formatarPreco(detalhe.data.anulacao.liquido_original_centavos)}</p>
                <p>Os valores abaixo preservam o histórico original.</p>
              </section>
            )}
            <PedidoItens
              itens={detalhe.data.itens}
              valorTotalCentavos={detalhe.data.pedido.valor_total_centavos}
              anulado={detalhe.anulado}
              arquivado={detalhe.data.pedido.arquivado === 1}
              origemPedido={detalhe.data.pedido.origem_pedido}
              statusComanda={detalhe.data.pedido.status_comanda}
              statusPedido={detalhe.data.pedido.status_pedido}
              onAbrirHistorico={() => detalhe.setHistoricoAberto(true)}
              onAdicionarItem={() => detalhe.setAdicionandoItem(true)}
              onVerCancelamento={(itemId) => detalhe.setItemCancelamentoPreviewId(itemId)}
              onTrocarItem={(item) => detalhe.setItemTroca(item)}
            />

            <div className="pedmodal-divider" />

            <PedidoPagamento
              pedido={detalhe.data.pedido}
              financeiro={detalhe.data.financeiro}
              capacidadeCobravelCentavos={detalhe.data.capacidadeCobravelCentavos}
              pixAdminPendentes={detalhe.data.pixAdminPendentes}
              operacoesInconclusivas={detalhe.data.operacoesInconclusivas}
              anulado={detalhe.anulado}
              trocaAguardandoCobranca={detalhe.trocaAguardandoCobranca}
              registrandoPagamento={detalhe.registrandoPagamento}
              metodoPagamento={detalhe.metodoPagamento}
              valorPagamento={detalhe.valorPagamento}
              pagamentoEmVoo={detalhe.pagamentoEmVoo}
              pagamentoError={detalhe.pagamentoError}
              gerando={detalhe.gerando}
              regenerandoId={detalhe.regenerandoId}
              pixError={detalhe.pixError}
              pixAviso={detalhe.pixAviso}
              agora={detalhe.agora}
              copiedId={detalhe.copiedId}
              onAbrirRegistroPagamento={detalhe.abrirRegistroPagamento}
              onMetodoPagamentoChange={detalhe.selecionarMetodoPagamento}
              onValorPagamentoChange={(valor) => {
                detalhe.setValorPagamento(valor);
                detalhe.setPagamentoError(null);
                detalhe.pagamentoKeyRef.current = null;
              }}
              onRegistrarPagamento={detalhe.registrarPagamento}
              onCancelarRegistroPagamento={() => {
                detalhe.setRegistrandoPagamento(false);
                detalhe.setPagamentoError(null);
                detalhe.pagamentoKeyRef.current = null;
              }}
              onGerarPix={detalhe.gerarPix}
              onCopiarCodigo={detalhe.copiarCodigo}
              onAtualizarPedido={() => void detalhe.carregarPedido(true)}
              onLimparPixAviso={() => {
                detalhe.setPixAviso(null);
                void detalhe.carregarPedido(true);
              }}
            />
          </div>
        )}
      </div>
      {detalhe.confirmarExclusao && detalhe.data && !detalhe.anulado && (
        <ExcluirPedidoModal orderId={orderId} liquidoCentavos={detalhe.data.financeiro.liquidoCentavos}
          onClose={() => detalhe.setConfirmarExclusao(false)} onDeleted={() => {
            detalhe.setConfirmarExclusao(false);
            onStatusChanged?.();
            onClose();
          }} />
      )}
      {detalhe.confirmarArquivamento && (
        <ConfirmDialog
          title="Arquivar pedido"
          message="O pedido sairá da lista principal, mas todo o histórico financeiro e operacional será preservado."
          confirmLabel="Arquivar"
          cancelLabel="Cancelar"
          onConfirm={() => {
            detalhe.setConfirmarArquivamento(false);
            detalhe.executarArquivamento(true);
          }}
          onCancel={() => detalhe.setConfirmarArquivamento(false)}
        />
      )}
      {detalhe.data && detalhe.historicoAberto && (
        <HistoricoComandaModal
          orderId={orderId}
          onClose={() => detalhe.setHistoricoAberto(false)}
          readOnly={detalhe.anulado}
          onVerCancelamento={detalhe.verCancelamentoDoHistorico}
          onVerTroca={detalhe.verTrocaDoHistorico}
        />
      )}
      {detalhe.data && !detalhe.anulado && detalhe.adicionandoItem && (
        <AdicionarItemModal
          orderId={orderId}
          onClose={() => detalhe.setAdicionandoItem(false)}
          onAdded={async () => {
            await detalhe.carregarPedido(true);
          }}
        />
      )}
      {!detalhe.anulado && detalhe.itemCancelamentoPreviewId !== null && (
        <CancelamentoItemPreviewModal
          orderId={orderId}
          itemId={detalhe.itemCancelamentoPreviewId}
          onClose={() => detalhe.setItemCancelamentoPreviewId(null)}
          existingCancellationId={detalhe.data?.itens.find((item) => item.id === detalhe.itemCancelamentoPreviewId)?.cancelamento_id}
          onChanged={async () => { await detalhe.carregarPedido(true); onStatusChanged?.(); }}
        />
      )}
      {!detalhe.anulado && detalhe.itemTroca && (
        <TrocarItemModal
          orderId={orderId}
          item={detalhe.itemTroca}
          existingExchangeId={
            detalhe.itemTroca.troca_item_origem_id === detalhe.itemTroca.id
              ? detalhe.itemTroca.troca_id
              : null
          }
          existingExchangeStatus={detalhe.itemTroca.troca_status}
          onClose={() => detalhe.setItemTroca(null)}
          onChanged={async () => {
            await detalhe.carregarPedido(true);
            onStatusChanged?.();
          }}
        />
      )}
    </div>,
    document.body,
  );
}
