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
    <MarketingPage>
      <div className="mx-auto w-[min(1120px,calc(100%-48px))] max-md:w-[calc(100%-40px)]">
        <PricingOffer />
      </div>
    </MarketingPage>
  );
}
