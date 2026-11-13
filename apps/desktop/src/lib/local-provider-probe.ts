import { z } from "zod";

import { requestDesktopPluginHost } from "./desktop-plugin-host";

const probeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["missing", "signed_out", "usage", "failed"]),
    detail: z.string(),
  }),
]);
export type LocalProviderProbe = z.infer<typeof probeSchema>;

/** Sends the agent app on this computer one tiny message to check it answers. */
export async function probeLocalProvider(
  provider: "codex" | "claude" | "opencode",
): Promise<LocalProviderProbe> {
  return probeSchema.parse(
    await requestDesktopPluginHost(`/probe/${provider}`, {}),
  );
}
