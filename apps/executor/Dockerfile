FROM node:24.14.0-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
ENV HUSKY=0
RUN corepack enable
WORKDIR /source

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY tooling/oxlint ./tooling/oxlint
COPY tooling/prettier ./tooling/prettier
COPY tooling/typescript ./tooling/typescript
COPY packages/browser ./packages/browser
COPY packages/relay-contracts ./packages/relay-contracts
COPY apps/executor ./apps/executor

RUN --mount=type=cache,id=chief-computer-pnpm,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile --filter @chief/executor... \
  && pnpm --filter @chief/executor build \
  && pnpm --config.allowUnusedPatches=true --filter @chief/executor deploy --prod --legacy /computer

FROM node:24.14.0-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install --yes --no-install-recommends bash ca-certificates chromium dumb-init git openssh-client ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 chief \
  && mkdir --parents /app /computers \
  && chown chief:chief /app /computers

ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV EXECUTOR_ROOT=/computers
ENV XDG_CACHE_HOME=/computers/.cache
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build --chown=chief:chief /computer ./

USER chief
EXPOSE 8080
VOLUME ["/computers"]
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.mjs"]
