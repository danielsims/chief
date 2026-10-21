# chief-machine

Lends a machine's internet connection to your Chief workspace's agents, so
their browsing comes from your connection instead of a datacenter. Built for
machines without the app; the desktop app does the same thing
built in.

Agents can only fetch public web pages through it: anything that resolves to
a private, loopback or link-local address is refused, on every redirect. The
machine logs which agent opened which site, never the page.

## Install

```sh
curl -fsSL https://relay.heychief.sh/install/machine | sh        # Linux, macOS
irm https://relay.heychief.sh/install/machine.ps1 | iex          # Windows PowerShell
```

The script downloads the binary for this machine from the latest Chief
release and checks its SHA-256 before installing.

## Build

```sh
cargo build --release --features cli
# target/release/chief-machine, about 1.6 MB
```

Release builds of the desktop app run `apps/desktop/scripts/package-machine.mjs`,
which builds every target (Linux and Windows through `cargo zigbuild`, so the
Mac running Forge needs `zig` and `cargo-zigbuild`) into
`src-tauri/target/release-assets`, and Forge uploads them to the release.

## Pair and run

In the app, open **Settings → Machines → Add a machine** and copy the command.
On the machine:

```sh
chief-machine pair <token>          # works once, for 15 minutes
chief-machine allow workspace       # optional: let everyone's agents use it
chief-machine serve
```

Remove the machine in the app to cut it off at once.

## Run as a service (systemd)

```ini
# /etc/systemd/system/chief-machine.service
[Unit]
Description=Chief machine
After=network-online.target
Wants=network-online.target

[Service]
User=pi
ExecStart=/usr/local/bin/chief-machine serve
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now chief-machine
journalctl -u chief-machine -f      # who used it, and which sites
```
