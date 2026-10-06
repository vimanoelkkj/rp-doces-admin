export default function StagingIndicator() {
  if (import.meta.env?.VITE_APP_ENV !== "staging") return null;
  return (
    <span
      role="note"
      aria-label="Ambiente de testes: staging"
      style={{
        position: "fixed",
        top: 4,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        pointerEvents: "none",
        padding: "2px 8px",
        borderRadius: 4,
        background: "#78350f",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700
      }}
    >
      STAGING
    </span>
  );
}
