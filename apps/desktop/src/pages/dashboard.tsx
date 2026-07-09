import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowUp } from "lucide-react";
import { Button } from "@marketer/ui/components/button";
import { OrgLogo } from "../components/org-logo";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  type AuthOrganization,
} from "../lib/auth/better-auth-client";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const widgets = [
  {
    label: "Website traffic",
    value: "—",
    detail: "Connect Google Analytics",
    to: "/analytics",
  },
  {
    label: "Signups",
    value: "—",
    detail: "Connect Google Analytics",
    to: "/analytics",
  },
  {
    label: "Ad spend",
    value: "—",
    detail: "Connect Google Ads",
    to: "/analytics",
  },
  {
    label: "New prospects",
    value: "—",
    detail: "No channels connected",
    to: "/prospects",
  },
  {
    label: "Trending posts",
    value: "—",
    detail: "No channels connected",
    to: "/trending",
  },
  {
    label: "Scheduled posts",
    value: "0",
    detail: "Nothing scheduled",
    to: "/schedule",
  },
];

/**
 * Small workspace anchor above the greeting so multi-company users can tell
 * at a glance which company they are looking at.
 */
function WorkspaceIndicator() {
  const { cloudOrganizationId } = useAuth();
  const [org, setOrg] = useState<AuthOrganization | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((orgs) => {
      if (cancelled) return;
      setOrg(
        orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
          orgs[0] ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  if (!org) return null;

  return (
    <div className="mb-5 flex items-center justify-center gap-2">
      <OrgLogo name={org.name} logo={org.logo} className="h-5 w-5 text-[11px]" />
      <span className="text-xs text-muted-foreground">{org.name}</span>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [ask, setAsk] = useState("");

  const submit = () => {
    const text = ask.trim();
    if (!text) return;
    navigate(`/conversations?agent=cmo&prompt=${encodeURIComponent(text)}`);
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-120px)] max-w-3xl flex-col justify-center gap-10">
      <div className="text-center">
        <WorkspaceIndicator />
        <h1 className="font-serif text-[38px] leading-tight">
          {greeting()}
          <span className="text-muted-foreground">, Daniel</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An overview of your channels and agents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <button
            key={w.label}
            onClick={() => navigate(w.to)}
            className="flex min-h-[110px] flex-col justify-between border bg-card p-5 text-left transition-all duration-300 hover:bg-accent"
          >
            <span className="text-xs text-muted-foreground">{w.label}</span>
            <span>
              <span className="block text-xl font-medium">{w.value}</span>
              <span className="text-xs text-muted-foreground border-b border-dashed border-muted-foreground/30">
                {w.detail}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="mx-auto w-full max-w-[680px]">
        <div className="border bg-card/80 backdrop-blur-lg">
          <textarea
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask your CMO…"
            rows={1}
            className="w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-end px-3 pb-2">
            <Button size="icon" className="h-7 w-7" onClick={submit}>
              <ArrowUp size={14} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
