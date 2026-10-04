import { useState } from "react";

// Seção "Imagens da página inicial" (Admin > Loja): miniaturas da imagem principal e de "Nossa história".
// O estado é só local (não é salvo com a configuração) e "Escolher" ainda não tem ação. As classes vêm de
// AdminLoja.css.
export default function ImagensPaginaInicialPanel() {
  const [heroImg, setHeroImg] = useState<string | null>("/images/hero.jpg");
  const [storyImg, setStoryImg] = useState<string | null>("/images/story.jpg");

  return (
    <section className="loj-panel">
      <h2 className="loj-panel-title">Imagens da página inicial</h2>
      <div className="loj-images-row">
        <div className="loj-image-slot">
          <div className="loj-image-thumb">
            {heroImg ? (
              <img src={heroImg} alt="Imagem principal" />
            ) : (
              <span className="loj-image-empty">Sem imagem</span>
            )}
          </div>
          <span className="loj-image-label">Imagem principal</span>
          <div className="loj-image-actions">
            <button type="button" className="loj-image-link">
              Escolher
            </button>
            <button type="button" className="loj-image-link" onClick={() => setHeroImg(null)}>
              Remover
            </button>
          </div>
        </div>
        <div className="loj-image-slot">
          <div className="loj-image-thumb">
            {storyImg ? (
              <img src={storyImg} alt="Nossa história" />
            ) : (
              <span className="loj-image-empty">Sem imagem</span>
            )}
          </div>
          <span className="loj-image-label">Nossa história</span>
          <div className="loj-image-actions">
            <button type="button" className="loj-image-link">
              Escolher
            </button>
            <button type="button" className="loj-image-link" onClick={() => setStoryImg(null)}>
              Remover
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
