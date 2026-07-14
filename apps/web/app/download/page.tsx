import type { Metadata } from "next";

import {
  ContentRail,
  MarketingFooter,
  MarketingHeader,
} from "../marketing-chrome";
import { RailsLayout } from "../rails-layout";

export const metadata: Metadata = {
  title: "Download Chief",
  description:
    "Download Chief for macOS or Windows, or use it in your browser.",
};

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.7 19.5c-.8 1.2-1.7 2.4-3 2.5-1.4 0-1.8-.8-3.3-.8s-2 .8-3.3.8c-1.3.1-2.3-1.3-3.1-2.5-1.7-2.5-3-7-.3-10.1.9-1.5 2.4-2.5 4.1-2.5 1.3 0 2.5.9 3.3.9s2.3-1.1 3.8-.9c.7 0 2.5.3 3.7 2-.1.1-2.2 1.3-2.2 3.8 0 3 2.7 4 2.7 4-.1.1-.5 1.5-1.4 2.8M13 3.5c.7-.8 1.9-1.5 2.9-1.5.2 1.2-.3 2.4-1 3.2-.7.8-1.8 1.5-3 1.4-.1-1.1.5-2.3 1.1-3.1Z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M2 2h9v9H2V2Zm11 0h9v9h-9V2ZM2 13h9v9H2v-9Zm11 0h9v9h-9v-9Z"
        style={{ stroke: "none" }}
      />
    </svg>
  );
}

const options = [
  {
    name: "macOS",
    description: "The desktop workspace for Apple silicon Macs.",
    detail: "Apple silicon · macOS 12 or later",
    href: "/api/download/macos",
    label: "Download for macOS",
    icon: <AppleIcon />,
  },
  {
    name: "Windows",
    description: "The desktop workspace for Windows PCs.",
    detail: "Windows 10 or later",
    href: "/api/download/windows",
    label: "Download for Windows",
    icon: <WindowsIcon />,
  },
];

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
          <div className="download-grid">
            {options.map((option) => (
              <article key={option.name}>
                <span className="download-icon">{option.icon}</span>
                <h2>{option.name}</h2>
                <p>{option.description}</p>
                <small>{option.detail}</small>
                <a href={option.href}>
                  {option.label}
                  <span>→</span>
                </a>
              </article>
            ))}
          </div>
        </ContentRail>
        <MarketingFooter />
      </RailsLayout>
    </main>
  );
}
