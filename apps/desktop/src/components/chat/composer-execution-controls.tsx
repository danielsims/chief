import type {
  ChatExecutionSelection,
  DriverType,
} from "@chief/agent-runtime/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";

const CHAT_PROVIDERS: DriverType[] = ["claude", "codex", "opencode", "remote"];

function isChatProvider(value: string): value is DriverType {
  return CHAT_PROVIDERS.some((provider) => provider === value);
}

export function ComposerExecutionControls({
  execution,
  disabled,
  onExecutionChange,
}: {
  execution?: ChatExecutionSelection;
  disabled?: boolean;
  onExecutionChange?: (execution: ChatExecutionSelection) => void;
}) {
  const driver = execution?.driver;
  const model = execution?.model;
  const providerModels = useProviderModels(driver ?? null);
  const activeMeta = driver ? PROVIDER_META[driver] : null;
  const activeModel =
    providerModels.models.find((option) => option.value === model)?.label ??
    model ??
    "Auto";

  return (
    <div className="flex min-w-0 items-center gap-2 pl-1">
      <span className="bg-border/70 h-4 w-px" />
      <Select
        value={driver ?? undefined}
        disabled={disabled}
        onValueChange={(value) => {
          if (isChatProvider(value)) onExecutionChange?.({ driver: value });
        }}
      >
        <SelectTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-6 w-auto gap-1.5 border-transparent px-1 text-xs">
          {activeMeta ? (
            <span className="flex items-center gap-1.5">
              <activeMeta.Icon size={13} />
              {activeMeta.label}
            </span>
          ) : (
            <span>Choose agent app</span>
          )}
        </SelectTrigger>
        <SelectContent className="min-w-32">
          {CHAT_PROVIDERS.map((value) => {
            const { label, Icon } = PROVIDER_META[value];
            return (
              <SelectItem key={value} value={value}>
                <span className="flex items-center gap-1.5">
                  <Icon size={13} />
                  {label}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {driver ? (
        <>
          <span className="text-muted-foreground/50 text-xs">/</span>
          <Select
            value={model ?? "__auto__"}
            disabled={disabled}
            onValueChange={(value) =>
              onExecutionChange?.({
                driver,
                model: value === "__auto__" ? undefined : value,
              })
            }
          >
            <SelectTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-6 w-auto max-w-40 gap-1.5 border-transparent px-1 text-xs">
              <span className="truncate">
                {providerModels.loading ? "Loading models…" : activeModel}
              </span>
            </SelectTrigger>
            <SelectContent className="max-h-72 min-w-56">
              {(providerModels.models.length > 0
                ? providerModels.models
                : [{ value: "", label: "Auto" }]
              ).map((option) => (
                <SelectItem
                  key={option.value || "auto"}
                  value={option.value || "__auto__"}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : null}
    </div>
  );
}
