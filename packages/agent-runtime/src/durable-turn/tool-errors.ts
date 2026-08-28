export class RecoverableToolError extends Error {
  override readonly name: string = "RecoverableToolError";
}

export class UnavailableToolError extends RecoverableToolError {
  override readonly name = "UnavailableToolError";
}

export class DeferredToolError extends Error {
  override readonly name = "DeferredToolError";

  constructor(
    message: string,
    readonly retryAt: number,
  ) {
    super(message);
  }
}

export function isRecoverableToolError(
  error: Error,
): error is RecoverableToolError {
  return error instanceof RecoverableToolError;
}

export function isUnavailableToolError(
  error: Error,
): error is UnavailableToolError {
  return error instanceof UnavailableToolError;
}

export function isDeferredToolError(error: Error): error is DeferredToolError {
  return error instanceof DeferredToolError;
}
