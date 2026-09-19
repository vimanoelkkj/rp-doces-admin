import "./GerandoPagamento.css";

export default function GerandoPagamento() {
  return (
    <main className="gerando-page">
      <div className="gerando-ilustracao" aria-hidden="true">
        <span className="moeda moeda-1" />
        <span className="moeda moeda-2" />
        <span className="moeda moeda-3" />

        <div className="pote">
          <span className="pote-borda" />
          <span className="pote-brilho" />
        </div>

        <span className="pote-sombra" />
      </div>

      <h1>Gerando pagamento</h1>

      <p>
        Aguarde um momento enquanto preparamos sua cobrança
      </p>

      <strong className="gerando-marca">R&amp;P Doces</strong>
    </main>
  );
}
