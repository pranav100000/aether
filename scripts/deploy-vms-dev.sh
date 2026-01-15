#!/bin/bash
set -e

# Deploy VM base image for LOCAL DEVELOPMENT
# This pushes to the :dev tag which is separate from production
# Use promote-vm-image.sh to promote a tested dev image to production

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

IMAGE_NAME="pranav100000/aether-base"
IMAGE_TAG="dev"
FULL_IMAGE="$IMAGE_NAME:$IMAGE_TAG"

echo "=== DEVELOPMENT IMAGE BUILD ==="
echo "Building VM base image: $FULL_IMAGE"
echo "Platform: linux/amd64"
echo ""
echo "This image is for LOCAL TESTING ONLY."
echo "Use 'scripts/promote-vm-image.sh' to promote to production."
echo ""

cd infra/docker/base

# Copy workspace-service to build context
echo "Copying workspace-service..."
rm -rf workspace-service
cp -r "${PROJECT_ROOT}/apps/workspace-service" workspace-service
# Remove node_modules and lockfile - lockfile has workspace refs that don't exist in Docker
rm -rf workspace-service/node_modules workspace-service/bun.lock workspace-service/bun.lockb

# Build for amd64 (Fly.io runs on amd64)
docker build --platform linux/amd64 -t "$FULL_IMAGE" .

# Clean up
rm -rf workspace-service

echo ""
echo "Pushing dev image to Docker Hub..."
docker push "$FULL_IMAGE"

echo ""
echo "=== DEV DEPLOYMENT COMPLETE ==="
echo ""
echo "Image: $FULL_IMAGE"
echo ""
echo "To use locally, ensure your .env has:"
echo "  BASE_IMAGE=$FULL_IMAGE"
echo ""
echo "When ready for production, run:"
echo "  scripts/promote-vm-image.sh"
echo ""
