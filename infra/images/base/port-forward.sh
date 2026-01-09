#!/bin/bash
# Forward common dev server ports from IPv6 to localhost
# This allows the gateway to reach dev servers that only bind to localhost

PORTS="3000 3001 3002 4000 4200 5000 5173 5174 8000 8080 8081 8888 9000"

for port in $PORTS; do
    # ipv6-v6only ensures we only bind to IPv6, not IPv4
    # This allows user's dev servers to bind to localhost (IPv4) on the same port
    socat TCP6-LISTEN:$port,fork,reuseaddr,ipv6-v6only TCP4:127.0.0.1:$port &
done

# Don't exit - keep running
wait
