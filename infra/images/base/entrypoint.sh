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

exec /usr/sbin/sshd -D -e
