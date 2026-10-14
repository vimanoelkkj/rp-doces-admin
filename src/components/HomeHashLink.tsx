import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { useLinkClickHandler, useLocation } from "react-router-dom";

interface HomeHashLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  /** Home section, e.g. "#sobre". */
  hash: `#${string}`;
}

// Link to a section of the Home. It stays a real anchor (new tab, copy link and middle click keep
// working) and a plain click goes through the Router, so history keeps its metadata, repeated
// clicks replace the entry and the Home scrolls once, in useHomeHashScroll.
export default function HomeHashLink({
  hash,
  onClick,
  children,
  ...anchorProps
}: HomeHashLinkProps) {
  const location = useLocation();
  const onHome = location.pathname === "/";
  const goToSection = useLinkClickHandler<HTMLAnchorElement>(
    { pathname: "/", hash },
    { state: onHome ? location.state : undefined }
  );

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) goToSection(event);
  };

  return (
    <a {...anchorProps} href={onHome ? hash : `/${hash}`} onClick={handleClick}>
      {children}
    </a>
  );
}
