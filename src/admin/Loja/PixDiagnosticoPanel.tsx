import { useRef, useState } from "react";
import { novaOperationKey } from "../../lib/operationKey";

interface PixDiagnosticoResultado {
  valorCentavos: number;
  mpPaymentId: string;
  qrCode: string | null;
  qrCodeBase64: string | null;
  ticketUrl: string | null;
  expiresAt: string | null;
}

interface PixReembolsoResultado {
  refundId: string;
  status: string;
}

const STATUS_PIX_LABEL: Record<string, string> = {
  PAGO: "Pago",
  PENDENTE: "Aguardando pagamento",
  CANCELADO: "Cancelado",
  EXPIRADO: "Expirado"
};

function formatarHorario(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Card "Pix real de diagnóstico" (Admin > Loja): gera um Pix de centavos, confere o pagamento e testa o
// estorno. Os refs de operationKey e de requisição em voo ficam aqui: cada ciclo (gerar, estornar) tem a
// sua própria intenção. As classes vêm de AdminLoja.css.
export default function PixDiagnosticoPanel() {
  const [pixLoading, setPixLoading] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);
  const [pixResultado, setPixResultado] = useState<PixDiagnosticoResultado | null>(null);
  const [pixCopiado, setPixCopiado] = useState(false);
  const pixOperationKeyRef = useRef<string | null>(null);
  // Guarda SÍNCRONA contra duplo-clique: cliques na mesma rajada acontecem
  // antes de o React aplicar o `setPixLoading(true)` do primeiro, então o
  // estado sozinho não bastaria para barrar o segundo e o terceiro clique.
  const pixEmVooRef = useRef(false);

  const [pixStatus, setPixStatus] = useState<string | null>(null);
  const [pixStatusLoading, setPixStatusLoading] = useState(false);
  const [pixStatusError, setPixStatusError] = useState<string | null>(null);
  const pixStatusEmVooRef = useRef(false);

  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundResultado, setRefundResultado] = useState<PixReembolsoResultado | null>(null);
  const refundOperationKeyRef = useRef<string | null>(null);
  const refundEmVooRef = useRef(false);

  const gerarPixDiagnostico = async () => {
    if (pixEmVooRef.current) return;
    pixEmVooRef.current = true;
    setPixLoading(true);
    setPixError(null);
    // Um Pix novo apaga status/estorno do diagnóstico anterior — cada
    // `mpPaymentId` tem seu próprio ciclo de verificação e estorno.
    setPixStatus(null);
    setPixStatusError(null);
    setRefundResultado(null);
    setRefundError(null);
    refundOperationKeyRef.current = null;
    if (!pixOperationKeyRef.current) {
      pixOperationKeyRef.current = novaOperationKey();
    }
    try {
      const response = await fetch("/api/admin/diagnosticos/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationKey: pixOperationKeyRef.current })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setPixError(data?.error || "Não foi possível gerar o Pix de diagnóstico");
        return;
      }
      setPixResultado(data);
      // Sucesso encerra esta intenção — o próximo clique é um Pix novo.
      pixOperationKeyRef.current = null;
    } catch {
      setPixError("Falha de conexão ao gerar o Pix de diagnóstico");
    } finally {
      pixEmVooRef.current = false;
      setPixLoading(false);
    }
  };

  const verificarPixDiagnostico = async () => {
    if (pixStatusEmVooRef.current || !pixResultado) return;
    pixStatusEmVooRef.current = true;
    setPixStatusLoading(true);
    setPixStatusError(null);
    try {
      const response = await fetch(
        `/api/admin/diagnosticos/pix-status?mpPaymentId=${encodeURIComponent(pixResultado.mpPaymentId)}`
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setPixStatusError(data?.error || "Não foi possível verificar o pagamento");
        return;
      }
      setPixStatus(data.status);
    } catch {
      setPixStatusError("Falha de conexão ao verificar o pagamento");
    } finally {
      pixStatusEmVooRef.current = false;
      setPixStatusLoading(false);
    }
  };

  const testarReembolsoPixDiagnostico = async () => {
    if (refundEmVooRef.current || !pixResultado) return;
    refundEmVooRef.current = true;
    setRefundLoading(true);
    setRefundError(null);
    if (!refundOperationKeyRef.current) {
      refundOperationKeyRef.current = novaOperationKey();
    }
    try {
      const response = await fetch("/api/admin/diagnosticos/pix-reembolso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mpPaymentId: pixResultado.mpPaymentId,
          operationKey: refundOperationKeyRef.current
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setRefundError(data?.error || "Não foi possível estornar o Pix de diagnóstico");
        return;
      }
      setRefundResultado(data);
      // Sucesso encerra esta intenção — repetir estorno do MESMO pagamento
      // não é uma nova intenção, então o botão fica desabilitado depois.
      refundOperationKeyRef.current = null;
    } catch {
      setRefundError("Falha de conexão ao estornar o Pix de diagnóstico");
    } finally {
      refundEmVooRef.current = false;
      setRefundLoading(false);
    }
  };

  const copiarPixDiagnostico = async () => {
    if (!pixResultado?.qrCode) return;
    try {
      await navigator.clipboard.writeText(pixResultado.qrCode);
      setPixCopiado(true);
      setTimeout(() => setPixCopiado(false), 2000);
    } catch {
      // Sem clipboard disponível: o código continua selecionável na caixa.
    }
  };

  return (
    <div className="loj-diag-card">
      <div className="loj-diag-card-header">
        <span className="loj-diag-card-title">Pix real de diagnóstico</span>
        <span className="loj-badge-cost">R$ 0,01</span>
      </div>
      <p className="loj-diag-card-desc">
        Cria um Pix real de centavos para confirmar que a integração com o banco está de pé e ativa.
      </p>
      <button
        type="button"
        className="loj-diag-action"
        onClick={gerarPixDiagnostico}
        disabled={pixLoading}
      >
        {pixLoading ? "Gerando..." : "Gerar QR Code Pix"}
      </button>
      {pixError && <p className="loj-diag-error">{pixError}</p>}
      {pixResultado && (
        <div className="loj-diag-pix-result">
          <p className="loj-diag-pix-valor">
            R$ {(pixResultado.valorCentavos / 100).toFixed(2).replace(".", ",")}
          </p>
          {pixResultado.qrCodeBase64 && (
            <img
              className="loj-diag-pix-qr"
              src={`data:image/png;base64,${pixResultado.qrCodeBase64}`}
              alt="QR Code do Pix de diagnóstico"
            />
          )}
          {pixResultado.qrCode && (
            <div className="loj-diag-pix-copy-row">
              <span className="loj-diag-pix-copy-label">Pix copia e cola</span>
              <div className="loj-diag-pix-code-box">
                <code>{pixResultado.qrCode}</code>
                <button
                  type="button"
                  className="loj-diag-pix-copy-btn"
                  onClick={copiarPixDiagnostico}
                >
                  {pixCopiado ? "Copiado!" : "Copiar"}
                </button>
              </div>
            </div>
          )}
          {pixResultado.expiresAt && (
            <p className="loj-diag-pix-expira">
              Expira às {formatarHorario(pixResultado.expiresAt)}
            </p>
          )}

          <div className="loj-diag-pix-status-row">
            <button
              type="button"
              className="loj-diag-pix-copy-btn"
              onClick={verificarPixDiagnostico}
              disabled={pixStatusLoading}
            >
              {pixStatusLoading ? "Verificando..." : "Verificar pagamento"}
            </button>
            {pixStatus && (
              <span
                className={`loj-diag-pix-status loj-diag-pix-status--${pixStatus.toLowerCase()}`}
              >
                {STATUS_PIX_LABEL[pixStatus] ?? pixStatus}
              </span>
            )}
          </div>
          {pixStatusError && <p className="loj-diag-error">{pixStatusError}</p>}

          {pixStatus === "PAGO" && (
            <div className="loj-diag-pix-refund">
              <button
                type="button"
                className="loj-diag-pix-copy-btn"
                onClick={testarReembolsoPixDiagnostico}
                disabled={refundLoading || !!refundResultado}
              >
                {refundLoading
                  ? "Estornando..."
                  : refundResultado
                    ? "Estornado"
                    : "Testar reembolso"}
              </button>
              {refundResultado && (
                <p className="loj-diag-success">
                  Estorno confirmado (MP #{refundResultado.refundId}).
                </p>
              )}
              {refundError && <p className="loj-diag-error">{refundError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
