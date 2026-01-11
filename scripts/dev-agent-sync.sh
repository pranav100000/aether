#!/bin/bash
# Sync agent-service code to a running VM for hot-reload development
#
# Usage: ./scripts/dev-agent-sync.sh <project-id>
#
# Prerequisites:
# - flyctl installed and authenticated
# - Project VM must be running
# - fswatch installed (brew install fswatch)

set -e

PROJECT_ID=$1

if [ -z "$PROJECT_ID" ]; then
  echo "Usage: $0 <project-id>"
  echo ""
  echo "Get your project ID from the URL: /workspace/<project-id>"
  exit 1
fi

# Get the Fly app name for this project
APP_NAME="aether-vm-${PROJECT_ID}"

echo "Checking VM status..."
if ! flyctl status -a "$APP_NAME" > /dev/null 2>&1; then
  echo "Error: VM not found or not running. Start the project first."
  exit 1
fi

# Get the VM's private IP
PRIVATE_IP=$(flyctl machines list -a "$APP_NAME" --json | jq -r '.[0].private_ip')

if [ -z "$PRIVATE_IP" ] || [ "$PRIVATE_IP" == "null" ]; then
  echo "Error: Could not get VM private IP"
  exit 1
fi

echo "VM IP: $PRIVATE_IP"
echo ""

# Function to sync files
sync_files() {
  echo "[$(date +%H:%M:%S)] Syncing agent-service to VM..."

  # Use flyctl proxy to tunnel rsync through Fly's WireGuard network
  flyctl ssh console -a "$APP_NAME" -C "mkdir -p /opt/agent-service/src" 2>/dev/null || true

  # Sync the src directory
  rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude 'data' \
    -e "flyctl ssh console -a $APP_NAME -C" \
    ./agent-service/src/ \
    :/opt/agent-service/src/

  echo "[$(date +%H:%M:%S)] Sync complete. Agent will use new code on next connection."
}

# Initial sync
sync_files

# Watch for changes and sync
echo ""
echo "Watching for changes in agent-service/src/..."
echo "Press Ctrl+C to stop"
echo ""

fswatch -o ./agent-service/src | while read; do
  sync_files
done
