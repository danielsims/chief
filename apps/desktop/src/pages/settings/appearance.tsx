import { Check } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { cn } from "@chief/ui/lib/utils";

import type { ThemePreference } from "../../lib/theme";
import { useTheme } from "../../lib/theme";

const THEMES: {
  value: ThemePreference;
  label: string;
  description: string;
}[] = [
  {
    value: "system",
    label: "System",
    description: "Match this Mac automatically.",
  },
  {
    value: "light",
    label: "Light",
    description: "A warm, clear workspace.",
  },
  {
    value: "dark",
    label: "Dark",
    description: "A focused, dimensional workspace.",
  },
];

function MiniApplication({ mode }: { mode: ThemePreference }) {
  const surface =
    mode === "system"
      ? "bg-[linear-gradient(to_right,#f6f5f1_0_50%,#171717_50%)] shadow-[inset_0_0_0_1px_rgba(127,127,127,0.18)]"
      : mode === "dark"
        ? "bg-[#171717] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
        : "bg-[#f6f5f1] shadow-[inset_0_0_0_1px_rgba(24,24,24,0.09)]";
  const strong =
    mode === "system"
      ? "bg-white/70 mix-blend-difference"
      : mode === "dark"
        ? "bg-white/64"
        : "bg-black/58";
  const muted =
    mode === "system"
      ? "bg-white/82 mix-blend-difference"
      : mode === "dark"
        ? "bg-white/18"
        : "bg-black/14";
  const hairline =
    mode === "system"
      ? "bg-white/85 mix-blend-difference"
      : mode === "dark"
        ? "bg-white/9"
        : "bg-black/8";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block h-[82px] overflow-hidden rounded-xl",
        surface,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-[24%]">
        <span
          className={cn("absolute inset-y-0 right-0 w-px opacity-80", hairline)}
        />
        <span
          className={cn("absolute top-3 left-2.5 size-2 rounded-[3px]", strong)}
        />
        <span
          className={cn("absolute top-8 left-2.5 h-1 w-7 rounded-full", muted)}
        />
        <span
          className={cn("absolute top-12 left-2.5 h-1 w-5 rounded-full", muted)}
        />
      </span>
      <span className="absolute inset-y-0 right-0 left-[24%] px-3 pt-3">
        <span className={cn("block h-1.5 w-14 rounded-full", strong)} />
        <span className="mt-3 flex items-center gap-2">
          <span className={cn("size-3 shrink-0 rounded-full", muted)} />
          <span className="min-w-0 flex-1 space-y-1.5">
            <span className={cn("block h-1 w-1/2 rounded-full", muted)} />
            <span
              className={cn("block h-1 w-3/4 rounded-full opacity-60", muted)}
            />
          </span>
        </span>
        <span className="mt-2 flex items-center gap-2">
          <span className={cn("size-3 shrink-0 rounded-full", muted)} />
          <span className={cn("h-1 w-1/3 rounded-full opacity-70", muted)} />
        </span>
      </span>
    </span>
  );
}

function ThemePreview({ theme }: { theme: ThemePreference }) {
  return (
    <span className="block p-1">
      <MiniApplication mode={theme} />
    </span>
  );
}

export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose how Chief looks on this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {THEMES.map(({ value, label, description }) => {
            const active = preference === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setPreference(value)}
                className={cn(
                  "hover:bg-foreground/[0.025] group rounded-2xl p-2 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-[background-color,box-shadow]",
                  active &&
                    "bg-foreground/[0.035] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_15%,transparent),0_3px_12px_rgba(0,0,0,0.035)]",
                )}
              >
                <ThemePreview theme={value} />
                <span className="flex min-h-14 items-start gap-3 px-1.5 pt-3 pb-1">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{label}</span>
                    <span className="text-muted-foreground mt-1 block text-[10px] leading-4 font-normal">
                      {description}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "bg-foreground/[0.055] text-transparent",
                    )}
                  >
                    <Check size={10} strokeWidth={2.5} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
