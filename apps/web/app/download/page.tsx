import type { Metadata } from "next";

import { MarketingPage } from "../marketing-page";
import { DownloadOptions } from "./download-options";

export const metadata: Metadata = {
  title: "Download Chief",
  description: "Download Chief for macOS or Windows.",
};

export default function DownloadPage() {
  return (
    <MarketingPage>
      <div className="mx-auto w-[min(1120px,calc(100%-48px))] max-md:w-[calc(100%-40px)]">
        <section className="pt-4 text-center">
          <h1 className="text-foreground text-[clamp(40px,5.2vw,68px)] leading-[1.04] font-medium tracking-[-0.05em]">
            Download Chief.
          </h1>
          <p className="text-muted-foreground mx-auto mt-6 max-w-[560px] text-lg leading-[1.65]">
            Choose the desktop app for your computer.
          </p>
        </section>
        <DownloadOptions />
      </div>
    </MarketingPage>
  );
}
