import Image from "next/image";

interface BrandMarkProps {
  className?: string;
  size: number;
  tone?: "black" | "white";
}

export function BrandMark({ className, size, tone = "white" }: BrandMarkProps) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={className}
      src={`/brand/chief-mark-sharp-open-${tone}.svg`}
      width={size}
      height={size}
    />
  );
}
