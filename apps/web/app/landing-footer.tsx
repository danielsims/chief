import Link from "next/link";

import { cn } from "@chief/ui/lib/utils";

import { ChiefWordmark } from "./chief-mark";

export function LandingFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "bg-background text-foreground shadow-[0_-1px_0_var(--border)]",
        className,
      )}
    >
      <div className="mx-auto w-[min(1120px,calc(100%-48px))] max-md:w-[calc(100%-40px)]">
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-8 gap-y-12 py-[72px] pb-20 max-md:grid-cols-1 max-md:gap-y-9 max-md:py-12 max-md:pb-14">
          <div>
            <ChiefWordmark
              className="text-[28px] tracking-[-0.05em]"
              markClassName="size-[22px]"
            />
            <small className="text-muted-foreground mt-7 block text-[13px]">
              © 2026 Latent Supply Pty Ltd
            </small>
          </div>
          <nav
            aria-label="Product"
            className="flex flex-col items-start gap-3 pt-2"
          >
            <strong className="mb-1.5 text-[13px] font-medium">Product</strong>
            <Link
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="/#product"
            >
              Workspace
            </Link>
            <Link
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="/download"
            >
              Download
            </Link>
            <Link
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="/host"
            >
              Host a relay
            </Link>
            <Link
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="/#faq"
            >
              FAQs
            </Link>
            <a
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="https://github.com/danielsims/chief"
              rel="noreferrer"
              target="_blank"
            >
              Open source
            </a>
          </nav>
          <nav
            aria-label="Company"
            className="flex flex-col items-start gap-3 pt-2"
          >
            <strong className="mb-1.5 text-[13px] font-medium">Company</strong>
            <Link
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="/pricing"
            >
              Pricing
            </Link>
            <Link
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="/privacy"
            >
              Privacy
            </Link>
            <Link
              className="text-muted-foreground hover:text-foreground text-[15px]"
              href="/terms"
            >
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
