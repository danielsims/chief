export class RelayClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }

  static async fromResponse(response: Response) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    return new RelayClientError(
      body?.error?.message ?? `Relay request failed with ${response.status}.`,
      response.status,
      body?.error?.code,
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
