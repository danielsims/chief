import type { Metadata } from "next";

import { MarketingFooter, MarketingHeader } from "../marketing-chrome";
import { RailsLayout } from "../rails-layout";
import { PricingOffer } from "./pricing-offer";

export const metadata: Metadata = {
  title: "Pricing | Chief",
  description:
    "Simple pricing for a proactive team of specialist agents, free during beta.",
};

export default function PricingPage() {
  return (
    <main className="landing">
      <RailsLayout>
        <MarketingHeader />
        <div className="pricing-page">
          <PricingOffer />
        </div>
        <MarketingFooter />
      </RailsLayout>
    </main>
  );
}
