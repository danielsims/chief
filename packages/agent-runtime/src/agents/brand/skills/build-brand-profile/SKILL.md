---
name: build-brand-profile
label: Build Brand Profile
description: Build the workspace's first evidence-backed brand profile from supplied context and first-party public sources. Use during onboarding or whenever the current voice, positioning, claims, audience, and visual cues need to be grounded again.
---

# Build brand profile

Use the workspace context before browsing. Research the supplied website and a
small number of relevant first-party pages. Do not inspect Chief runtime files,
processes, ports, credentials, or internal implementation details.

Create one complete Markdown profile covering:

- positioning and audience
- voice principles and useful vocabulary
- supported claims and claims to avoid
- visual cues
- three representative writing examples
- explicit uncertainty where evidence is thin

Prefer a useful provisional profile over repeated searching. Never invent proof,
customers, traction, features, or differentiation.

Before publishing completion, persist the same complete Markdown in both useful
forms available to you:

1. Use `localTools.brandProfileSave` so future agents receive the result as
   shared workspace context.
2. Use `localTools.filesWrite` to create or update a clearly named, editable
   workspace document. Inspect the supplied workspace context and existing files
   when choosing its stable name and path; avoid creating duplicate handoff
   files for the same profile.

Verify both tool results before reporting that the work is saved. Then publish a
concise completion inside the owning thread and return the complete Markdown as
the private result so Chief can verify and synthesize it.

Keep the work, evidence, and completion in the owning `#marketing` thread. The
runtime handles the introduction and channel handoff, so do not publish a second
introduction or repeat the profile elsewhere.
