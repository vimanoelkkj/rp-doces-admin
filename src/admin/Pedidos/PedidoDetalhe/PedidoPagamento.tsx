import type {
  MetodoPagamentoManual,
  OperacaoInconclusiva,
  PedidoRow,
  PixAdminPendente,
} from "./types";
import { formatarFinanceiro, type FinanceiroPedido } from "../formatarFinanceiro";
import { formatarPreco } from "./helpers";

interface PedidoPagamentoProps {
  pedido: PedidoRow;
  financeiro: FinanceiroPedido;
  capacidadeCobravelCentavos: number;
  pixAdminPendentes: PixAdminPendente[];
  operacoesInconclusivas: OperacaoInconclusiva[];
  anulado: boolean;
  trocaAguardandoCobranca: boolean;
  registrandoPagamento: boolean;
  metodoPagamento: MetodoPagamentoManual;
  valorPagamento: string;
  pagamentoEmVoo: boolean;
  pagamentoError: string | null;
  gerando: boolean;
  regenerandoId: number | null;
  pixError: string | null;
  pixAviso: string | null;
  agora: number;
  copiedId: number | null;
  onAbrirRegistroPagamento: () => void;
  onMetodoPagamentoChange: (metodo: MetodoPagamentoManual) => void;
  onValorPagamentoChange: (valor: string) => void;
  onRegistrarPagamento: () => void;
  onCancelarRegistroPagamento: () => void;
  onGerarPix: (substituiId?: number, valorCentavos?: number) => void;
  onCopiarCodigo: (pixId: number, codigo: string) => void;
  onAtualizarPedido: () => void;
  onLimparPixAviso: () => void;
}

export default function PedidoPagamento({
  pedido,
  financeiro,
  capacidadeCobravelCentavos,
  pixAdminPendentes,
  operacoesInconclusivas,
  anulado,
  trocaAguardandoCobranca,
  registrandoPagamento,
  metodoPagamento,
  valorPagamento,
  pagamentoEmVoo,
  pagamentoError,
  gerando,
  regenerandoId,
  pixError,
  pixAviso,
  agora,
  copiedId,
  onAbrirRegistroPagamento,
  onMetodoPagamentoChange,
  onValorPagamentoChange,
  onRegistrarPagamento,
  onCancelarRegistroPagamento,
  onGerarPix,
  onCopiarCodigo,
  onAtualizarPedido,
  onLimparPixAviso,
}: PedidoPagamentoProps) {
  const finFormatado = formatarFinanceiro(financeiro);
  const podeRegistrarPagamento = Boolean(
    !anulado &&
      pedido.arquivado === 0 &&
      capacidadeCobravelCentavos > 0 &&
      (pedido.status_comanda === "ABERTA" ||
        pedido.status_pedido === "ENTREGUE"),
  );
  const podeGerarPix = Boolean(
    !anulado &&
      pedido.arquivado === 0 &&
      capacidadeCobravelCentavos > 0 &&
      (pedido.status_comanda === "ABERTA" ||
        pedido.status_pedido === "ENTREGUE"),
  );

  return (
    <div className="pedmodal-payment">
      <span className="pedmodal-section-label">Pagamento</span>
      <div className="pedmodal-payment-row">
        <span className={`pedmodal-badge pedmodal-badge--${finFormatado.cor}`}>
          {finFormatado.badge}
        </span>
        {finFormatado.detalhe && (
          <span className="pedmodal-payment-method">{finFormatado.detalhe}</span>
        )}
      </div>

      <div className="pedmodal-financial-grid">
        <div className="pedmodal-financial-row">
          <span>Total</span>
          <strong>{formatarPreco(financeiro.totalCentavos)}</strong>
        </div>
        <div className="pedmodal-financial-row">
          <span>Pago</span>
          <strong>{formatarPreco(financeiro.brutoPagoCentavos)}</strong>
        </div>
        {financeiro.reembolsadoCentavos > 0 && (
          <div className="pedmodal-financial-row">
            <span>Reembolsado</span>
            <strong>- {formatarPreco(financeiro.reembolsadoCentavos)}</strong>
          </div>
        )}
        <div className="pedmodal-financial-row">
          <span>Líquido</span>
          <strong>{formatarPreco(financeiro.liquidoCentavos)}</strong>
        </div>
        <div className="pedmodal-financial-row pedmodal-financial-row--balance">
          <span>Saldo</span>
          <strong>{formatarPreco(financeiro.saldoCentavos)}</strong>
        </div>
      </div>

      {financeiro.temExcesso && (
        <div className="pedmodal-pix-aviso" role="alert">
          <span>
            ⚠ <strong>Sobrepagamento identificado:</strong> Recebido {formatarPreco(financeiro.liquidoCentavos)} de um total de {formatarPreco(financeiro.totalCentavos)} (excesso de {formatarPreco(financeiro.excessoCentavos)}).
          </span>
        </div>
      )}

      {/* B-3: cobrança cujo envio ao Mercado Pago ficou inconclusivo.
          Reusa o mesmo bloco de aviso do caminho ambíguo, porque a
          ação correta é idêntica: nunca tentar de novo às cegas, só
          reler o que persistiu. A recuperação read-only roda sozinha
          na carga da listagem; este bloco existe para o caso não
          convergir. Nenhum estado é inventado aqui. */}
      {operacoesInconclusivas.length > 0 && (
        <div className="pedmodal-pix-aviso">
          <span>
            ⚠ {operacoesInconclusivas.length === 1 ? "Uma cobrança" : "Cobranças"} deste
            pedido não teve confirmação do Mercado Pago. Verificamos automaticamente; não
            gere outra sem conferir.
          </span>
          <button
            type="button"
            className="pedmodal-btn-edit"
            onClick={onAtualizarPedido}
          >
            Atualizar pedido
          </button>
        </div>
      )}

      {pixError && <p className="pedmodal-status-error">{pixError}</p>}
      {pixAviso && (
        <div className="pedmodal-pix-aviso">
          <span>⚠ {pixAviso}</span>
          <button
            type="button"
            className="pedmodal-btn-edit"
            onClick={onLimparPixAviso}
          >
            Atualizar pedido
          </button>
        </div>
      )}

      {(podeRegistrarPagamento || podeGerarPix) && (
        <div className="pedmodal-charge-block">
          <div className="pedmodal-charge-action">
            <div>
              <strong>
                {trocaAguardandoCobranca
                  ? "Troca aguardando pagamento"
                  : "Saldo aguardando pagamento"}
              </strong>
              <span>
                Saldo: {formatarPreco(capacidadeCobravelCentavos)}.
              </span>
            </div>
            <div className="pedmodal-charge-buttons">
              {podeRegistrarPagamento && (
                <button
                  type="button"
                  className="pedmodal-btn-edit"
                  onClick={onAbrirRegistroPagamento}
                >
                  Registrar pagamento
                </button>
              )}
              {podeGerarPix && (
                <button
                  type="button"
                  className="pedmodal-btn-advance"
                  onClick={() => onGerarPix(undefined, capacidadeCobravelCentavos)}
                  disabled={gerando}
                >
                  {gerando
                    ? "Gerando..."
                    : `Gerar Pix ${formatarPreco(capacidadeCobravelCentavos)}`}
                </button>
              )}
            </div>
          </div>

          {registrandoPagamento && (
            <div className="pedmodal-manual-payment">
              <div>
                <strong>Registrar pagamento recebido</strong>
                <span>O saldo em aberto já está preenchido.</span>
              </div>
              <label>
                Valor recebido
                <div className="pedmodal-money-input">
                  <span>R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={valorPagamento}
                    onChange={(event) => onValorPagamentoChange(event.target.value)}
                    disabled={pagamentoEmVoo}
                    aria-label="Valor recebido"
                  />
                </div>
              </label>
              <label>
                Forma de pagamento
                <select
                  value={metodoPagamento}
                  onChange={(event) =>
                    onMetodoPagamentoChange(
                      event.target.value as MetodoPagamentoManual,
                    )
                  }
                  disabled={pagamentoEmVoo}
                >
                  <option value="DINHEIRO">Dinheiro</option>
                  <option value="CARTAO">Cartão</option>
                  <option value="PIX_EXTERNO">
                    Pix recebido fora do sistema
                  </option>
                </select>
              </label>
              {pagamentoError && (
                <p className="pedmodal-status-error">{pagamentoError}</p>
              )}
              <div className="pedmodal-manual-payment-actions">
                <button
                  type="button"
                  className="pedmodal-btn-advance"
                  onClick={onRegistrarPagamento}
                  disabled={pagamentoEmVoo}
                >
                  {pagamentoEmVoo ? "Registrando..." : "Confirmar pagamento"}
                </button>
                <button
                  type="button"
                  className="pedmodal-btn-edit"
                  onClick={onCancelarRegistroPagamento}
                  disabled={pagamentoEmVoo}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {pixAdminPendentes.map((pix) => {
        const expiraEmMs = pix.expiresAt ? Date.parse(pix.expiresAt) : null;
        const vencido = expiraEmMs !== null && expiraEmMs <= agora;
        const restanteS =
          expiraEmMs !== null ? Math.max(0, Math.floor((expiraEmMs - agora) / 1000)) : null;
        const minutos =
          restanteS !== null ? String(Math.floor(restanteS / 60)).padStart(2, "0") : null;
        const segundos = restanteS !== null ? String(restanteS % 60).padStart(2, "0") : null;

        return (
          <div className="pedmodal-pix-card" key={pix.id}>
            <span className="pedmodal-pix-valor">
              Pix pendente · {formatarPreco(pix.valorCentavos)}
            </span>

            {pix.qrCodeBase64 && (
              <div className="pedmodal-pix-qr">
                <img
                  src={`data:image/png;base64,${pix.qrCodeBase64}`}
                  alt="QR Code Pix"
                />
              </div>
            )}

            {pix.qrCode && (
              <>
                <div className="pedmodal-pix-copy-row">
                  <span className="pedmodal-pix-copy-label">PIX COPIA E COLA</span>
                  <button
                    type="button"
                    className="pedmodal-pix-copy-btn"
                    onClick={() => onCopiarCodigo(pix.id, pix.qrCode!)}
                  >
                    {copiedId === pix.id ? "Copiado!" : "Copiar código"}
                  </button>
                </div>
                <div className="pedmodal-pix-code-box">{pix.qrCode}</div>
              </>
            )}

            {vencido ? (
              <div className="pedmodal-pix-vencido">
                <span>Expiração informada pelo Mercado Pago atingida</span>
                <button
                  type="button"
                  className="pedmodal-btn-edit"
                  onClick={onAtualizarPedido}
                >
                  Atualizar pedido
                </button>
              </div>
            ) : (
              restanteS !== null && (
                <span className="pedmodal-pix-timer">
                  ⏱ Expira em {minutos}:{segundos}
                </span>
              )
            )}

            {!anulado && pedido.arquivado === 0 && (
              <button
                type="button"
                className="pedmodal-btn-edit"
                onClick={() => onGerarPix(pix.id)}
                disabled={regenerandoId === pix.id}
              >
                {regenerandoId === pix.id ? "Regenerando..." : "Regenerar Pix"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
