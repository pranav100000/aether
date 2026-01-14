FROM oven/bun:1 AS builder

WORKDIR /app

# Build-time args for Vite environment variables
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL
ARG VITE_PREVIEW_DOMAIN
ARG VITE_SENTRY_DSN

# Copy package files from root (monorepo)
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/

# Install dependencies
RUN bun install 

# Copy source code
COPY apps/web ./apps/web
COPY packages/types ./packages/types

# Build the app
WORKDIR /app/apps/web
RUN bun run build

# Production stage
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
