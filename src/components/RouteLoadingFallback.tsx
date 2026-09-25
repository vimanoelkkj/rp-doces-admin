import "./RouteLoadingFallback.css";

export default function RouteLoadingFallback() {
  return (
    <div
      className="route-loading-fallback"
      role="status"
      aria-label="Carregando página..."
    >
      <div className="route-spinner" aria-hidden="true" />
    </div>
  );
}
