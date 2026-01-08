#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
KEYS_DIR="${PROJECT_ROOT}/.keys"

mkdir -p "$KEYS_DIR"

if [ -f "$KEYS_DIR/aether_rsa" ]; then
    echo "SSH key already exists at $KEYS_DIR/aether_rsa"
    echo "Delete it first if you want to regenerate."
    exit 1
fi

echo "Generating SSH keypair..."
ssh-keygen -t rsa -b 4096 -f "$KEYS_DIR/aether_rsa" -N "" -C "aether@local"

echo ""
echo "SSH keypair generated!"
echo ""
echo "Private key: $KEYS_DIR/aether_rsa"
echo "Public key:  $KEYS_DIR/aether_rsa.pub"
echo ""
echo "Add to your .env file:"
echo "  SSH_PRIVATE_KEY_PATH=$KEYS_DIR/aether_rsa"
echo ""
echo "Or for base64 encoded (for production):"
echo "  SSH_PRIVATE_KEY=$(base64 < "$KEYS_DIR/aether_rsa" | tr -d '\n')"
echo ""
echo "Public key to add to Dockerfile or pass as SSH_PUBLIC_KEY env var:"
echo ""
cat "$KEYS_DIR/aether_rsa.pub"
echo ""
