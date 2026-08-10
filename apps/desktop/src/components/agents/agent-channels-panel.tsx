import { useState } from "react";

import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { Switch } from "@chief/ui/components/switch";

import { useProviderModels } from "../../lib/runtime";
import { useSlackChannel } from "../../lib/slack-channel";

const LOCAL_DRIVERS = ["codex", "claude", "opencode"] as const;
const CHANNELS = [
  { id: "slack", label: "Slack", ready: true },
  { id: "discord", label: "Discord", ready: false },
  { id: "teams", label: "Microsoft Teams", ready: false },
  { id: "telegram", label: "Telegram", ready: false },
  { id: "twilio", label: "Twilio", ready: false },
  { id: "github", label: "GitHub", ready: false },
  { id: "linear", label: "Linear", ready: false },
] as const;

function ids(value: string) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function AgentChannelsPanel({
  workspaceId,
  onBack,
  onDeploy,
}: {
  workspaceId: string | null;
  onBack: () => void;
  onDeploy: () => void;
}) {
  const channel = useSlackChannel(workspaceId);
  const [selectedChannel, setSelectedChannel] =
    useState<(typeof CHANNELS)[number]["id"]>("slack");
  const [enabledDraft, setEnabled] = useState<boolean | null>(null);
  const [driverDraft, setDriver] = useState<Exclude<
    DriverType,
    "remote"
  > | null>(null);
  const [modelDraft, setModel] = useState<string | null>(null);
  const [allowedUsersDraft, setAllowedUsers] = useState<string | null>(null);
  const [allowedChannelsDraft, setAllowedChannels] = useState<string | null>(
    null,
  );
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const enabled = enabledDraft ?? channel.state?.enabled ?? false;
  const driver = driverDraft ?? channel.state?.driver ?? "codex";
  const model = modelDraft ?? channel.state?.model ?? "";
  const allowedUsers =
    allowedUsersDraft ?? channel.state?.allowedUserIds.join(", ") ?? "";
  const allowedChannels =
    allowedChannelsDraft ?? channel.state?.allowedChannelIds.join(", ") ?? "";
  const models = useProviderModels(driver);
  const allowlistReady =
    ids(allowedUsers).length + ids(allowedChannels).length > 0;
  const enteredCredentials = Boolean(botToken) && Boolean(appToken);
  const credentialsReady =
    channel.state?.configured === true || enteredCredentials;

  return (
    <div className="bg-card min-h-[680px]">
      <header className="border-b p-6">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground mb-4 text-xs"
        >
          Back to Chief
        </button>
        <h3 className="font-pixel text-3xl">Channels</h3>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          Connect Chief to the places your team already works. Local channels
          use this Mac; deployed Eve channels remain available while it is off.
        </p>
      </header>

      <div className="grid gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-r p-6">
          <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-wider uppercase">
            External channels
          </p>
          <div className="space-y-1">
            {CHANNELS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedChannel(item.id)}
                className={`flex w-full items-center justify-between border p-3 text-left ${selectedChannel === item.id ? "border-foreground bg-muted" : "hover:border-border border-transparent"}`}
              >
                <span>
                  <span className="block text-sm font-medium">
                    {item.label}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-[10px]">
                    {item.id === "slack" && channel.state?.connected
                      ? "Connected locally"
                      : item.ready
                        ? "Ready to connect"
                        : "Available in Eve"}
                  </span>
                </span>
                <span
                  className={`size-2 ${item.id === "slack" && channel.state?.connected ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                />
              </button>
            ))}
          </div>
        </aside>

        <main className="space-y-6 p-6">
          {selectedChannel !== "slack" ? (
            <div className="flex min-h-[420px] flex-col items-start justify-center">
              <p className="text-muted-foreground text-xs">Eve channel</p>
              <h4 className="mt-2 text-3xl font-normal">
                {CHANNELS.find((item) => item.id === selectedChannel)?.label}
              </h4>
              <p className="text-muted-foreground mt-3 max-w-lg text-sm leading-6">
                Eve includes this channel adapter, but Chief does not configure
                or deploy it yet. Slack is the first complete local and deployed
                channel; the others need their own authentication and webhook
                flow before the Connect button would be honest.
              </p>
              <a
                href={`https://eve.dev/docs/channels/${selectedChannel}`}
                target="_blank"
                rel="noreferrer"
                className="mt-5 text-xs underline underline-offset-2"
              >
                Read the Eve setup guide
              </a>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b pb-5">
                <div>
                  <p className="text-sm font-medium">Run Chief from Slack</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {channel.state?.connected
                      ? "Connected and listening for allowed messages."
                      : (channel.state?.error ?? "Not connected.")}
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <section className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-xs">
                  <span>Local agent app</span>
                  <Select
                    value={driver}
                    onValueChange={(value) =>
                      setDriver(value as Exclude<DriverType, "remote">)
                    }
                  >
                    <SelectTrigger className="w-full capitalize">
                      {driver}
                    </SelectTrigger>
                    <SelectContent>
                      {LOCAL_DRIVERS.map((item) => (
                        <SelectItem
                          key={item}
                          value={item}
                          className="capitalize"
                        >
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-2 text-xs">
                  <span>Model</span>
                  <Select
                    value={model.length ? model : "auto"}
                    onValueChange={setModel}
                  >
                    <SelectTrigger className="w-full">
                      {models.models.find((item) => item.value === model)
                        ?.label ?? "Automatic"}
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      {models.models.map((item) => (
                        <SelectItem
                          key={item.value || "auto"}
                          value={item.value || "auto"}
                        >
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </section>

              <section className="flex items-center justify-between gap-5 border-t pt-5">
                <div>
                  <p className="text-xs font-medium">Slack via deployed Eve</p>
                  <p className="text-muted-foreground mt-1 text-[10px] leading-4">
                    Use Eve's webhook channel when Slack must remain online
                    while this Mac is asleep or switched off.
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={onDeploy}>
                  Configure deployment
                </Button>
              </section>

              <section className="space-y-3 border-t pt-5">
                <div>
                  <p className="text-xs font-medium">Who can invoke Chief</p>
                  <p className="text-muted-foreground mt-1 text-[10px] leading-4">
                    Add at least one Slack member ID or channel ID. Messages
                    from everyone else are ignored.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-xs">
                    <span>Allowed member IDs</span>
                    <Input
                      value={allowedUsers}
                      onChange={(event) => setAllowedUsers(event.target.value)}
                      placeholder="U012ABCDEF"
                    />
                  </label>
                  <label className="space-y-2 text-xs">
                    <span>Allowed channel IDs</span>
                    <Input
                      value={allowedChannels}
                      onChange={(event) =>
                        setAllowedChannels(event.target.value)
                      }
                      placeholder="C012ABCDEF"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-3 border-t pt-5">
                <div>
                  <p className="text-xs font-medium">Slack app credentials</p>
                  <p className="text-muted-foreground mt-1 text-[10px] leading-4">
                    Create a Slack app with Socket Mode, an app token using
                    connections:write, and bot scopes app_mentions:read,
                    chat:write, and im:history. Values stay in this workspace's
                    macOS Keychain.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    type="password"
                    value={botToken}
                    onChange={(event) => setBotToken(event.target.value)}
                    placeholder={
                      channel.state?.configured
                        ? "Bot token stored"
                        : "xoxb-..."
                    }
                    autoComplete="off"
                  />
                  <Input
                    type="password"
                    value={appToken}
                    onChange={(event) => setAppToken(event.target.value)}
                    placeholder={
                      channel.state?.configured
                        ? "App token stored"
                        : "xapp-..."
                    }
                    autoComplete="off"
                  />
                </div>
                <a
                  href="https://api.slack.com/apps"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-2"
                >
                  Open Slack app settings
                </a>
              </section>

              <div className="flex justify-end border-t pt-5">
                <Button
                  disabled={
                    !channel.ready ||
                    (enabled && (!allowlistReady || !credentialsReady))
                  }
                  onClick={() => {
                    channel.save(
                      {
                        enabled,
                        driver,
                        model: model && model !== "auto" ? model : undefined,
                        allowedUserIds: ids(allowedUsers),
                        allowedChannelIds: ids(allowedChannels),
                      },
                      {
                        botToken: botToken || undefined,
                        appToken: appToken || undefined,
                      },
                    );
                    setBotToken("");
                    setAppToken("");
                  }}
                >
                  Save and reconnect
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
