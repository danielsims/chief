export function redactExecutorHandoffCredentials(value: string) {
  return value.replace(/([?&]_token=)[^&\s"'<>]+/giu, "$1[redacted]");
}
