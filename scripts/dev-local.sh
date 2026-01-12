#!/bin/bash
# Run agent-service and workspace-service locally for development

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Load environment variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Generate a dev session token (for local testing)
export AGENT_SESSION_TOKEN=$(openssl rand -base64 32)

echo "Starting local development environment..."
echo ""
echo "Agent Service URL: http://localhost:8080"
echo "Workspace Service: docker-compose"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Shutting down..."
    kill $AGENT_PID 2>/dev/null || true
    cd "$PROJECT_ROOT/workspace-service" && docker compose -f docker-compose.dev.yml down 2>/dev/null || true
}
trap cleanup EXIT

# Start agent-service in background
echo "Starting agent-service..."
cd "$PROJECT_ROOT/agent-service"
bun run dev &
AGENT_PID=$!

# Wait for agent-service to be ready
echo "Waiting for agent-service to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "agent-service is ready!"
        break
    fi
    sleep 1
done

# Start workspace-service
echo "Starting workspace-service..."
cd "$PROJECT_ROOT/workspace-service"
docker compose -f docker-compose.dev.yml up --build

# Wait for agent-service
wait $AGENT_PID
