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
