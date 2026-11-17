import { z } from "zod";

import { requestDesktopPluginHost } from "./desktop-plugin-host";

const probeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["missing", "signed_out", "usage", "model", "failed"]),
    detail: z.string(),
  }),
]);
export type LocalProviderProbe = z.infer<typeof probeSchema>;

/**
 * Sends the agent app one short message on the model Chief will run to confirm
 * it responds.
 */
export async function probeLocalProvider(
  provider: "codex" | "claude" | "opencode",
  model: string,
): Promise<LocalProviderProbe> {
  return probeSchema.parse(
    await requestDesktopPluginHost(`/probe/${provider}`, { model }),
  );
}
