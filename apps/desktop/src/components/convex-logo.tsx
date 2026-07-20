import convexSymbol from "../assets/convex-symbol-color.svg";

export function ConvexLogo({
  className,
  size,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src={convexSymbol}
      alt=""
      aria-hidden="true"
      className={className}
      style={size ? { width: size, height: size } : undefined}
    />
  );
}
