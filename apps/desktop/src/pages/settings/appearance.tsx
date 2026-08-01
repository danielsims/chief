import { Check, Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@chief/ui/components/button";
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
  icon: typeof Monitor;
}[] = [
  {
    value: "system",
    label: "System",
    description: "Follow this Mac's appearance.",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    description: "Use Chief's warm light palette.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Use Chief's low-contrast dark palette.",
    icon: Moon,
  },
];

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
        <div className="grid gap-2 sm:grid-cols-3">
          {THEMES.map(({ value, label, description, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              aria-pressed={preference === value}
              onClick={() => setPreference(value)}
              className={cn(
                "h-auto min-h-24 items-start justify-start p-3 text-left whitespace-normal",
                preference === value &&
                  "border-foreground/30 ring-foreground/8 ring-2",
              )}
            >
              <span className="flex w-full items-start gap-2.5">
                <Icon size={15} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{label}</span>
                  <span className="text-muted-foreground mt-1 block text-[11px] leading-4 font-normal">
                    {description}
                  </span>
                </span>
                {preference === value ? <Check size={14} /> : null}
              </span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
