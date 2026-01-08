#!/bin/bash

if [ -n "$SSH_PUBLIC_KEY" ]; then
    echo "$SSH_PUBLIC_KEY" >> /home/coder/.ssh/authorized_keys
    chown coder:coder /home/coder/.ssh/authorized_keys
    chmod 600 /home/coder/.ssh/authorized_keys
fi

exec /usr/sbin/sshd -D -e
