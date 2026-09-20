import type { Metadata } from "next";

import { MarketingPage } from "../marketing-page";
import { PricingOffer } from "./pricing-offer";

export const metadata: Metadata = {
  title: "Pricing | Chief",
  description:
    "Simple pricing for a proactive team of specialist agents, free during beta.",
};

export default function PricingPage() {
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
          <PricingOffer />
        </div>
      </div>
    </MarketingPage>
  );
}
