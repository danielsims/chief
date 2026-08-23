export class RelaySessionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function relayResponseError(
  response: Response,
): Promise<RelaySessionError> {
  return response
    .json()
    .catch(() => null)
    .then((value: unknown) => {
      const body = value as {
        error?: { code?: string; message?: string };
      } | null;
      return new RelaySessionError(
        body?.error?.message ?? `Relay request failed (${response.status}).`,
        response.status,
        body?.error?.code,
      );
    });
}
