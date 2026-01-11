#!/bin/bash
# Run agent locally but operate on VM's filesystem via SSHFS
#
# Usage: ./scripts/dev-agent-vm.sh <project-id>
#
# Prerequisites:
# - flyctl installed and authenticated
# - sshfs installed (brew install macfuse && brew install sshfs)
# - Project VM must be running

set -e

PROJECT_ID=$1

if [ -z "$PROJECT_ID" ]; then
  echo "Usage: $0 <project-id>"
  echo ""
  echo "Get your project ID from the URL: /workspace/<project-id>"
  exit 1
fi

APP_NAME="aether-vm-${PROJECT_ID}"
MOUNT_DIR="./vm-mount-${PROJECT_ID}"
SSH_PORT=2222

echo "=== Agent Local Dev with VM Filesystem ==="
echo ""

# Check if VM is running
echo "Checking VM status..."
if ! flyctl status -a "$APP_NAME" > /dev/null 2>&1; then
  echo "Error: VM not found or not running. Start the project first."
  exit 1
fi

# Create mount directory
mkdir -p "$MOUNT_DIR"

# Check if already mounted
if mount | grep -q "$MOUNT_DIR"; then
  echo "VM filesystem already mounted at $MOUNT_DIR"
else
  echo "Starting SSH proxy..."
  # Start flyctl proxy in background
  flyctl proxy $SSH_PORT:22 -a "$APP_NAME" &
  PROXY_PID=$!
  sleep 2

  echo "Mounting VM filesystem via SSHFS..."
  # Mount with password-less auth (Fly uses key-based auth)
  sshfs -p $SSH_PORT \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o reconnect \
    -o ServerAliveInterval=15 \
    coder@localhost:/home/coder/project "$MOUNT_DIR"

  echo "Mounted at: $MOUNT_DIR"
fi

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up..."
  # Unmount
  if mount | grep -q "$MOUNT_DIR"; then
    umount "$MOUNT_DIR" 2>/dev/null || diskutil unmount force "$MOUNT_DIR" 2>/dev/null || true
  fi
  # Kill proxy
  if [ -n "$PROXY_PID" ]; then
    kill $PROXY_PID 2>/dev/null || true
  fi
  echo "Done."
}
trap cleanup EXIT

echo ""
echo "Starting agent service with VM filesystem..."
echo "PROJECT_CWD=$MOUNT_DIR"
echo ""

# Run agent service pointing at the mounted VM filesystem
cd "$(dirname "$0")/../agent-service"
PROJECT_CWD="$MOUNT_DIR" STORAGE_DIR="$MOUNT_DIR/.aether" bun --watch run src/server.ts
