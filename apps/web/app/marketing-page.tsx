import type { ReactNode } from "react";

import { LandingFooter } from "./landing-footer";
import { SiteHeader } from "./site-header";

export function MarketingPage({
  children,
  footerClassName = "mt-24",
}: {
  children: ReactNode;
  footerClassName?: string;
}) {
  return (
    <main className="bg-background text-foreground min-h-screen antialiased">
      <SiteHeader />
      {children}
      <LandingFooter className={footerClassName} />
    </main>
  );
}

export function LegalPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <MarketingPage>
      <section className="mx-auto w-[min(1120px,calc(100%-48px))] pt-6 max-md:w-[calc(100%-40px)]">
        <div className="mx-auto max-w-[760px]">
          <h1 className="text-foreground text-[clamp(32px,4vw,46px)] leading-[1.1] font-medium tracking-[-0.045em]">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground mt-4 text-[15px]">
              {description}
            </p>
          ) : null}
          <div className="text-muted-foreground [&_a]:text-foreground [&_h2]:text-foreground mt-8 [&_a]:underline [&_a]:underline-offset-[3px] [&_h2]:mt-9 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_li]:text-[15px] [&_li]:leading-[1.7] [&_p]:mt-3 [&_p]:text-[15px] [&_p]:leading-[1.7] [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0">
            {children}
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
