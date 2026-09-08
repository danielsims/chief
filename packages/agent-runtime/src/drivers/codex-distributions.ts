// Pinned official npm artifacts for the Codex version used by the ACP adapter.
export const CODEX_VERSION = "0.148.0";
export const codexDistributions: Record<
  string,
  { triple: string; url: string; integrity: string }
> = {
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-darwin-arm64.tgz",
    integrity:
      "sha512-xgBPFiF1fHUlRS7HE6wGB56LjBJh16kGD7b4TTbwdVBZNB4QDkTok+vdkAGrfpVkfKcwGNhPSKDgCw+KMZOVug==",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-darwin-x64.tgz",
    integrity:
      "sha512-qepQolhJutfOp+e9i7L3xsi8aoWeCUiiRq274WMWqRj50rKTrXxsuAgkAwDbqEfT3G5VynhYZuQvDsW37JgdNQ==",
  },
  "linux-arm64": {
    triple: "aarch64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-linux-arm64.tgz",
    integrity:
      "sha512-51DCd+izzk6n4mMh4w2utWj3lTLhSTnCOEJQfRh0LS9nBDkcYZcK3iSKOST6fByRIlLSXuLO33LlYYA1VPot6A==",
  },
  "linux-x64": {
    triple: "x86_64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-linux-x64.tgz",
    integrity:
      "sha512-uDT9s7AfMr9xLuJX3ZLVWHgHkUpCnZ33CZjZEdVQhrYCIErkDHsCW5TG290nNjaKngK0WxGt5uCcxeUHv9MWWA==",
  },
  "win32-arm64": {
    triple: "aarch64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-win32-arm64.tgz",
    integrity:
      "sha512-a8iOwLzs8UdnlWDHjgK3W/YSBBsUImG8X5XLBjengp3XGJRruhiIsQtUDUOYimCmotKPM4aX7Ub6zjl/KPxMQQ==",
  },
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.148.0-win32-x64.tgz",
    integrity:
      "sha512-/Jg8eYw0BqTGNUpnrzzWlK2kbu29NWg7t6pnUDEfxqpTUf+mK8r3okXQn60Zjbk9InYZ4d8SwSjrtOa+i5hSPw==",
  },
};
