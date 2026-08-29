import type { LocalToolRequest } from "./tool.js";

export function pathParameter(
  request: Pick<LocalToolRequest, "pathParameters">,
  name: string,
) {
  const value = request.pathParameters.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
