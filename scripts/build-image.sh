#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

FLY_APP_NAME="${FLY_APP_NAME:-aether-vms}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE_NAME="registry.fly.io/${FLY_APP_NAME}:${IMAGE_TAG}"

echo "Building base image..."
echo "Image: ${IMAGE_NAME}"

cd "${PROJECT_ROOT}/infra/images/base"

docker build -t "${IMAGE_NAME}" .

echo ""
echo "Build complete!"
echo ""
echo "To push to Fly registry:"
echo "  1. Authenticate: fly auth docker"
echo "  2. Push: docker push ${IMAGE_NAME}"
echo ""
echo "Or run: $0 --push"

if [ "$1" == "--push" ]; then
    echo "Authenticating with Fly registry..."
    fly auth docker

    echo "Pushing image..."
    docker push "${IMAGE_NAME}"

    echo ""
    echo "Image pushed successfully!"
    echo "Image: ${IMAGE_NAME}"
fi
