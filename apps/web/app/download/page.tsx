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
      <path d="M1 4.2 10.3 3v8.4H1V4.2Zm10.5-1.4L23 1.2v10.2H11.5V2.8ZM1 12.6h9.3V21L1 19.8v-7.2Zm10.5 0H23v10.2l-11.5-1.6v-8.6Z" />
    </svg>
  );
}

function BrowserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="2" y="3" width="20" height="18" />
      <path d="M2 8h20M6 5.5h.01M9 5.5h.01" />
    </svg>
  );
}

const macUrl = process.env.CHIEF_MACOS_DOWNLOAD_URL;
const windowsUrl = process.env.CHIEF_WINDOWS_DOWNLOAD_URL;

const options = [
  {
    name: "macOS",
    description: "The desktop workspace for Apple Silicon and Intel Macs.",
    detail: "macOS 12 or later",
    href: macUrl ?? "/sign-in?intent=desktop&platform=macos",
    label: macUrl ? "Download for macOS" : "Join desktop early access",
    icon: <AppleIcon />,
  },
  {
    name: "Windows",
    description: "The desktop workspace for Windows PCs.",
    detail: "Windows 10 or later",
    href: windowsUrl ?? "/sign-in?intent=desktop&platform=windows",
    label: windowsUrl ? "Download for Windows" : "Join desktop early access",
    icon: <WindowsIcon />,
  },
  {
    name: "Browser",
    description: "Open your workspace without installing the desktop app.",
    detail: "Works in modern browsers",
    href: "/sign-in",
    label: "Open Chief",
    icon: <BrowserIcon />,
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
          description="Use the desktop app on macOS or Windows, or open your workspace in the browser."
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
          {!macUrl || !windowsUrl ? (
            <p className="download-note">
              Desktop builds are in early access. Sign in and we&apos;ll route
              you to the right build when it is available for your workspace.
            </p>
          ) : null}
        </ContentRail>
        <MarketingFooter />
      </RailsLayout>
    </main>
  );
}
