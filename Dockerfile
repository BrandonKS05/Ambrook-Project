# The barn, containerized. Data (sqlite ledger + receipt photos) lives under
# /data — mount a persistent volume there on whatever host runs this.
FROM node:24-slim

# Build tools cover the rare case where better-sqlite3 has no prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY services/barn ./services/barn
RUN pnpm install --frozen-lockfile --filter @saddlebag/barn...

ENV PORT=4477 \
    BARN_DB=/data/barn.sqlite \
    BARN_BLOBS=/data/blobs

EXPOSE 4477
CMD ["pnpm", "--filter", "@saddlebag/barn", "start"]
