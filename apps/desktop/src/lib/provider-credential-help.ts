export type ProviderCredentialHelpKind =
  "opencode-access-token" | "vercel-access-token" | "vercel-ai-gateway-key";

export const providerCredentialHelp = {
  "opencode-access-token": {
    label: "Get an OpenCode access token",
    url: "https://opencode.ai/auth",
  },
  "vercel-access-token": {
    label: "Get a Vercel access token",
    url: "https://vercel.com/account/settings/tokens",
  },
  "vercel-ai-gateway-key": {
    label: "Get a Vercel AI Gateway key",
    url: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keysin",
  },
} satisfies Record<
  ProviderCredentialHelpKind,
  { readonly label: string; readonly url: string }
>;
