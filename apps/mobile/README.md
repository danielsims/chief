# Chief for iPhone

The native SwiftUI client for Chief workspaces. It uses the same relay protocol,
workspace isolation rules, and deterministic fixtures as the desktop app.

```sh
pnpm mobile:generate
pnpm mobile:build
pnpm mobile:test
```

Use the `CHIEF_DEMO_MODE=1` launch environment variable to open the deterministic
workspace fixture without an account or relay deployment.

The AppIcon and in-app Chief mark are byte-for-byte copies of the desktop
`icon-source.png`. Run `pnpm mobile:verify-icon` to guard that shared identity.

## Client signing

Copy `.env.example` to `.env` and set `CHIEF_APPLE_TEAM_ID` and
`CHIEF_BUNDLE_ID` for your Apple Developer account before running
`pnpm mobile:generate`. Device builds require provisioning profiles with the
app's capabilities, including Sign in with Apple. The local `.env` is ignored
by Git. Relay self-hosting does not require an Apple account.

XcodeGen substitutes local values into the generated project and Info.plist.
Before committing generated files, regenerate portable placeholders from this
directory without loading `.env`:

```sh
env -u CHIEF_APPLE_TEAM_ID -u CHIEF_BUNDLE_ID xcodegen generate
```

For a signed desktop DMG, export `CHIEF_APPLE_SIGNING_IDENTITY` (or Tauri's
`APPLE_SIGNING_IDENTITY`) before running `pnpm desktop:dmg`.
