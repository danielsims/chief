import Link from "next/link";

import { DownloadButton } from "./download-button";
import { LandingHeroMedia } from "./landing-hero-media";
import { SiteHeader } from "./site-header";

export function LandingHero() {
  return (
    <section className="bg-background relative pb-[88px] max-md:pb-12">
      <link
        as="image"
        fetchPriority="high"
        href="/landing/hero-sky.webp"
        rel="preload"
        type="image/webp"
      />
      <div className="relative">
        {/* Runs from the top of the page to roughly the vertical midpoint of
            the product shots. The offset tracks half the media height, which is
            width-driven: half of (width - right padding) * 1094/1838. */}
        <div
          aria-hidden="true"
          className="landing-hero-backdrop absolute inset-x-0 top-0 -bottom-[min(345px,26.2vw)]"
        />

        <SiteHeader overlay />

        <div className="relative z-10 px-6 pt-[65px] pb-16 text-center text-white max-md:px-[6%] max-md:pt-10 max-md:pb-10">
          <h1 className="landing-rise m-0 text-[clamp(45px,5.2vw,76px)] leading-[1.04] font-medium tracking-[-0.05em] max-md:text-[clamp(35px,8.5vw,52px)]">
            Your team of agents,
            <br />
            already at work.
          </h1>
          <p
            className="landing-rise mx-auto mt-7 max-w-[690px] text-lg leading-[1.65] text-white max-md:mt-[22px] max-md:text-base"
            data-rise="2"
          >
            Give Chief a task. Your agents research, write and build together.
            <br className="max-md:hidden" /> Follow the work on your desktop.
            Pick it up on your phone.
          </p>
          <div
            className="landing-rise relative z-[6] mt-7 flex flex-wrap items-center justify-center gap-[30px] max-md:gap-5"
            data-rise="3"
          >
            <DownloadButton />
            <Link
              className="inline-flex items-center gap-[25px] text-[15px] font-medium text-white max-md:text-sm"
              href="#product"
            >
              See Chief at work <span>↓</span>
            </Link>
          </div>
        </div>
      </div>

      <LandingHeroMedia />
    </section>
  );
}
