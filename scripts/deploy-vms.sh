#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

IMAGE_NAME="pranav100000/aether-base"
IMAGE_TAG="${1:-latest}"
FULL_IMAGE="$IMAGE_NAME:$IMAGE_TAG"

echo "Building VM base image: $FULL_IMAGE"
echo "Platform: linux/amd64"
echo ""

cd infra/images/base

# Copy workspace-service to build context
echo "Copying workspace-service..."
rm -rf workspace-service
cp -r "${PROJECT_ROOT}/workspace-service" workspace-service
# Remove node_modules (will be installed fresh in Docker), keep lockfile for reproducibility
rm -rf workspace-service/node_modules
# Remove .env file (contains local dev settings that shouldn't be in the image)
rm -f workspace-service/.env

# Build for amd64 (Fly.io runs on amd64)
docker build --platform linux/amd64 -t "$FULL_IMAGE" .

# Clean up
rm -rf workspace-service

echo ""
echo "Pushing image to Docker Hub..."
docker push "$FULL_IMAGE"

echo ""
echo "Deployment complete!"
echo ""
echo "Image: $FULL_IMAGE"
echo ""
echo "To use this image, existing machines will pick it up on next start."
echo "To force update a running machine, stop and start it."
