export function isEscapeKey(event) {
  return event?.key === "Escape";
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
