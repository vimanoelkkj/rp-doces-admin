import "./PreparandoPedido.css";

export default function PreparandoPedido() {
  return (
    <div className="preparando-screen">
      <div className="preparando-content">

        {/* Cupcake com cerejinha animada */}
        <div className="preparando-cupcake">
          <svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">

            {/* Cupcake body (estático) */}
            <g className="cupcake-body">
              {/* Frosting shadow */}
              <path
                d="M34 58.5C34 48.6 41.8 40.4 51.7 39.9C54.5 31.8 61.9 26 70.6 26C79.6 26 87.3 32.2 89.9 40.7C98.4 41.9 105 49.2 105 58C105 67.7 97.1 75.5 87.5 75.5H49.5C40.9 75.5 34 68.8 34 60.5V58.5Z"
                fill="#634738"
                opacity="0.08"
              />
              {/* Frosting */}
              <path
                d="M36 56.5C36 47.7 43 40.4 51.8 39.9C54.2 32.5 60.9 27.2 68.9 27.2C77.1 27.2 84.1 32.9 86.3 40.7C94.3 41.8 100.5 48.7 100.5 57C100.5 66.1 93.1 73.5 84 73.5H49.5C42 73.5 36 67.5 36 60V56.5Z"
                fill="#D38B80"
              />
              {/* Frosting highlight */}
              <path
                d="M52.5 42.5C55.3 36.9 61.1 33.2 67.9 33.2C73.3 33.2 78.2 35.6 81.4 39.5C80 39.1 78.6 38.9 77.1 38.9C71.7 38.9 66.9 41 63.5 44.4C61.3 42.9 58.6 42 55.8 42C54.7 42 53.6 42.2 52.5 42.5Z"
                fill="#EADFD3"
                opacity="0.95"
              />
              {/* Small front highlight */}
              <ellipse cx="59" cy="56" rx="4.5" ry="3.2" fill="#EADFD3" opacity="0.65" />
              {/* Cup wrapper */}
              <path
                d="M47 73.5H89L83.4 99.7C82.6 103.2 79.5 105.8 75.9 105.8H60.1C56.5 105.8 53.4 103.2 52.6 99.7L47 73.5Z"
                fill="#634738"
              />
              {/* Cup wrapper top edge */}
              <path d="M47 73.5H89" stroke="#EADFD3" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
              {/* Wrapper folds */}
              <path d="M58 79L55.8 101" stroke="#EADFD3" strokeWidth="2.6" strokeLinecap="round" opacity="0.95" />
              <path d="M68 79V102" stroke="#EADFD3" strokeWidth="2.6" strokeLinecap="round" opacity="0.95" />
              <path d="M78 79L80.2 101" stroke="#EADFD3" strokeWidth="2.6" strokeLinecap="round" opacity="0.95" />
            </g>

            {/* Cerejinha animada (cai de cima) */}
            <g className="cherry-group">
              <circle cx="79.5" cy="23.5" r="5.5" fill="#634738" />
              <path
                d="M82.8 19.5C84.8 16.5 88.2 14.8 91.8 14.8C90.5 18.4 87.8 21.1 84.1 22.3L82.8 19.5Z"
                fill="#D38B80"
              />
            </g>

          </svg>
        </div>

        {/* Bolinhas pulsantes */}
        <div className="preparando-dots">
          <span className="preparando-dot" />
          <span className="preparando-dot" />
          <span className="preparando-dot" />
        </div>

        {/* Texto */}
        <h2 className="preparando-title">Preparando seu pedido...</h2>
        <p className="preparando-subtitle">Os melhores doces já vêm!</p>
      </div>

      {/* Footer */}
      <p className="preparando-footer">R&P Doces</p>
    </div>
  );
}
