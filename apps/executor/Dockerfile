FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
ENV HUSKY=0
RUN corepack enable
WORKDIR /source

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tooling/oxlint ./tooling/oxlint
COPY tooling/prettier ./tooling/prettier
COPY tooling/typescript ./tooling/typescript
COPY packages/relay-contracts ./packages/relay-contracts
COPY apps/executor ./apps/executor

RUN pnpm install --frozen-lockfile --filter @chief/executor... \
  && pnpm --filter @chief/executor build

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install --yes --no-install-recommends bash ca-certificates git openssh-client ripgrep dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 chief \
  && mkdir --parents /workspace \
  && chown chief:chief /workspace

ENV EXECUTOR_ROOT=/workspace
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
COPY --from=build --chown=chief:chief /source/apps/executor/dist/server.mjs ./server.mjs

USER chief
EXPOSE 8080
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.mjs"]
