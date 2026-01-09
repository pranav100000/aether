#!/bin/bash

if [ -n "$SSH_PUBLIC_KEY" ]; then
    echo "$SSH_PUBLIC_KEY" >> /home/coder/.ssh/authorized_keys
    chown coder:coder /home/coder/.ssh/authorized_keys
    chmod 600 /home/coder/.ssh/authorized_keys
fi

# Ensure project directory exists and has correct permissions
# (Fly Volume mounts may create directories owned by root)
mkdir -p /home/coder/project
chown coder:coder /home/coder/project

# Export environment variables for SSH sessions
# sshd doesn't pass container env vars to login shells, so we write them to a file
# that gets sourced by .bashrc
ENV_FILE="/home/coder/.aether_env"
: > "$ENV_FILE"  # Create/truncate file

# Export API keys and other relevant env vars
for var in ANTHROPIC_API_KEY OPENAI_API_KEY PROJECT_ID; do
    if [ -n "${!var}" ]; then
        echo "export $var=\"${!var}\"" >> "$ENV_FILE"
    fi
done

# Codex SDK uses CODEX_API_KEY instead of OPENAI_API_KEY
if [ -n "$OPENAI_API_KEY" ]; then
    echo "export CODEX_API_KEY=\"$OPENAI_API_KEY\"" >> "$ENV_FILE"
fi

# Agent service configuration
echo "export STORAGE_DIR=\"/home/coder/project/.aether\"" >> "$ENV_FILE"
echo "export PROJECT_CWD=\"/home/coder/project\"" >> "$ENV_FILE"

chown coder:coder "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Pre-approve ANTHROPIC_API_KEY for Claude Code
# Claude Code requires explicit approval of API keys before using them
if [ -n "$ANTHROPIC_API_KEY" ]; then
    # Get last 20 characters of the API key (Claude Code's identifier)
    KEY_SUFFIX="${ANTHROPIC_API_KEY: -20}"

    CLAUDE_CONFIG="/home/coder/.claude.json"
    cat > "$CLAUDE_CONFIG" << EOF
{
  "customApiKeyResponses": {
    "approved": ["$KEY_SUFFIX"],
    "rejected": []
  },
  "hasCompletedOnboarding": true
}
EOF
    chown coder:coder "$CLAUDE_CONFIG"
    chmod 600 "$CLAUDE_CONFIG"
fi

# Pre-authenticate Codex CLI with API key
if [ -n "$OPENAI_API_KEY" ]; then
    mkdir -p /home/coder/.codex

    # Write auth.json directly instead of running codex login (faster startup)
    cat > /home/coder/.codex/auth.json << EOF
{
  "api_key": "$OPENAI_API_KEY"
}
EOF
    chown -R coder:coder /home/coder/.codex
    chmod 600 /home/coder/.codex/auth.json
fi

# Start port forwarding for IPv6 → localhost
# This allows the gateway to reach dev servers that only bind to localhost
/usr/local/bin/port-forward.sh &

exec /usr/sbin/sshd -D -e
