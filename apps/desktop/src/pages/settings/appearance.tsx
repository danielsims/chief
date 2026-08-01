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

function MiniApplication({
  mode,
  className,
}: {
  mode: "light" | "dark";
  className?: string;
}) {
  const dark = mode === "dark";

  return (
    <span
      className={cn(
        "relative block overflow-hidden rounded-xl",
        dark
          ? "bg-[#101010] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
          : "bg-[#fffefc] shadow-[inset_0_0_0_1px_rgba(24,24,24,0.1)]",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-[17%] items-center gap-1 border-b px-2",
          dark ? "border-white/8 bg-[#151515]" : "border-black/6 bg-[#f8f6f1]",
        )}
      >
        <span
          className={cn(
            "size-1 rounded-full",
            dark ? "bg-white/22" : "bg-black/18",
          )}
        />
        <span
          className={cn(
            "size-1 rounded-full",
            dark ? "bg-white/22" : "bg-black/18",
          )}
        />
        <span
          className={cn(
            "size-1 rounded-full",
            dark ? "bg-white/22" : "bg-black/18",
          )}
        />
      </span>
      <span className="flex h-[83%] min-h-0">
        <span
          className={cn(
            "flex w-[26%] shrink-0 flex-col gap-1.5 px-1.5 py-2",
            dark ? "bg-[#181818]" : "bg-[#efede7]",
          )}
        >
          <span
            className={cn(
              "mb-0.5 h-1.5 w-3/4 rounded-full",
              dark ? "bg-white/28" : "bg-black/25",
            )}
          />
          <span
            className={cn(
              "h-2.5 w-full rounded-[3px]",
              dark ? "bg-white/13" : "bg-black/10",
            )}
          />
          <span
            className={cn(
              "h-1 w-4/5 rounded-full",
              dark ? "bg-white/16" : "bg-black/14",
            )}
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col p-2">
          <span
            className={cn(
              "h-1.5 w-1/3 rounded-full",
              dark ? "bg-white/65" : "bg-black/62",
            )}
          />
          <span
            className={cn(
              "mt-2 flex-1 rounded-[6px]",
              dark
                ? "bg-[#1c1c1c] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
                : "bg-[#f1efe9] shadow-[inset_0_0_0_1px_rgba(24,24,24,0.07)]",
            )}
          />
          <span
            className={cn(
              "mt-1.5 h-2.5 rounded-[4px]",
              dark
                ? "bg-[#242424] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
                : "bg-white shadow-[inset_0_0_0_1px_rgba(24,24,24,0.06)]",
            )}
          >
            <span
              className={cn(
                "ml-auto block size-2.5 rounded-[4px]",
                dark ? "bg-white/78" : "bg-black/78",
              )}
            />
          </span>
        </span>
      </span>
    </span>
  );
}

function ThemePreview({ theme }: { theme: ThemePreference }) {
  if (theme === "system") {
    return (
      <span
        aria-hidden="true"
        className="grid h-[92px] grid-cols-2 gap-px overflow-hidden rounded-xl bg-black/12 shadow-[inset_0_0_0_1px_rgba(24,24,24,0.08)] dark:bg-white/12 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <MiniApplication mode="light" className="h-full rounded-r-none" />
        <MiniApplication mode="dark" className="h-full rounded-l-none" />
      </span>
    );
  }

  return <MiniApplication mode={theme} className="h-[92px] w-full" />;
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
