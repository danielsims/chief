import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { Switch } from "@chief/ui/components/switch";

import { MissionChannelPicker } from "../../components/mission-channel-picker";
import { MissionHeartbeatSettings } from "../../components/mission-heartbeat-settings";
import { useAuth } from "../../lib/auth/auth-context";
import { routeForMessageDeepLink } from "../../lib/message-deep-links";
import { useWorkspaceChannels, useWorkspaceData } from "../../lib/runtime";

export function MissionsSettings() {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const workspace = useWorkspaceData(cloudOrganizationId);
  const workspaceChannels = useWorkspaceChannels();
  const [saving, setSaving] = useState(false);
  const enabled = workspace.waysOfWorking.mode === "mission-control";
  const selectedChannelId = workspace.waysOfWorking.missionControlChannelId;
  const heartbeat = workspace.recurringWork.find(
    (work) => work.operationKey === "chief-mission-control-heartbeat",
  );
  const channels = useMemo(
    () =>
      workspaceChannels.channels.filter(
        (channel) =>
          channel.visibility !== "direct" && channel.lifecycle === "active",
      ),
    [workspaceChannels.channels],
  );

  const save = async (nextEnabled: boolean, channelId = selectedChannelId) => {
    if (saving) return;
    setSaving(true);
    try {
      await workspace.saveWaysOfWorking(
        nextEnabled ? "mission-control" : "channels",
        channelId,
      );
      toast.success(
        nextEnabled
          ? enabled
            ? "Mission channel updated"
            : "Mission control is on"
          : "Mission control is off",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Chief could not save this setting.",
      );
    } finally {
      setSaving(false);
    }
  };

  const createAndAssign = async (name: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const channelId = await workspaceChannels.createChannel(
        name,
        "Priorities, decisions, and progress across active work",
      );
      if (!channelId) return;
      await workspace.saveWaysOfWorking("mission-control", channelId);
      toast.success(`Mission control is now #${name}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Chief could not create that channel.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Missions</CardTitle>
        <CardDescription>
          Give Chief one room to keep the work moving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-0">
        <div className="border-border/70 flex items-center justify-between gap-6 border-t py-4">
          <div>
            <h2 className="text-sm font-medium">Mission control</h2>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              Chief checks active work and wakes the right agent when needed.
            </p>
          </div>
          <Switch
            aria-label="Enable mission control"
            checked={enabled}
            disabled={saving}
            onCheckedChange={(checked) => void save(checked)}
          />
        </div>

        {enabled ? (
          <div className="border-border/70 border-t py-5">
            <label className="text-sm font-medium">Mission channel</label>
            <p className="text-muted-foreground mt-1 mb-3 text-xs leading-5">
              Search your channels, or type a new name to create one.
            </p>
            <MissionChannelPicker
              channels={channels}
              disabled={saving}
              onCreate={createAndAssign}
              onSelect={(channelId) => save(true, channelId)}
              value={selectedChannelId}
            />
          </div>
        ) : null}

        {heartbeat ? (
          <MissionHeartbeatSettings
            key={`${heartbeat.id}:${heartbeat.updatedAt}`}
            disabled={!enabled}
            onRotateWebhook={() =>
              workspace.rotateRecurringWorkWebhook(heartbeat.id)
            }
            onRunNow={async () => {
              const target = await workspace.runMissionControlHeartbeatNow();
              await navigate(routeForMessageDeepLink(target));
            }}
            onSave={workspace.saveRecurringWorkSettings}
            work={heartbeat}
          />
        ) : (
          <div className="border-border/70 border-t py-5">
            <h2 className="text-sm font-medium">Chief heartbeat</h2>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              The heartbeat will be ready after workspace setup finishes.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
