import { z } from "zod";

import { HttpError } from "./http";

/**
 * Each paired machine gets its own Cloudflare Tunnel and hostname, so a live
 * browser view streams from the machine to the app without passing through
 * the relay. The relay only calls Cloudflare's API here, once when a machine
 * first asks to stream and once when it's removed; it never carries frames.
 *
 * Optional: without these settings, machines simply don't stream.
 */
export interface MachineStreamConfig {
  accountId: string;
  apiToken: string;
  zoneId: string;
  domain: string;
}

/** The loopback port `chief-machine` serves live views on. */
const machineStreamPort = 47615;

export function machineStreamConfig(env: Env): MachineStreamConfig | undefined {
  const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_TUNNEL_API_TOKEN } = env;
  const { MACHINE_STREAM_ZONE_ID, MACHINE_STREAM_DOMAIN } = env;
  return CLOUDFLARE_ACCOUNT_ID &&
    CLOUDFLARE_TUNNEL_API_TOKEN &&
    MACHINE_STREAM_ZONE_ID &&
    MACHINE_STREAM_DOMAIN
    ? {
        accountId: CLOUDFLARE_ACCOUNT_ID,
        apiToken: CLOUDFLARE_TUNNEL_API_TOKEN,
        zoneId: MACHINE_STREAM_ZONE_ID,
        domain: MACHINE_STREAM_DOMAIN,
      }
    : undefined;
}

export const machineTunnelSchema = z.object({
  tunnelId: z.string().min(1),
  dnsRecordId: z.string().min(1),
  hostname: z.string().min(1),
});
export type MachineTunnel = z.infer<typeof machineTunnelSchema>;

const envelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ message: z.string() })).default([]),
  result: z.unknown(),
});

async function cloudflare<T>(
  config: MachineStreamConfig,
  path: string,
  init: { method: string; body?: object },
  result: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      "content-type": "application/json",
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : undefined),
  });
  const envelope = envelopeSchema.safeParse(await response.json());
  if (!response.ok || !envelope.success || !envelope.data.success)
    throw new HttpError(
      502,
      "machine_tunnel_failed",
      `Cloudflare couldn't set up this machine's live view${
        envelope.success && envelope.data.errors[0]
          ? `: ${envelope.data.errors[0].message}`
          : "."
      }`,
    );
  return result.parse(envelope.data.result);
}

/**
 * A tunnel routed to the machine's loopback stream port, and a one-level
 * hostname for it, which the zone's free certificate covers.
 */
export async function createMachineTunnel(
  config: MachineStreamConfig,
  machineId: string,
): Promise<MachineTunnel> {
  const account = `/accounts/${config.accountId}/cfd_tunnel`;
  const hostname = `m-${machineId}.${config.domain}`;
  const { id: tunnelId } = await cloudflare(
    config,
    account,
    {
      method: "POST",
      body: { name: `chief-machine-${machineId}`, config_src: "cloudflare" },
    },
    z.object({ id: z.string() }),
  );
  await cloudflare(
    config,
    `${account}/${tunnelId}/configurations`,
    {
      method: "PUT",
      body: {
        config: {
          ingress: [
            { hostname, service: `http://127.0.0.1:${machineStreamPort}` },
            { service: "http_status:404" },
          ],
        },
      },
    },
    z.unknown(),
  );
  const { id: dnsRecordId } = await cloudflare(
    config,
    `/zones/${config.zoneId}/dns_records`,
    {
      method: "POST",
      body: {
        type: "CNAME",
        name: hostname,
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
        comment: "Chief machine live browser view",
      },
    },
    z.object({ id: z.string() }),
  );
  return { tunnelId, dnsRecordId, hostname };
}

/** The token `cloudflared` runs the machine's tunnel with. */
export function machineTunnelToken(
  config: MachineStreamConfig,
  tunnel: MachineTunnel,
) {
  return cloudflare(
    config,
    `/accounts/${config.accountId}/cfd_tunnel/${tunnel.tunnelId}/token`,
    { method: "GET" },
    z.string().min(1),
  );
}

/** Removes a machine's hostname and tunnel, so nothing is left behind. */
export async function deleteMachineTunnel(
  config: MachineStreamConfig,
  tunnel: MachineTunnel,
) {
  await cloudflare(
    config,
    `/zones/${config.zoneId}/dns_records/${tunnel.dnsRecordId}`,
    { method: "DELETE" },
    z.unknown(),
  ).catch(() => undefined);
  await cloudflare(
    config,
    `/accounts/${config.accountId}/cfd_tunnel/${tunnel.tunnelId}?cascade=true`,
    { method: "DELETE" },
    z.unknown(),
  );
}
