import { LandingFaq } from "./landing-faq";
import { LandingFooter } from "./landing-footer";
import { LandingHero } from "./landing-hero";
import { LandingProduct } from "./landing-product";

export function LandingHome() {
  return (
    <main className="bg-background text-foreground min-h-screen antialiased">
      <a
        className="bg-background absolute top-[-100px] left-4 z-50 p-4 focus:top-2.5"
        href="#product"
      >
        Skip to product
      </a>
      <LandingHero />
      <LandingProduct />
      <LandingFaq />
      <LandingFooter className="mt-[168px]" />
    </main>
  );
}
