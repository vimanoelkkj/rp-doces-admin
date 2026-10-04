// Último pedido deste navegador: o mínimo para reencontrar o acompanhamento em
// `/pedido/:token` quando o `location.state` se perde (aba fechada, outro
// navegador, voltar dias depois).
//
// Guarda SÓ `{ tokenPublico, salvoEm }`. O token já é o identificador público do
// pedido (vive na URL de acompanhamento) e `salvoEm` existe apenas para o TTL
// local. Nome, telefone, itens, valores, QR Code, pedidoId, status e
// operationKey nunca entram aqui.
//
// `localStorage`, e não `sessionStorage`: o registro precisa sobreviver a fechar
// a aba e o navegador. Todo acesso é protegido: em aba privada, com dados de
// site bloqueados ou sem Web Storage a leitura volta vazia e a página segue como
// antes, só sem a recuperação.

const CHAVE = "rp-doces:ultimo-pedido:v1";

export const ULTIMO_PEDIDO_TTL_MS = 48 * 60 * 60 * 1000;

// Folga para o relógio ajustado para trás logo depois de gravar. Além dela, um
// `salvoEm` no futuro é lixo: sem esse teto, um valor absurdo nunca expiraria.
const FOLGA_RELOGIO_MS = 5 * 60 * 1000;

// Mesmo limite de tamanho que o servidor aplica ao token (/api/pedido).
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{1,100}$/;

function tokenValido(valor: unknown): valor is string {
  return typeof valor === "string" && TOKEN_VALIDO.test(valor);
}

function removerRegistro(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // nada a fazer
  }
}

// Registro íntegro -> token; qualquer outra coisa (JSON quebrado, campo a mais
// ou a menos, token inválido, vencido) -> null.
function tokenDoRegistro(bruto: string, agora: number): string | null {
  let registro: unknown;
  try {
    registro = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (typeof registro !== "object" || registro === null || Array.isArray(registro)) return null;

  const { tokenPublico, salvoEm, ...resto } = registro as Record<string, unknown>;
  if (Object.keys(resto).length > 0) return null;
  if (!tokenValido(tokenPublico)) return null;
  if (typeof salvoEm !== "number" || !Number.isFinite(salvoEm)) return null;

  const idade = agora - salvoEm;
  if (idade < -FOLGA_RELOGIO_MS || idade >= ULTIMO_PEDIDO_TTL_MS) return null;
  return tokenPublico;
}

export function lembrarUltimoPedido(tokenPublico: unknown, agora: number = Date.now()): void {
  if (!tokenValido(tokenPublico)) return;
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ tokenPublico, salvoEm: agora }));
  } catch {
    // Sem persistência a tela segue como antes; só perde a recuperação.
  }
}

// Remove o registro inválido ou vencido que encontrar (idempotente).
export function lerUltimoPedido(agora: number = Date.now()): string | null {
  let bruto: string | null;
  try {
    bruto = localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
  if (bruto === null) return null;

  const token = tokenDoRegistro(bruto, agora);
  if (token === null) removerRegistro();
  return token;
}

// Só apaga se o registro guardado for deste mesmo token: ver outro pedido (ou
// um 404 de outro token) não derruba o link do último pedido.
export function esquecerUltimoPedido(tokenPublico: string): void {
  if (lerUltimoPedido() === tokenPublico) removerRegistro();
}

// Estados em que não há mais o que acompanhar. EXPIRADO fica de fora de propósito: um Pix
// tardio ainda pode virar PAGO, então o TTL do último pedido é quem o encerra.
export function pedidoEncerrado(status: {
  statusPagamento?: string;
  statusPedido?: string;
}): boolean {
  return (
    status.statusPedido === "ENTREGUE" ||
    status.statusPedido === "CANCELADO" ||
    status.statusPagamento === "CANCELADO" ||
    status.statusPagamento === "REEMBOLSADO"
  );
}
