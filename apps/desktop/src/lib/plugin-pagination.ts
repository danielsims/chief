/** Keep category order while limiting the number of mounted plugin rows. */
export function pagePluginGroups<T>(
  groups: [string, T[]][],
  limit: number,
): [string, T[]][] {
  const page: [string, T[]][] = [];
  let remaining = Math.max(0, limit);
  for (const [label, plugins] of groups) {
    if (remaining === 0) break;
    const visible = plugins.slice(0, remaining);
    if (visible.length) page.push([label, visible]);
    remaining -= visible.length;
  }
  return page;
}
