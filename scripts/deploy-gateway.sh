#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

ENV_FILE=".env"
APP_NAME="aether-gateway"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found"
    exit 1
fi

echo "Syncing secrets from $ENV_FILE to Fly app: $APP_NAME"

# Gateway needs these secrets:
# - DATABASE_URL
# - FLY_API_TOKEN
# - FLY_VMS_APP_NAME
# - FLY_REGION (optional)

declare -a SECRETS_ARGS

# Required secrets for gateway
REQUIRED_KEYS=("DATABASE_URL" "FLY_API_TOKEN" "FLY_VMS_APP_NAME")

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

    # Only include keys relevant to gateway
    case "$key" in
        DATABASE_URL|FLY_API_TOKEN|FLY_VMS_APP_NAME|FLY_REGION|PREVIEW_DOMAIN)
            SECRETS_ARGS+=("$key=$value")
            ;;
    esac
done < "$ENV_FILE"

# Check that required secrets are present
for required in "${REQUIRED_KEYS[@]}"; do
    found=false
    for arg in "${SECRETS_ARGS[@]}"; do
        if [[ "$arg" == "$required="* ]]; then
            found=true
            break
        fi
    done
    if [ "$found" = false ]; then
        echo "Error: Required secret $required not found in $ENV_FILE"
        exit 1
    fi
done

echo "Setting ${#SECRETS_ARGS[@]} secrets..."
fly secrets set "${SECRETS_ARGS[@]}" -a "$APP_NAME"

echo ""
echo "Deploying gateway..."
# Build from project root to include apps/ and libs/ in context
fly deploy --dockerfile apps/gateway/Dockerfile --config apps/gateway/fly.toml --remote-only

echo ""
echo "Deployment complete!"
echo ""
echo "Gateway IP:"
fly ips list -a "$APP_NAME"
echo ""
echo "Set VITE_PREVIEW_DOMAIN in apps/web/.env to: <gateway-ip>.nip.io"
