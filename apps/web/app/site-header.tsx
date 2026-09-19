import Link from "next/link";

import { cn } from "@chief/ui/lib/utils";

import { ChiefWordmark } from "./chief-mark";
import { GetAppButton } from "./get-app-button";

const links = [
  { href: "/#product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
];

export function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  return (
    <header
      className={cn(
        "relative z-10 mx-auto flex max-w-[1440px] items-center justify-between px-[5%] py-8 text-sm max-md:px-[6%] max-md:py-[22px]",
        overlay ? "text-white" : "text-foreground",
      )}
    >
      <ChiefWordmark
        className={cn(
          "text-[31px] tracking-[-0.055em] max-md:text-[27px]",
          overlay ? "text-white" : "text-foreground",
        )}
      />
      <nav
        aria-label="Main navigation"
        className="flex gap-[34px] max-md:hidden"
      >
        {links.map((link) => (
          <Link
            className={cn(
              "transition-colors",
              overlay
                ? "text-white/85 hover:text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <GetAppButton align="end" size="sm" />
    </header>
  );
}
