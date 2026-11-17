import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

/** Fade the foot only while there is more content below the viewport. */
export function ScrollList({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className: string;
  label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () =>
      setMore(
        element.scrollTop + element.clientHeight < element.scrollHeight - 4,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [children]);
  return (
    <div ref={list} className={className} aria-label={label} data-more={more}>
      {children}
    </div>
  );
}
