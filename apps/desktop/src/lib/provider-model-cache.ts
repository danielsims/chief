import type {
  DriverType,
  ProviderModelOption,
} from "@chief/agent-runtime/types";

const STORAGE_PREFIX = "chief:provider-models:";

function isProviderModelOption(value: unknown): value is ProviderModelOption {
  if (!value || typeof value !== "object") return false;
  const option = value as Partial<ProviderModelOption>;
  return typeof option.value === "string" && typeof option.label === "string";
}

export function readCachedProviderModels(
  driver: DriverType,
): ProviderModelOption[] {
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${driver}`);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isProviderModelOption) : [];
  } catch {
    return [];
  }
}

export function writeCachedProviderModels(
  driver: DriverType,
  models: ProviderModelOption[],
) {
  if (models.every((model) => model.value === "")) return;
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${driver}`,
      JSON.stringify(models),
    );
  } catch {
    // An in-memory cache still keeps the current app session responsive.
  }
}

export function retainUsefulProviderModels(
  current: ProviderModelOption[],
  incoming: ProviderModelOption[],
) {
  const incomingHasChoice = incoming.some((model) => model.value !== "");
  const currentHasChoice = current.some((model) => model.value !== "");
  return !incomingHasChoice && currentHasChoice ? current : incoming;
}
