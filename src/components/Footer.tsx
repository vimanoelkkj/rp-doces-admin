import { useEffect, useState } from "react";
import {
  DEFAULT_STORE_CONFIG,
  fetchStoreConfig,
  formatStoreWhatsapp,
} from "../api/storeConfig";
import "./Footer.css";

interface FooterProps {
  /** Só a marca d'água de fundo, sem links/contato/copyright — mesmo padrão de `Header minimal`. */
  watermarkOnly?: boolean;
}

export default function Footer({ watermarkOnly = false }: FooterProps) {
  const [storeConfig, setStoreConfig] = useState(DEFAULT_STORE_CONFIG);

  useEffect(() => {
    // A versão watermark-only não exibe nenhum dado da loja e não precisa
    // disparar uma chamada de configuração (inclusive durante o checkout).
    if (watermarkOnly) return;

    let active = true;
    void fetchStoreConfig()
      .then((config) => {
        if (active) setStoreConfig(config);
      })
      .catch(() => {
        // Mantém os dados padrão no rodapé em caso de indisponibilidade.
      });

    return () => {
      active = false;
    };
  }, [watermarkOnly]);

  if (watermarkOnly) {
    return (
      <footer className="footer footer--watermark-only" aria-hidden="true">
        <div className="footer-branding">R&amp;P DOCES</div>
      </footer>
    );
  }

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
            {storeConfig.localName}
            <br />
            {storeConfig.address}
          </p>
          <p className="footer-phone">
            {formatStoreWhatsapp(storeConfig.whatsapp)}
          </p>
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
