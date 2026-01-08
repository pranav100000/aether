#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

ENV_FILE=".env"
APP_NAME="aether-api"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found"
    exit 1
fi

echo "Syncing secrets from $ENV_FILE to Fly app: $APP_NAME"

# Build secrets array
declare -a SECRETS_ARGS

while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip empty lines and comments
    [[ -z "$key" || "$key" =~ ^#.* ]] && continue

    # Trim whitespace
    key=$(echo "$key" | xargs)

    # Skip if key is empty after trim
    [ -z "$key" ] && continue

    # Remove surrounding quotes from value
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    # Skip path-based secrets (won't work on Fly)
    [[ "$key" == "SSH_PRIVATE_KEY_PATH" ]] && continue

    # Skip commented out keys
    [[ "$key" =~ ^#.* ]] && continue

    SECRETS_ARGS+=("$key=$value")
done < "$ENV_FILE"

# Add SSH key as base64
if [ -f ".keys/aether_rsa" ]; then
    SSH_KEY_B64=$(base64 < .keys/aether_rsa | tr -d '\n')
    SECRETS_ARGS+=("SSH_PRIVATE_KEY=$SSH_KEY_B64")
    echo "Added SSH_PRIVATE_KEY from .keys/aether_rsa"
fi

echo "Setting ${#SECRETS_ARGS[@]} secrets..."
fly secrets set "${SECRETS_ARGS[@]}" -a "$APP_NAME"

echo ""
echo "Deploying backend..."
cd backend && fly deploy

echo ""
echo "Deployment complete!"
