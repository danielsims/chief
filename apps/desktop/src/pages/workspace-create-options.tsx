import type { ReactNode } from "react";

export const workspaceOnboardingApps = [
  { domain: "workspace.google.com", label: "Google" },
  { domain: "slack.com", label: "Slack" },
  { domain: "granola.ai", label: "Granola" },
  { domain: "notion.com", label: "Notion" },
  { domain: "github.com", label: "GitHub" },
  { domain: "vercel.com", label: "Vercel" },
  { domain: "pscale.dev", label: "PlanetScale" },
  { domain: "posthog.com", label: "PostHog" },
  { domain: "linear.app", label: "Linear" },
  { domain: "atlassian.com", label: "Atlassian" },
  { domain: "figma.com", label: "Figma" },
  { domain: "hubspot.com", label: "HubSpot" },
  { domain: "canva.com", label: "Canva" },
  { domain: "zoom.com", label: "Zoom" },
  { domain: "asana.com", label: "Asana" },
  { domain: "airtable.com", label: "Airtable" },
  { domain: "clickup.com", label: "ClickUp" },
  { domain: "monday.com", label: "monday.com" },
  { domain: "intercom.com", label: "Intercom" },
  { domain: "convex.dev", label: "Convex" },
  { domain: "box.com", label: "Box" },
  { domain: "miro.com", label: "Miro" },
  { domain: "resend.com", label: "Resend" },
  { domain: "sentry.io", label: "Sentry" },
  { domain: "supabase.com", label: "Supabase" },
  { domain: "stripe.com", label: "Stripe" },
  { domain: "clay.com", label: "Clay" },
  { domain: "apollo.io", label: "Apollo" },
  { domain: "fireflies.ai", label: "Fireflies" },
  { domain: "webflow.com", label: "Webflow" },
  { domain: "cloudflare.com", label: "Cloudflare" },
  { domain: "calendly.com", label: "Calendly" },
] as const;

export function workspaceOnboardingAppLogo(domain: string) {
  return `https://integrations.sh/logo/${domain}`;
}

/** Start loading the small, fixed onboarding catalog before its step appears. */
export function preloadWorkspaceOnboardingApps() {
  for (const app of workspaceOnboardingApps) {
    const image = new Image();
    image.decoding = "async";
    image.src = workspaceOnboardingAppLogo(app.domain);
  }
}

export function ProviderOption({
  icon,
  label,
  detail,
  selected,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hover:border-foreground/60 flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center transition-colors ${detail ? "min-h-32" : "min-h-24"} ${selected ? "border-foreground bg-muted" : "bg-background"}`}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
      {detail ? (
        <span className="text-muted-foreground text-xs leading-5">
          {detail}
        </span>
      ) : null}
    </button>
  );
}
