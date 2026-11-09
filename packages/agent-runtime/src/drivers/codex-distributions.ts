// Pinned official npm artifacts, fetched only when this computer has no
// Codex new enough for the ACP adapter. Also the oldest installed Codex used.
export const CODEX_VERSION = "0.166.0";
export const codexDistributions: Record<
  string,
  { triple: string; url: string; integrity: string }
> = {
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-darwin-arm64.tgz",
    integrity:
      "sha512-5fWH6qqUInACcRADIewjlnRxDb4QLe0uriwehiZz0+viuAAB8I+WWefqw4xwHvyKaxeiGX4uK56+vrgfvFk3FQ==",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-darwin-x64.tgz",
    integrity:
      "sha512-Vj5wXJPizKmrzNtnRNQf9PP6FJkG3iJU/UO3NE4WvkENZGoQfmImdwf4MVRI5NgwjSuC6LT0HbBRHPVVnwGHuw==",
  },
  "linux-arm64": {
    triple: "aarch64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-linux-arm64.tgz",
    integrity:
      "sha512-w0ScAsBr9aZKtIFrh6HN6KU2yjKKeSCzYfbb7DB0Ccj4BYPzeZtUeQprbycLCwuX3AFQdbdjapmLho2iot74jQ==",
  },
  "linux-x64": {
    triple: "x86_64-unknown-linux-musl",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-linux-x64.tgz",
    integrity:
      "sha512-CxDm3+D1cpbGJeHrdzINoG+3wn9BVncP4qpZaaNYkxe8iPtRJOYyCJnnPoVjWRIBvI9vPKbRoifsMSA5xDaUpw==",
  },
  "win32-arm64": {
    triple: "aarch64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-win32-arm64.tgz",
    integrity:
      "sha512-LWO1cyGlxbKgeUM7QJ1a6QMSsJi++3PqgIi6BmIUBoj/kzZqRIR69UDMQgeU/9izzJFYMSbwt++lHnUFyjQXlA==",
  },
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    url: "https://registry.npmjs.org/@openai/codex/-/codex-0.166.0-win32-x64.tgz",
    integrity:
      "sha512-NS8Ps5oG5r19pCrMCUXwUqOui6odnUIoBlQkrjCJ+h1k6KiwCzC/+mI9d3nSZCqFoVONPBTmqyq8NYq3YaFGyA==",
  },
};
