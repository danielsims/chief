export function normalizeBrowserUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^localhost(?::\d+)?(?:\/|$)/i.test(value)) return `http://${value}`;
  if (/\.\w{2,}/.test(value) && !value.includes(" ")) {
    return `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
