export function isExplicitWorkspaceEntry(search: string) {
  const query = new URLSearchParams(search);
  return query.has("invite") || query.get("intent") === "add";
}
