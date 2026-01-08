#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# Load environment variables from .env (handles special characters)
# Check project root first, then frontend-specific
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi
if [ -f frontend/.env ]; then
    set -a
    source frontend/.env
    set +a
fi

# Use interactive login instead of token from .env
unset FLY_API_TOKEN

# Required build args (fall back to non-VITE_ prefixed versions)
VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-$SUPABASE_URL}"
VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-$SUPABASE_ANON_KEY}"
VITE_API_URL="${VITE_API_URL:-$API_URL}"
VITE_PREVIEW_DOMAIN="${VITE_PREVIEW_DOMAIN:-$PREVIEW_DOMAIN}"

# Validate required vars
: "${VITE_SUPABASE_URL:?Missing VITE_SUPABASE_URL or SUPABASE_URL}"
: "${VITE_SUPABASE_ANON_KEY:?Missing VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY}"
: "${VITE_API_URL:?Missing VITE_API_URL or API_URL}"
: "${VITE_PREVIEW_DOMAIN:?Missing VITE_PREVIEW_DOMAIN or PREVIEW_DOMAIN}"

echo "Deploying frontend with:"
echo "  VITE_API_URL: $VITE_API_URL"
echo "  VITE_PREVIEW_DOMAIN: $VITE_PREVIEW_DOMAIN"

fly deploy \
    --config frontend/fly.toml \
    --dockerfile frontend/Dockerfile \
    --build-arg "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" \
    --build-arg "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" \
    --build-arg "VITE_API_URL=$VITE_API_URL" \
    --build-arg "VITE_PREVIEW_DOMAIN=$VITE_PREVIEW_DOMAIN"

echo ""
echo "Frontend deployed! Get the URL with:"
echo "  fly status -a aether-webapp"
