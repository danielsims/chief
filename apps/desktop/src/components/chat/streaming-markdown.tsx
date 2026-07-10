import { lazy, Suspense } from "react";

// Start loading as soon as the chat bundle is evaluated, but keep Streamdown's
// parser and highlighting code out of the desktop entry chunk.
const streamdownModule = import("streamdown");
const Streamdown = lazy(() =>
  streamdownModule.then((module) => ({ default: module.Streamdown })),
);

export function StreamingMarkdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
      <Streamdown animated={streaming} isAnimating={streaming}>
        {children}
      </Streamdown>
    </Suspense>
  );
}
