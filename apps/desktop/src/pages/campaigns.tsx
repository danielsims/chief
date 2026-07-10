import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type {
  CampaignRecord,
  CampaignStatus,
} from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@marketer/ui/components/select";
import { cn } from "@marketer/ui/lib/utils";
import { ArrowUpDown, Plus, Search, Sparkles } from "lucide-react";
import { ProviderLogo } from "../components/provider-logo";
import { useAuth } from "../lib/auth/auth-context";
import { createChat } from "../lib/chat-log";
import { useWorkspaceData } from "../lib/runtime";

const statuses: Array<{ value: CampaignStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

const statusTone: Record<CampaignStatus, string> = {
  draft: "bg-sky-500",
  in_review: "bg-amber-500",
  live: "bg-emerald-500",
  paused: "bg-muted-foreground",
  completed: "bg-violet-500",
};

function providerDomain(provider: string) {
  if (provider.includes("meta") || provider.includes("facebook")) {
    return "facebook.com";
  }
  return "ads.google.com";
}

function money(value: number | undefined, currency: string) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function CampaignStatusControl({
  campaign,
  onChange,
}: {
  campaign: CampaignRecord;
  onChange: (status: CampaignStatus) => void;
}) {
  return (
    <label className="relative inline-flex items-center gap-2">
      <span className={cn("size-1.5", statusTone[campaign.status])} />
      <select
        aria-label={`Status for ${campaign.name}`}
        value={campaign.status}
        onChange={(event) => onChange(event.target.value as CampaignStatus)}
        className="cursor-pointer appearance-none bg-transparent pr-4 text-xs outline-none"
      >
        {statuses.map((status) => (
          <option key={status.value} value={status.value}>
            {status.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CampaignsPage() {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const workspace = useWorkspaceData(cloudOrganizationId);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CampaignStatus | "all">("all");
  const [newestFirst, setNewestFirst] = useState(true);

  const visibleCampaigns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...workspace.campaigns]
      .filter(
        (campaign) =>
          (status === "all" || campaign.status === status) &&
          (!needle ||
            campaign.name.toLowerCase().includes(needle) ||
            campaign.provider.toLowerCase().includes(needle) ||
            campaign.objective?.toLowerCase().includes(needle)),
      )
      .sort((a, b) =>
        newestFirst ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt,
      );
  }, [newestFirst, query, status, workspace.campaigns]);

  const planCampaign = () => {
    const conversation = createChat("ads", "Plan a campaign");
    navigate(
      `/conversations?agent=ads&chat=${conversation.id}&new=1&draft=${encodeURIComponent(
        "Help me plan a paid campaign. Start with the objective, audience, channel and budget, then save a draft campaign for my review. Do not launch anything without my approval.",
      )}`,
    );
  };

  const updateStatus = (campaign: CampaignRecord, next: CampaignStatus) => {
    workspace.saveCampaign({
      ...campaign,
      status: next,
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="-mx-8 -mb-8 min-h-[calc(100vh-48px)]">
      <header className="flex items-center justify-between border-b px-8 pt-4 pb-5">
        <div>
          <h1 className="font-serif text-3xl">Campaigns</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Plan, review and monitor paid acquisition.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={planCampaign}>
          <Sparkles size={14} />
          Ask Ads Manager
        </Button>
      </header>

      <div className="border-b px-8">
        <div className="flex h-11 items-end">
          <div className="flex h-11 items-center gap-2 border-b border-foreground text-sm">
            Campaigns
            <span className="text-xs text-muted-foreground">
              {workspace.campaigns.length}
            </span>
          </div>
        </div>
      </div>

      <div className="px-8 py-5">
        <div className="border bg-card">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-3 py-2">
            <Select
              value={status}
              onValueChange={(value) =>
                setStatus(value as CampaignStatus | "all")
              }
            >
              <SelectTrigger
                aria-label="Filter campaigns by status"
                className="h-8 w-40 bg-background text-xs"
              >
                <span>
                  {status === "all"
                    ? "All campaigns"
                    : statuses.find((item) => item.value === status)?.label}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaigns</SelectItem>
                {statuses.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewestFirst((current) => !current)}
            >
              <ArrowUpDown size={13} />
              {newestFirst ? "Newest" : "Oldest"}
            </Button>
            <div className="relative ml-auto w-56">
              <Search
                size={13}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search campaigns"
                className="h-9 pl-8 text-xs"
              />
            </div>
            <Button size="sm" onClick={planCampaign}>
              <Plus size={14} />
              Add campaign
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="h-10 border-b text-xs text-muted-foreground">
                  <th className="w-[28%] px-4 font-normal">Campaign</th>
                  <th className="px-4 font-normal">Channel</th>
                  <th className="px-4 font-normal">Status</th>
                  <th className="px-4 text-right font-normal">Budget</th>
                  <th className="px-4 text-right font-normal">Spend</th>
                  <th className="px-4 text-right font-normal">Revenue</th>
                  <th className="px-4 text-right font-normal">Updated</th>
                </tr>
              </thead>
              <tbody>
                {visibleCampaigns.map((campaign) => (
                  <tr
                    key={campaign.id}
                    className="h-12 border-b text-sm last:border-b-0 hover:bg-accent/40"
                  >
                    <td className="px-4">
                      <p className="font-medium">{campaign.name}</p>
                      {campaign.objective ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {campaign.objective}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4">
                      <span className="flex items-center gap-2 text-xs">
                        <ProviderLogo
                          domain={providerDomain(campaign.provider)}
                          label={campaign.provider}
                          className="size-5 border-0"
                        />
                        {campaign.provider}
                      </span>
                    </td>
                    <td className="px-4">
                      <CampaignStatusControl
                        campaign={campaign}
                        onChange={(next) => updateStatus(campaign, next)}
                      />
                    </td>
                    <td className="px-4 text-right tabular-nums">
                      {money(campaign.budget, campaign.currency)}
                    </td>
                    <td className="px-4 text-right tabular-nums">
                      {money(campaign.spend, campaign.currency)}
                    </td>
                    <td className="px-4 text-right tabular-nums">
                      {money(campaign.revenue, campaign.currency)}
                    </td>
                    <td className="px-4 text-right text-xs text-muted-foreground">
                      {new Date(campaign.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!workspace.loading && visibleCampaigns.length === 0 ? (
            <div className="flex min-h-60 items-center justify-center border-t px-6 text-center">
              <div className="max-w-sm">
                <h2 className="font-serif text-2xl">
                  {workspace.campaigns.length === 0
                    ? "No campaigns yet"
                    : "No matching campaigns"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {workspace.campaigns.length === 0
                    ? "Work with Ads Manager to turn your budget and goals into a campaign draft."
                    : "Try a different search or status filter."}
                </p>
                {workspace.campaigns.length === 0 ? (
                  <Button className="mt-5" onClick={planCampaign}>
                    Plan first campaign
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
