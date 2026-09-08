import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { z } from "zod";

import type {
  DriverType,
  ProviderModelOption,
  ServerMessage,
} from "@chief/agent-runtime/types";

const gatewayCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().trim().min(1),
      name: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      type: z.string().optional(),
    }),
  ),
});

const openCodeCatalogSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1) })),
});

type ModelCatalogFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function listHostedProviderModels(
  driver: DriverType,
  request: ModelCatalogFetch = isTauri() ? tauriFetch : globalThis.fetch,
): Promise<ProviderModelOption[]> {
  if (driver === "remote") {
    const response = await request("https://ai-gateway.vercel.sh/v1/models");
    if (!response.ok)
      throw new Error(`Vercel model catalog returned ${response.status}.`);
    return gatewayCatalogSchema
      .parse(await response.json())
      .data.filter((model) => model.type === "language")
      .map((model) => {
        const option: ProviderModelOption = {
          value: model.id,
          label: model.name ?? model.id,
        };
        if (model.description) option.description = model.description;
        return option;
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }
  if (driver === "opencode") {
    const response = await request("https://opencode.ai/zen/go/v1/models");
    if (!response.ok)
      throw new Error(`OpenCode model catalog returned ${response.status}.`);
    return openCodeCatalogSchema
      .parse(await response.json())
      .data.map((model) => ({
        value: `opencode-go/${model.id}`,
        label: modelLabel(model.id),
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }
  return [];
}

export async function hostedProviderModelsMessage(
  driver: DriverType,
): Promise<Extract<ServerMessage, { type: "models" }>> {
  const auto = { value: "", label: "Auto" };
  try {
    return {
      type: "models",
      driver,
      models: [auto, ...(await listHostedProviderModels(driver))],
    };
  } catch {
    return { type: "models", driver, models: [auto] };
  }
}

function modelLabel(model: string) {
  return model
    .split("-")
    .map((part) =>
      /^\d/u.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}
