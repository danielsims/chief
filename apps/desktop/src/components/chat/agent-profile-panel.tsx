import { useState } from "react";
import { Hash, Mail, MessageCircle, Settings2 } from "lucide-react";
import { Link } from "react-router";

import type { AgentDefinition } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { ConversationAuxiliaryPanelSizing } from "./conversation-auxiliary-panel";
import { AgentAvatar } from "../agent-avatar";
import {
  ConversationAuxiliaryPanel,
  ConversationAuxiliaryPanelBody,
  ConversationAuxiliaryPanelHeader,
} from "./conversation-auxiliary-panel";

export type AgentPresence = "working" | "online" | "offline";

const PRESENCE_COPY: Record<AgentPresence, string> = {
  working: "Working",
  online: "Online",
  offline: "Offline",
};

const PRESENCE_TONE: Record<AgentPresence, string> = {
  working: "bg-amber-400",
  online: "bg-emerald-500",
  offline: "bg-muted-foreground/45",
};

const CAPABILITY_LABELS: Record<string, string> = {
  "campaign-memory": "Campaign planning",
  "content-calendar": "Content calendar",
  "prospect-memory": "Prospect intelligence",
  "schedule-manager": "Scheduled work",
  "trend-memory": "Market signals",
};

function sentenceCaseId(value: string) {
  const words = value.replaceAll("-", " ");
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

export function AgentPresenceAvatar({
  name,
  presence,
  size = "sm",
}: {
  name: string;
  presence: AgentPresence;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0",
        size === "lg" ? "size-20" : "size-8",
      )}
    >
      <AgentAvatar label={name} className="size-full" />
      <span
        aria-label={PRESENCE_COPY[presence]}
        role="img"
        className={cn(
          "ring-background absolute flex items-center justify-center rounded-full ring-[3px]",
          PRESENCE_TONE[presence],
          size === "lg"
            ? "right-0.5 bottom-0.5 size-4"
            : "right-0 bottom-0 size-2",
        )}
      />
    </span>
  );
}

export function AgentProfilePanel({
  agent,
  channels,
  displayName = agent.name,
  presence,
  onClose,
  sizing,
}: {
  agent: AgentDefinition;
  channels: readonly { id: string; name: string; description: string }[];
  displayName?: string;
  presence: AgentPresence;
  onClose: () => void;
  sizing: ConversationAuxiliaryPanelSizing;
}) {
  const [tab, setTab] = useState<"info" | "channels">("info");

  return (
    <ConversationAuxiliaryPanel onClose={onClose} sizing={sizing}>
      <ConversationAuxiliaryPanelHeader title="Profile" onClose={onClose} />

      <ConversationAuxiliaryPanelBody>
        <section className="flex flex-col items-center px-7 pt-8 pb-7 text-center">
          <AgentPresenceAvatar
            name={displayName}
            presence={presence}
            size="lg"
          />
          <h2 className="mt-4 text-xl font-semibold tracking-[-0.03em]">
            {displayName}
          </h2>
          <p className="text-muted-foreground mt-1 text-[13px]">{agent.role}</p>
          <div className="text-muted-foreground mt-2.5 flex items-center gap-1.5 text-xs">
            <span
              className={cn("size-1.5 rounded-full", PRESENCE_TONE[presence])}
            />
            {PRESENCE_COPY[presence]}
          </div>
        </section>

        <div className="border-b px-4 pb-4">
          <div
            className="flex items-center justify-center gap-1.5"
            aria-label="Profile sections"
            role="tablist"
          >
            {(["info", "channels"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                aria-selected={tab === item}
                role="tab"
                className={cn(
                  "text-muted-foreground hover:bg-muted/55 hover:text-foreground inline-flex h-8 items-center rounded-full px-3 text-xs font-medium capitalize transition-colors",
                  tab === item &&
                    "bg-muted text-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,var(--background)_65%,transparent),0_1px_2px_color-mix(in_srgb,var(--foreground)_5%,transparent)]",
                )}
              >
                {item}
                {item === "channels" && channels.length > 0 ? (
                  <span className="text-muted-foreground ml-1.5 text-[10px] tabular-nums">
                    {channels.length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {tab === "info" ? (
          <div className="space-y-7 px-5 py-6">
            <section>
              <h3 className="text-sm font-semibold tracking-[-0.01em]">
                About
              </h3>
              <p className="text-muted-foreground mt-2 text-[13px] leading-5.5">
                {agent.description}
              </p>
            </section>

            {agent.capabilities?.length ? (
              <section>
                <h3 className="text-sm font-semibold tracking-[-0.01em]">
                  Capabilities
                </h3>
                <div className="bg-muted/30 mt-3 overflow-hidden rounded-2xl">
                  {agent.capabilities.map((capability) => (
                    <div
                      key={capability}
                      className="border-border/55 flex min-h-10 items-center border-b px-4 py-2.5 text-[13px] last:border-b-0"
                    >
                      {CAPABILITY_LABELS[capability] ??
                        sentenceCaseId(capability)}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {agent.subagents?.length ? (
              <section>
                <h3 className="text-sm font-semibold tracking-[-0.01em]">
                  Works with
                </h3>
                <div className="bg-muted/30 mt-3 overflow-hidden rounded-2xl">
                  {agent.subagents.map((subagent) => (
                    <div
                      key={subagent.id}
                      className="border-border/55 flex items-center gap-3 border-b px-3.5 py-3 last:border-b-0"
                    >
                      <AgentAvatar label={subagent.name} />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[13px] font-medium">
                          {subagent.name}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
                          {subagent.role}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="px-5 py-6">
            {channels.length > 0 ? (
              <div className="bg-muted/30 overflow-hidden rounded-2xl">
                {channels.map((channel) => (
                  <Link
                    key={channel.id}
                    to={`/conversations?channel=${encodeURIComponent(channel.id)}`}
                    className="border-border/55 hover:bg-muted/55 flex items-start gap-3 border-b px-4 py-3.5 transition-colors last:border-b-0"
                  >
                    <Hash
                      size={14}
                      className="text-muted-foreground mt-0.5 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {channel.name}
                      </span>
                      <span className="text-muted-foreground mt-1 line-clamp-2 block text-[11px] leading-4">
                        {channel.description}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
                <Hash className="text-muted-foreground size-4" />
                <p className="mt-3 text-sm font-medium">No shared channels</p>
                <p className="text-muted-foreground mt-1 text-xs leading-5">
                  Channels will appear here when {displayName} joins a shared
                  conversation.
                </p>
              </div>
            )}
          </div>
        )}
      </ConversationAuxiliaryPanelBody>

      <footer className="shrink-0 border-t p-3">
        <Button
          render={<Link to={`/agents?agent=${encodeURIComponent(agent.id)}`} />}
          variant="outline"
          className="w-full"
        >
          <Settings2 size={13} />
          View agent settings
        </Button>
      </footer>
    </ConversationAuxiliaryPanel>
  );
}

export function UserProfilePanel({
  user,
  channels,
  onClose,
  onMessage,
  sizing,
}: {
  user: {
    name: string;
    email?: string;
    image?: string | null;
    role?: "owner" | "admin" | "member";
  };
  channels: readonly { id: string; name: string; description: string }[];
  onClose: () => void;
  /** Present for other members; opens a direct message with them. */
  onMessage?: () => Promise<boolean>;
  sizing: ConversationAuxiliaryPanelSizing;
}) {
  const [messaging, setMessaging] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const initials = user.name
    .split(/\s+/u)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase();

  return (
    <ConversationAuxiliaryPanel onClose={onClose} sizing={sizing}>
      <ConversationAuxiliaryPanelHeader title="Profile" onClose={onClose} />

      <ConversationAuxiliaryPanelBody>
        <section className="px-5 pt-5 pb-5">
          <span className="bg-foreground text-background flex aspect-square w-full max-w-60 items-center justify-center overflow-hidden rounded-2xl text-5xl font-semibold tracking-[-0.03em]">
            {user.image && !imageFailed ? (
              <img
                src={user.image}
                alt=""
                className="size-full object-cover"
                onError={() => setImageFailed(true)}
                referrerPolicy="no-referrer"
              />
            ) : (
              initials
            )}
          </span>
          <h2 className="mt-4 truncate text-xl font-semibold tracking-[-0.03em]">
            {user.name}
          </h2>
          <p className="text-muted-foreground mt-1 text-[13px] capitalize">
            {user.role ?? "member"}
          </p>
          {onMessage ? (
            <button
              type="button"
              disabled={messaging}
              onClick={() => {
                setMessaging(true);
                void onMessage().finally(() => setMessaging(false));
              }}
              className="hover:bg-muted/55 mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-medium shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_14%,transparent)] transition-colors disabled:opacity-60"
            >
              <MessageCircle size={15} /> Message
            </button>
          ) : null}
        </section>

        {user.email ? (
          <section className="border-t px-5 py-5">
            <h3 className="text-sm font-semibold tracking-[-0.01em]">
              Contact information
            </h3>
            <div className="mt-3 flex items-center gap-3">
              <span className="bg-muted/55 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                <Mail size={16} />
              </span>
              <span className="min-w-0">
                <span className="text-muted-foreground block text-[11px] font-medium">
                  Email address
                </span>
                <a
                  href={`mailto:${user.email}`}
                  className="block truncate text-[13px] text-sky-500 hover:underline"
                >
                  {user.email}
                </a>
              </span>
            </div>
          </section>
        ) : null}

        {channels.length > 0 ? (
          <section className="border-t px-5 py-5">
            <h3 className="text-sm font-semibold tracking-[-0.01em]">
              Channels
            </h3>
            <div className="-mx-2 mt-2">
              {channels.map((channel) => (
                <Link
                  key={channel.id}
                  to={`/conversations?channel=${encodeURIComponent(channel.id)}`}
                  className="hover:bg-muted/55 flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors"
                >
                  <Hash size={14} className="text-muted-foreground shrink-0" />
                  <span className="truncate">{channel.name}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </ConversationAuxiliaryPanelBody>
    </ConversationAuxiliaryPanel>
  );
}
