# Chief email

React Email templates and a typed Cloudflare Email Service client.

## Preview templates

```bash
pnpm email
```

Open `http://localhost:3001`. Previewing templates does not send email.

Templates are grouped by purpose under `src/templates`:

- `transactional` for account and service messages
- `nurture` for the new-user sequence
- `digest` for completed runs, action items, saved workspace records, and
  upcoming schedules
- `playbook` for ongoing educational campaigns once that content is defined

## Send mail

Onboard the sending domain in Cloudflare Email Service, then copy the sanitized configuration example:

```bash
cp packages/email/.env.example packages/email/.env.local
```

Add your own Cloudflare account ID and a token with `Email Sending: Edit`. Never commit the populated file.

```tsx
import {
  ChiefEmail,
  createCloudflareEmailClient,
  renderEmail,
} from "@chief/email";

const content = await renderEmail(
  <ChiefEmail
    preview="Your report is ready."
    heading="The work is moving."
    actionLabel="Open Chief"
    actionUrl="https://heychief.sh"
  />,
);

await createCloudflareEmailClient().send({
  from: { address: "hello@heychief.sh", name: "Chief" },
  to: "customer@example.com",
  subject: "Your Chief report is ready",
  ...content,
});
```
