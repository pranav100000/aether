FROM oven/bun:1.1.38-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./

# Install all deps (including dev) for typecheck
RUN bun install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./

# Type check
RUN bun run typecheck

# Reinstall production only
RUN rm -rf node_modules && bun install --frozen-lockfile --production

FROM oven/bun:1.1.38-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Run as non-root
RUN adduser -D agent
USER agent

EXPOSE 8080

CMD ["bun", "run", "src/server.ts"]
