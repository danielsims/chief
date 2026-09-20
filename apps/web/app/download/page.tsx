import type { Metadata } from "next";

import { MarketingPage } from "../marketing-page";
import { DownloadOptions } from "./download-options";

export const metadata: Metadata = {
  title: "Download Chief",
  description: "Download Chief for macOS or Windows.",
};

export default function DownloadPage() {
  return (
    <MarketingPage overlayHeader>
      {/* Fixed-height artwork wrapper: min-h matches the backdrop exactly, so
          the artwork can never spill past its parent and cover the footer.
          -mt matches the measured header height (108.28px). */}
      <div className="relative -mt-[108.28px] min-h-[900px] pt-[108.28px] max-md:min-h-[708px]">
        <div
          aria-hidden="true"
          className="landing-hero-backdrop absolute inset-x-0 top-0 h-[900px] max-md:h-[640px]"
        />
        <section className="landing-rise relative z-10 pt-16 text-center max-md:pt-12">
          <div className="mx-auto w-[min(1120px,calc(100%-48px))] max-md:w-[calc(100%-40px)]">
            <h1 className="text-[clamp(40px,5.2vw,68px)] leading-[1.04] font-medium tracking-[-0.05em] text-white">
              Download Chief.
            </h1>
            <p
              className="landing-rise mx-auto mt-6 max-w-[560px] text-lg leading-[1.65] text-white/85"
              data-rise="2"
            >
              Choose the desktop app for your computer.
            </p>
          </div>
        </section>

        <div className="relative z-10 mx-auto mt-[62px] w-[min(1120px,calc(100%-48px))] pb-24 max-md:w-[calc(100%-40px)] max-md:pb-16">
          <DownloadOptions />
        </div>
      </div>
    </MarketingPage>
  );
}
