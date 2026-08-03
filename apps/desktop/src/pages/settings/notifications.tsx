import { Check, Volume2 } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { Switch } from "@chief/ui/components/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import type { NotificationSound } from "../../lib/notification-sounds";
import {
  NOTIFICATION_SOUNDS,
  previewNotificationSound,
  useNotificationSoundPreferences,
} from "../../lib/notification-sounds";
import { requestDesktopNotificationAccess } from "../../lib/notifications";

const SOUND_DETAILS: Record<
  NotificationSound,
  { label: string; description: string; bars: readonly number[] }
> = {
  chime: {
    label: "Chime",
    description: "A soft two-note bell.",
    bars: [7, 13],
  },
  sparkle: {
    label: "Sparkle",
    description: "A quick ascending twinkle.",
    bars: [5, 8, 11, 15],
  },
  droplet: {
    label: "Droplet",
    description: "A gentle falling tone.",
    bars: [15, 11, 7],
  },
  bloom: {
    label: "Bloom",
    description: "A warm, slow swell.",
    bars: [6, 10, 14, 10, 6],
  },
  ready: {
    label: "Ready",
    description: "A focused tick and soft bloom.",
    bars: [5, 14, 9],
  },
  success: {
    label: "Success",
    description: "A warm three-note rise.",
    bars: [7, 10, 14],
  },
};

function SoundMark({ sound }: { sound: NotificationSound }) {
  return (
    <span
      aria-hidden="true"
      className="bg-foreground/[0.055] flex size-9 shrink-0 items-center justify-center gap-[2px] rounded-full"
    >
      {SOUND_DETAILS[sound].bars.map((height, index) => (
        <span
          // The recipe shapes intentionally repeat heights.
          key={`${sound}-${index}`}
          className="bg-foreground/65 block w-[2px] rounded-full"
          style={{ height }}
        />
      ))}
    </span>
  );
}

export function NotificationsSettings() {
  const { preferences, setDesktopEnabled, setEnabled, setSound } =
    useNotificationSoundPreferences();

  const chooseSound = (sound: NotificationSound) => {
    setSound(sound);
    previewNotificationSound(sound);
  };

  const toggleDesktopNotifications = async (enabled: boolean) => {
    if (!enabled) {
      setDesktopEnabled(false);
      return;
    }
    setDesktopEnabled(await requestDesktopNotificationAccess());
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Choose how Chief lets you know when something needs your attention.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border-border/70 divide-border/70 divide-y border-t">
          <div className="flex items-center justify-between gap-6 py-4">
            <div>
              <h2 className="text-sm font-medium">Desktop notifications</h2>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                Show macOS notifications for messages and scheduled work.
              </p>
            </div>
            <Switch
              aria-label="Show desktop notifications"
              checked={preferences.desktopEnabled}
              onCheckedChange={(enabled) =>
                void toggleDesktopNotifications(enabled)
              }
            />
          </div>

          <div className="flex items-center justify-between gap-6 py-4">
            <div>
              <h2 className="text-sm font-medium">Notification sounds</h2>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                Play a sound for new messages and scheduled outcomes.
              </p>
            </div>
            <Switch
              aria-label="Play notification sounds"
              checked={preferences.enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="pt-5">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <div>
                <h2 className="text-sm font-medium">Message sound</h2>
                <p className="text-muted-foreground mt-1 text-xs leading-5">
                  Choose the cue used for incoming notifications.
                </p>
              </div>
              <span className="text-muted-foreground text-xs">
                On this device
              </span>
            </div>

            <TooltipProvider delayDuration={350}>
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="radiogroup"
                aria-label="Notification sound"
              >
                {NOTIFICATION_SOUNDS.map((sound) => {
                  const detail = SOUND_DETAILS[sound];
                  const selected = preferences.sound === sound;
                  return (
                    <div
                      key={sound}
                      className={cn(
                        "bg-background flex min-w-0 items-center gap-3 rounded-xl p-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-[background-color,box-shadow]",
                        selected &&
                          "bg-foreground/[0.025] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_16%,transparent)]",
                      )}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!preferences.enabled}
                        onClick={() => chooseSound(sound)}
                        className="focus-visible:ring-ring/30 flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 disabled:opacity-45"
                      >
                        <SoundMark sound={sound} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {detail.label}
                          </span>
                          <span className="text-muted-foreground mt-0.5 block text-xs leading-4">
                            {detail.description}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full",
                            selected
                              ? "bg-foreground text-background"
                              : "shadow-[inset_0_0_0_1px_var(--border)]",
                          )}
                        >
                          {selected ? (
                            <Check size={10} strokeWidth={2.5} />
                          ) : null}
                        </span>
                      </button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Preview ${detail.label}`}
                            onClick={() => previewNotificationSound(sound)}
                          >
                            <Volume2 size={14} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Preview {detail.label}</TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
