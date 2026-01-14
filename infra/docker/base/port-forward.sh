#!/bin/bash
# Port forwarding for local development mode.
# In production (Fly.io), the workspace-service PortWatcher handles
# dynamic forwarding. This script is only needed for local Docker.

if [ "$LOCAL_MODE" = "true" ]; then
    # Local dev: forward common ports so Docker port mapping works
    # Dev servers bind to localhost, but Docker needs 0.0.0.0
    PORTS="3000 3001 3002 4000 4200 5000 5173 5174 6000 7000 8000 8080 8081 8888 9000"
    for port in $PORTS; do
        socat TCP-LISTEN:$port,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:$port &
    done
    wait
else
    # Production: PortWatcher handles dynamic forwarding
    sleep infinity
fi
