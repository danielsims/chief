#!/usr/bin/env node
// The old shell/token-inheritance listener is intentionally retired.
console.error(`chief-listen has moved into chief-machine.

Use:
  chief-machine agent join <invite-url> --name <name> --provider other
  chief-machine agent messages <binding-id>
  chief-machine agent post <binding-id> <thread-id>

For automatic replies configure a local argv-based adapter, then enable it.
See packages/chief-machine/README.md. Existing credentials are not imported
or printed; revoke old channel memberships in Chief before replacing them.`);
process.exitCode = 1;
