import Image from "next/image";

/** Chief's mark at the top of a browser page. */
export function ChiefBrand() {
  return (
    <Image
      alt="Chief"
      className="h-8 w-8"
      src="/brand/chief-mark-white.svg"
      width={32}
      height={32}
    />
  );
}
