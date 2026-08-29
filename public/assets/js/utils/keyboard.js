function paymentInteractionLocked() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector('#rp-app > [data-region]:not([data-region="payment"])[inert]'));
}
export function isEscapeKey(event) {
  return event?.key === "Escape" && !paymentInteractionLocked();
}
export function isActivationKey(event) {
  return event?.key === "Enter" || event?.key === " ";
}
export function shouldIgnoreShortcut(event) {
  const tag = event?.target?.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event?.target?.isContentEditable
  );
}
