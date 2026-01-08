#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Deploying Aether backend to Fly.io..."

cd "${PROJECT_ROOT}/backend"

if [ ! -f "fly.toml" ]; then
    echo "Error: fly.toml not found. Run 'fly launch' first to configure the app."
    exit 1
fi

fly deploy

echo ""
echo "Deployment complete!"
