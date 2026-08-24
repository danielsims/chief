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
COPY tooling/eslint/package.json ./tooling/eslint/package.json
COPY tooling/prettier/package.json ./tooling/prettier/package.json
COPY tooling/typescript/package.json ./tooling/typescript/package.json
COPY packages/auth/package.json ./packages/auth/package.json
COPY packages/email/package.json ./packages/email/package.json
COPY packages/relay-contracts/package.json ./packages/relay-contracts/package.json
COPY apps/relay/package.json ./apps/relay/package.json

RUN --mount=type=cache,id=chief-relay-pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile --filter @chief/relay...

COPY tooling/eslint ./tooling/eslint
COPY tooling/prettier ./tooling/prettier
COPY tooling/typescript ./tooling/typescript
COPY packages/auth ./packages/auth
COPY packages/email ./packages/email
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
COPY --chown=chief:chief apps/relay/docker/entrypoint.sh /usr/local/bin/chief-relay

USER chief
EXPOSE 8787
VOLUME ["/var/lib/chief"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/chief-relay"]
CMD ["serve"]
