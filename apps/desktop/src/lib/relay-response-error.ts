import {
  isJsonObject,
  isJsonString,
  parseJsonValue,
} from "@chief/relay-contracts";

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
    .then((value) => {
      const body = parseJsonValue(value);
      const error =
        isJsonObject(body) && isJsonObject(body.error) ? body.error : undefined;
      return new RelaySessionError(
        isJsonString(error?.message)
          ? error.message
          : `Relay request failed (${response.status}).`,
        response.status,
        isJsonString(error?.code) ? error.code : undefined,
      );
    });
}
