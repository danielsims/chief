import * as React from "react";

import { cn } from "../lib/utils";

const MATRIX_CELLS = Array.from({ length: 9 }, (_, index) => index);

interface MatrixLoaderStyle extends React.CSSProperties {
  "--matrix-loader-duration": string;
}

export function MatrixLoader({
  ariaLabel = "Working",
  className,
  fps = 7,
  size = 27,
}: {
  ariaLabel?: string;
  className?: string;
  fps?: number;
  size?: number;
}) {
  const gap = (size * 2) / 15;
  const style: MatrixLoaderStyle = {
    "--matrix-loader-duration": `${9 / fps}s`,
    gap,
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gridTemplateRows: "repeat(3, minmax(0, 1fr))",
    height: size,
    width: size,
  };

  return React.createElement(
    "span",
    {
      "aria-label": ariaLabel,
      className: cn("matrix-loader inline-grid shrink-0", className),
      role: "status",
      style,
    },
    MATRIX_CELLS.map((cell) =>
      React.createElement("span", {
        "aria-hidden": true,
        className: "matrix-loader-cell",
        key: cell,
      }),
    ),
  );
}
