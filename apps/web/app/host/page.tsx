import type { Metadata } from "next";

import { MarketingPage } from "../marketing-page";
import { HostSetup } from "./host-setup";

export const metadata: Metadata = {
  title: "Host a relay",
  description: "Host your own Chief relay.",
};

export default function HostPage() {
  return (
    <MarketingPage overlayHeader>
      {/* min-h matches the backdrop exactly, so the artwork can never spill
          past its parent and cover the footer. -mt matches the measured header
          height (108.28px). */}
      <div className="relative -mt-[108.28px] min-h-[900px] pt-[108.28px] max-md:min-h-[708px]">
        <div
          aria-hidden="true"
          className="landing-hero-backdrop absolute inset-x-0 top-0 h-[900px] max-md:h-[640px]"
        />
        <div className="relative mx-auto w-[min(1120px,calc(100%-48px))] max-md:w-[calc(100%-40px)]">
          <section className="landing-rise pt-16 text-center max-md:pt-12">
            <h1 className="text-[clamp(40px,5.2vw,68px)] leading-[1.04] font-medium tracking-[-0.05em] text-white">
              Host a relay.
            </h1>
            <p
              className="landing-rise mx-auto mt-6 max-w-[560px] text-lg leading-[1.65] text-white/85"
              data-rise="2"
            >
              Run Chief on your own infrastructure.
            </p>
          </section>
          <div className="landing-rise mt-[62px]" data-rise="3">
            <HostSetup />
          </div>
        </div>
      </div>
    </MarketingPage>
  );
}
