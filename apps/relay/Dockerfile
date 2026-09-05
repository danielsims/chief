# syntax=docker/dockerfile:1.7

FROM node:24.14.0-bookworm-slim AS dependencies

ENV CI=true
ENV DEBIAN_FRONTEND=noninteractive
ENV HUSKY=0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable
WORKDIR /source

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY .gitignore ./
COPY patches ./patches
COPY tooling/oxlint/package.json ./tooling/oxlint/package.json
COPY tooling/prettier/package.json ./tooling/prettier/package.json
COPY tooling/typescript/package.json ./tooling/typescript/package.json
COPY packages/agent-computer/package.json ./packages/agent-computer/package.json
COPY packages/agent-runtime/package.json ./packages/agent-runtime/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/browser/package.json ./packages/browser/package.json
COPY packages/channel-api/package.json ./packages/channel-api/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/google-oauth-connector/package.json ./packages/google-oauth-connector/package.json
COPY packages/plugin-api/package.json ./packages/plugin-api/package.json
COPY packages/relay-client/package.json ./packages/relay-client/package.json
COPY packages/relay-contracts/package.json ./packages/relay-contracts/package.json
COPY apps/relay/package.json ./apps/relay/package.json

RUN --mount=type=cache,id=relay-pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile --filter @chief/relay...

COPY tooling/oxlint ./tooling/oxlint
COPY tooling/prettier ./tooling/prettier
COPY tooling/typescript ./tooling/typescript
COPY packages/agent-computer ./packages/agent-computer
COPY packages/agent-runtime ./packages/agent-runtime
COPY packages/auth ./packages/auth
COPY packages/browser ./packages/browser
COPY packages/channel-api ./packages/channel-api
COPY packages/email ./packages/email
COPY packages/google-oauth-connector ./packages/google-oauth-connector
COPY packages/plugin-api ./packages/plugin-api
COPY packages/relay-client ./packages/relay-client
COPY packages/relay-contracts ./packages/relay-contracts
COPY apps/relay ./apps/relay

FROM node:24.14.0-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Chief relay"
LABEL org.opencontainers.image.description="Self-hosted Chief relay, authentication server, and durable workspace runtime"
LABEL org.opencontainers.image.source="https://github.com/latent-supply/chief"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 chief \
  && mkdir --parents /app /var/lib/chief /run/chief \
  && chown --recursive chief:chief /app /var/lib/chief /run/chief

ENV CI=true
ENV DEBIAN_FRONTEND=noninteractive
ENV HUSKY=0
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app
COPY --from=dependencies --chown=chief:chief /source ./
COPY --chown=chief:chief apps/relay/docker/entrypoint.sh /usr/local/bin/relay

USER chief
EXPOSE 8787
VOLUME ["/var/lib/chief"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/relay"]
CMD ["serve"]
