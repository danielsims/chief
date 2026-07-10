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
    <div className="min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere] [&_a]:break-all [&_code]:break-all [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
      <Suspense
        fallback={
          <div className="max-w-full whitespace-pre-wrap break-all [overflow-wrap:anywhere]">
            {children}
          </div>
        }
      >
        <Streamdown animated={streaming} isAnimating={streaming}>
          {children}
        </Streamdown>
      </Suspense>
    </div>
  );
}
