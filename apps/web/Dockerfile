# syntax=docker/dockerfile:1.7

FROM node:24.14.0-bookworm-slim AS build

ENV CI=true
ENV DEBIAN_FRONTEND=noninteractive
ENV HUSKY=0
ENV NEXT_TELEMETRY_DISABLED=1
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
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json

RUN --mount=type=cache,id=chief-web-pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile --filter @chief/web... --filter @chief/agent-runtime...

COPY tooling/oxlint ./tooling/oxlint
COPY tooling/prettier ./tooling/prettier
COPY tooling/typescript ./tooling/typescript
COPY apps/web ./apps/web

RUN pnpm --filter @chief/web build

FROM node:24.14.0-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive

LABEL org.opencontainers.image.title="Chief web"
LABEL org.opencontainers.image.description="Self-hosted Chief authentication and device connection UI"
LABEL org.opencontainers.image.source="https://github.com/latent-supply/chief"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 chief \
  && mkdir --parents /app \
  && chown chief:chief /app

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app
COPY --from=build --chown=chief:chief /source/apps/web/.next/standalone ./
COPY --from=build --chown=chief:chief /source/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=chief:chief /source/apps/web/public ./apps/web/public

USER chief
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/sign-in').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
