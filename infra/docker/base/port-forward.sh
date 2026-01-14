#!/bin/bash
# Forward dev server ports to localhost
# This allows external access to dev servers that only bind to localhost

if [ "$LOCAL_MODE" = "true" ]; then
    # Local dev: no forwarding needed
    # Dev servers should bind to 0.0.0.0 (e.g., vite --host, or use ports 9001-9005)
    # Docker port mapping handles the rest
    echo "Local mode: skipping port forwarding (dev servers should bind to 0.0.0.0)"
    # Keep the script running so the container doesn't exit
    sleep infinity
else
    # Production: forward common ports from IPv6 to localhost (for Fly.io gateway)
    PORTS="3000 3001 3002 4000 4200 5000 5173 5174 8000 8080 8081 8888 9000"
    for port in $PORTS; do
        # ipv6-v6only ensures we only bind to IPv6, not IPv4
        # This allows user's dev servers to bind to localhost (IPv4) on the same port
        socat TCP6-LISTEN:$port,fork,reuseaddr,ipv6-v6only TCP4:127.0.0.1:$port &
    done
    # Don't exit - keep running
    wait
fi
