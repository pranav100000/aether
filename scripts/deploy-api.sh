#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

APP_NAME="aether-api"

echo "Deploying backend using Infisical secrets..."

# Export secrets from Infisical and set on Fly
infisical export --env=prod --path=/backend --format=dotenv | while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    echo "  Setting $key"
done

# Set Fly secrets using infisical (FLY_API_TOKEN uses local auth, not Infisical)
infisical run --env=prod --path=/backend -- bash -c "
    unset FLY_API_TOKEN
    fly secrets set \\
        API_PORT=\"\$API_PORT\" \\
        DATABASE_URL=\"\$DATABASE_URL\" \\
        ENCRYPTION_MASTER_KEY=\"\$ENCRYPTION_MASTER_KEY\" \\
        FLY_REGION=\"\$FLY_REGION\" \\
        FLY_VMS_APP_NAME=\"\$FLY_VMS_APP_NAME\" \\
        SUPABASE_URL=\"\$SUPABASE_URL\" \\
        SUPABASE_ANON_KEY=\"\$SUPABASE_ANON_KEY\" \\
        SUPABASE_SERVICE_KEY=\"\$SUPABASE_SERVICE_KEY\" \\
        SUPABASE_JWT_SECRET=\"\$SUPABASE_JWT_SECRET\" \\
        -a $APP_NAME
"

# Set FLY_API_TOKEN from local .env (not Infisical)
source .env
fly secrets set FLY_API_TOKEN="$FLY_API_TOKEN" -a "$APP_NAME"

# Add SSH key as base64 (from local file)
if [ -f ".keys/aether_rsa" ]; then
    SSH_KEY_B64=$(base64 < .keys/aether_rsa | tr -d '\n')
    fly secrets set SSH_PRIVATE_KEY="$SSH_KEY_B64" -a "$APP_NAME"
    echo "Added SSH_PRIVATE_KEY"
fi

echo ""
echo "Deploying backend..."
cd backend && fly deploy

echo ""
echo "Deployment complete!"
