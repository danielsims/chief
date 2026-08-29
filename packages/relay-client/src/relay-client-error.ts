import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export class RelayClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }

  static async fromResponse(response: Response) {
    const body = parseJsonObject(await response.json().catch(() => null));
    const details = parseJsonObject(body?.error);
    return new RelayClientError(
      isJsonString(details?.message)
        ? details.message
        : `Relay request failed with ${response.status}.`,
      response.status,
      isJsonString(details?.code) ? details.code : undefined,
    );
  }
}

export function normalizedRelayOrigin(value: string) {
  const url = new URL(value);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}
