type BrandMarkProps = {
  className?: string;
  size: number;
  tone?: "black" | "white";
};

export function BrandMark({
  className,
  size,
  tone = "white",
}: BrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      src={`/brand/chief-mark-sharp-open-${tone}.svg`}
      style={{ height: size, width: size }}
    />
  );
}
