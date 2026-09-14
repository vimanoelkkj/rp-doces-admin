import "./Footer.css";

export default function Footer() {
  return (
    <footer className="footer" id="contato">
      <div className="footer-top">
        <div className="footer-brand">
          <div className="footer-brand-name">R&amp;P Doces</div>
          <p>
            Artesanal e cheio de afeto. Criando momentos de puro prazer
            açucarado para o seu ritual de autocuidado diário.
          </p>
        </div>

        <div className="footer-col">
          <h4>Explorar</h4>
          <a href="#cardapio">Cardápio</a>
          <a href="#sobre">Nossa História</a>
          <a href="#onde-estamos">Onde estamos</a>
        </div>

        <div className="footer-col">
          <h4>Localização &amp; Contato</h4>
          <p>
            Temponi Concept - Cambuí, Campinas
            <br />
            Rua Luís Barrozi Pereira, 582 - Sala 07
          </p>
          <p className="footer-phone">(19) 99876-5432</p>
        </div>
      </div>

      <div className="footer-branding" aria-hidden="true">
        R&amp;P DOCES
      </div>

      <div className="footer-bottom">
        <p>© 2026 R&amp;P Doces. Todos os direitos reservados.</p>
        <div className="footer-bottom-right">
          <span>Campinas, SP</span>
          <span>Feito com carinho no Cambuí</span>
        </div>
      </div>
    </footer>
  );
}
