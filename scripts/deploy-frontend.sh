#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Deploying frontend using Infisical secrets..."

# Deploy with Infisical secrets injected as build args
infisical run --env=prod --path=/frontend -- bash -c '
    echo "  VITE_API_URL: $VITE_API_URL"
    echo "  VITE_PREVIEW_DOMAIN: $VITE_PREVIEW_DOMAIN"

    fly deploy \
        --config apps/web/fly.toml \
        --dockerfile apps/web/Dockerfile \
        --build-arg "VITE_SUPABASE_URL=$VITE_SUPABASE_URL" \
        --build-arg "VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY" \
        --build-arg "VITE_API_URL=$VITE_API_URL" \
        --build-arg "VITE_PREVIEW_DOMAIN=$VITE_PREVIEW_DOMAIN"
'

echo ""
echo "Frontend deployed!"
echo "  fly status -a aether-webapp"
