import type {
  DriverType,
  ProviderModelOption,
} from "@chief/agent-runtime/types";
import type { JsonValue } from "@chief/relay-contracts";
import {
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

const STORAGE_PREFIX = "chief:provider-models:";

function providerModelOption(value: JsonValue): ProviderModelOption | null {
  if (!isJsonObject(value)) return null;
  const option = value;
  if (!isJsonString(option.value) || !isJsonString(option.label)) return null;
  return { value: option.value, label: option.label };
}

export function readCachedProviderModels(
  driver: DriverType,
): ProviderModelOption[] {
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${driver}`);
    if (!stored) return [];
    const parsed = parseJsonValue(JSON.parse(stored));
    return Array.isArray(parsed)
      ? parsed.flatMap((value) => {
          const option = providerModelOption(value);
          return option ? [option] : [];
        })
      : [];
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
