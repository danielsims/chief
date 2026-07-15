import type { Metadata } from "next";

import {
  ContentRail,
  MarketingFooter,
  MarketingHeader,
} from "../marketing-chrome";
import { RailsLayout } from "../rails-layout";
import { DownloadOptions } from "./download-options";

export const metadata: Metadata = {
  title: "Download Chief",
  description: "Download Chief for macOS or Windows.",
};

export default function DownloadPage() {
  return (
    <main className="landing">
      <RailsLayout>
        <MarketingHeader />
        <ContentRail
          className="download-content-rail"
          title="Download Chief."
          description="Choose the desktop app for your computer."
        >
          <DownloadOptions />
        </ContentRail>
        <MarketingFooter />
      </RailsLayout>
    </main>
  );
}
