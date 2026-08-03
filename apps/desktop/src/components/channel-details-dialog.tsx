import type { KeyboardEvent } from "react";
import { useState } from "react";
import { Copy, Hash } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import type { WorkspaceChannelId } from "../lib/workspace-channels";
import type { SidebarChannel } from "./channel-browser-dialog";
import { useAuth } from "../lib/auth/auth-context";
import {
  ChannelAgentsPanel,
  ChannelMembersPanel,
} from "./channel-details-people";

type ChannelDetailsTab = "about" | "members" | "agents";
type EditableField = "name" | "topic" | "description";

const CHANNEL_TABS: { id: ChannelDetailsTab; label: string }[] = [
  { id: "about", label: "About" },
  { id: "members", label: "Members" },
  { id: "agents", label: "Agents and apps" },
];

function cleanChannelName(value: string) {
  return value.trim().replace(/^#+/, "").trim();
}

function displayDate(timestamp?: number) {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(timestamp);
}

export function ChannelDetailsDialog({
  canManage,
  channel,
  onClose,
  onLeave,
  onUpdate,
}: {
  canManage: boolean;
  channel: SidebarChannel | null;
  onClose: () => void;
  onLeave: (channelId: WorkspaceChannelId) => Promise<void>;
  onUpdate: (
    channelId: WorkspaceChannelId,
    input: { name: string; topic: string; description: string },
  ) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [details, setDetails] = useState(channel);
  const [activeTab, setActiveTab] = useState<ChannelDetailsTab>("about");
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const agentIds = details ? [...new Set(details.agentIds)] : [];
  const memberCount = agentIds.length + (user ? 1 : 0);

  const beginEdit = (field: EditableField) => {
    if (!details) return;
    setEditing(field);
    setDraft(field === "name" ? details.label : details[field]);
    setError(null);
  };

  const save = async () => {
    if (!details || !editing || saving) return;
    const value = editing === "name" ? cleanChannelName(draft) : draft.trim();
    if (editing === "name" && !value) return;
    const next = {
      ...details,
      ...(editing === "name" ? { label: value } : { [editing]: value }),
    };
    setSaving(true);
    setError(null);
    try {
      await onUpdate(details.id, {
        name: next.label,
        topic: next.topic,
        description: next.description,
      });
      setDetails(next);
      setEditing(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Chief could not update this channel.",
      );
    } finally {
      setSaving(false);
    }
  };

  const leave = () => {
    if (!details || leaving) return;
    setLeaving(true);
    setError(null);
    void onLeave(details.id)
      .then(onClose)
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Chief could not leave this channel.",
        );
        setLeaving(false);
      });
  };

  const selectAdjacentTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const currentIndex = CHANNEL_TABS.findIndex((tab) => tab.id === activeTab);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex =
      (currentIndex + direction + CHANNEL_TABS.length) % CHANNEL_TABS.length;
    const nextTab = CHANNEL_TABS[nextIndex];
    if (!nextTab) return;
    setActiveTab(nextTab.id);
    document.getElementById(`channel-details-tab-${nextTab.id}`)?.focus();
  };

  const renderField = (
    field: EditableField,
    label: string,
    placeholder: string,
  ) => {
    if (!details) return null;
    const value = field === "name" ? details.label : details[field];
    const active = editing === field;
    return (
      <section className="px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{label}</h3>
            {active ? (
              <div className="mt-3 space-y-3">
                {field === "name" ? (
                  <div className="border-border/70 bg-background/35 focus-within:border-foreground/25 flex h-11 items-center gap-2.5 rounded-xl border px-3">
                    <Hash className="text-muted-foreground size-4" />
                    <input
                      autoFocus
                      maxLength={60}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                  </div>
                ) : (
                  <textarea
                    autoFocus
                    maxLength={field === "topic" ? 250 : 160}
                    rows={field === "topic" ? 2 : 3}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    className="border-border/70 bg-background/35 focus:border-foreground/25 w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none"
                  />
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={saving}
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={field === "name" && !cleanChannelName(draft)}
                    loading={saving}
                    size="sm"
                    type="button"
                    onClick={() => void save()}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground mt-1 text-sm leading-5 whitespace-pre-wrap">
                {field === "name" && value ? `#${value}` : value || placeholder}
              </p>
            )}
          </div>
          {canManage && !active ? (
            <button
              type="button"
              className="text-foreground/70 hover:text-foreground text-sm font-medium"
              onClick={() => beginEdit(field)}
            >
              Edit
            </button>
          ) : null}
        </div>
      </section>
    );
  };

  const created = displayDate(details?.createdAt);
  return (
    <Dialog
      open={channel !== null}
      onOpenChange={(open) => {
        if (!open && !saving && !leaving) onClose();
      }}
    >
      <DialogContent className="border-border/70 bg-popover/95 max-h-[84vh] max-w-2xl gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl backdrop-blur-xl [&>button:last-child]:top-5 [&>button:last-child]:right-5">
        <DialogHeader className="px-6 pt-5">
          <DialogTitle className="flex items-center gap-2 pr-10 text-xl">
            <Hash className="size-5" />
            {details?.label ?? "Channel details"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            View and manage this channel's details.
          </DialogDescription>
        </DialogHeader>

        <div
          className="mt-4 flex min-w-0 [scrollbar-width:none] overflow-x-auto border-b px-5"
          role="tablist"
          aria-label="Channel details"
        >
          {CHANNEL_TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`channel-details-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-controls={`channel-details-panel-${tab.id}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={selectAdjacentTab}
                className={cn(
                  "relative shrink-0 px-3 py-3 text-sm font-medium transition-colors",
                  selected
                    ? "text-foreground after:bg-foreground after:absolute after:right-3 after:bottom-0 after:left-3 after:h-0.5 after:rounded-full"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {tab.id === "members" && memberCount > 0
                  ? ` ${memberCount}`
                  : ""}
              </button>
            );
          })}
        </div>

        <div
          id={`channel-details-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`channel-details-tab-${activeTab}`}
          className="bg-popover min-h-0 flex-1 overflow-y-auto p-5"
        >
          {activeTab === "about" ? (
            <div className="space-y-4">
              <div className="border-border/70 bg-muted/25 divide-y overflow-hidden rounded-2xl border">
                {renderField("name", "Channel name", "Add a channel name")}
                {renderField("topic", "Topic", "Add a topic")}
                {renderField("description", "Description", "Add a description")}
                {created ? (
                  <section className="px-5 py-4">
                    <h3 className="text-sm font-semibold">Created</h3>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {created}
                    </p>
                  </section>
                ) : null}
                <button
                  type="button"
                  disabled={leaving}
                  className="text-destructive hover:bg-destructive/[0.05] w-full px-5 py-4 text-left text-sm font-semibold disabled:opacity-50"
                  onClick={leave}
                >
                  {leaving ? "Leaving…" : "Leave channel"}
                </button>
              </div>
              {details ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-1 text-xs"
                  onClick={() => void navigator.clipboard.writeText(details.id)}
                >
                  <span>Channel ID: {details.id}</span>
                  <Copy className="size-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}

          {activeTab === "members" ? (
            <ChannelMembersPanel agentIds={agentIds} user={user} />
          ) : null}

          {activeTab === "agents" ? (
            <ChannelAgentsPanel
              agentIds={agentIds}
              canManage={canManage}
              onManage={() => {
                onClose();
                void navigate("/agents");
              }}
            />
          ) : null}

          {error ? (
            <p className="text-destructive mt-3 text-xs leading-5">{error}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
