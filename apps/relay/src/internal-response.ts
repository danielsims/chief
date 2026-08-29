export async function releaseInternalResponse(response: Response) {
  if (!response.bodyUsed) await response.body?.cancel();
}

export async function requireInternalResponse(
  response: Response,
  message: string,
) {
  const ok = response.ok;
  await releaseInternalResponse(response);
  if (!ok) throw new Error(message);
}
