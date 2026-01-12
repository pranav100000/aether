#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

APP_NAME="aether-agent-service"

echo "Deploying workspace-service using Infisical secrets..."

# Set Fly secrets using infisical
infisical run --env=prod --path=/agent-service -- bash -c "
    fly secrets set \\
        ANTHROPIC_API_KEY=\"\$ANTHROPIC_API_KEY\" \\
        OPENAI_API_KEY=\"\$OPENAI_API_KEY\" \\
        CODEBUFF_API_KEY=\"\$CODEBUFF_API_KEY\" \\
        CODEBUFF_BYOK_OPENROUTER=\"\$CODEBUFF_BYOK_OPENROUTER\" \\
        OPENROUTER_API_KEY=\"\$OPENROUTER_API_KEY\" \\
        -a $APP_NAME
"

echo ""
echo "Deploying workspace-service..."
cd workspace-service && fly deploy

echo ""
echo "Deployment complete!"
