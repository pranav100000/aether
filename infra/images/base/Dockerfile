# Build stage for port-watcher
FROM golang:1.21-alpine AS port-watcher-builder
COPY port-watcher /src
WORKDIR /src
RUN go mod download && CGO_ENABLED=0 go build -o /port-watcher .

# Final image
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    openssh-server \
    sudo \
    vim \
    nano \
    htop \
    jq \
    unzip \
    ca-certificates \
    gnupg \
    inotify-tools \
    tmux \
    ripgrep \
    fd-find \
    bat \
    tree \
    socat \
    psmisc \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

# Install Bun system-wide
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash \
    && ln -sf /usr/local/bin/bun /usr/local/bin/bunx

RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3-pip \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -G sudo coder \
    && echo "coder ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

RUN mkdir /var/run/sshd \
    && sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

USER coder
WORKDIR /home/coder

RUN mkdir -p /home/coder/.ssh \
    && chmod 700 /home/coder/.ssh \
    && echo "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDO5UBE4ZRa9PY4z+CQ/dizWt53h3yYTwg/gKDXSAsFLfUKBDvpPIRI+WerS7t/wW3rT3TOqAjB5HP3/v51K9GWkXa3cSkhCTVzG6qQ+21wqdnAZG+XtFV/Fens8k2z3wJGaU1ZQMW2pEGUQXo59vO1G3+onq69xOjKveZa2F54UxZv57Zywc0QW1/Y3U5fgsQn/3AmGeFopbZGPEmqTiW/QuQiTQin4ePGQq/pzLmGvdR1z5sqPN+RQkAYatFlS2quq6jleQZ9vLFpd6sctXSA8058kPyY5FWx3yh4DHQT2Fy93ZK8cKCLI2uPHqkyiNj1aYQsPnjB5qxmFzgYQ2iCaNyi3oNR51Uc/hH2Br0qNaXbVxsB97WyGh6y/rpPmMOAxuJaB5u+G2bGsoDPvZs0qQN8DHcKXvvWHZUXYGAayVY5RjPXGzmKfLJNgQBXpaTBHx4A8AS3KimRNwII4GsoCev0FQyZSUORJVxx1ymnjVLoUEfHaZbbFcYzS4JET1pkHcTsV3JKawkHQlhtQjctsSNde6Ug1/8OcL22xvySONi7h2P9nXH3RPrTASi83f5DuyL+4zwURdxafnij30i2JR/zvI4BjJOgXR67A1vZgeJxGHXPQCta4zQ1XOFrPQa0b7ljzWe158CQHtX5tgsfzPxDyJgUeKql7xK3hCv4xQ== aether@local" > /home/coder/.ssh/authorized_keys \
    && chmod 600 /home/coder/.ssh/authorized_keys

RUN mkdir -p /home/coder/project

COPY --chown=coder:coder bashrc /home/coder/.bashrc
COPY --chown=coder:coder tmux.conf /home/coder/.tmux.conf

USER root

# Copy and install workspace-service (runs in VM, handles agent tools)
COPY workspace-service /opt/workspace-service
WORKDIR /opt/workspace-service
RUN bun install --frozen-lockfile --production
WORKDIR /home/coder

# Copy pre-built port-watcher from builder stage
COPY --from=port-watcher-builder /port-watcher /usr/local/bin/port-watcher

# Port forwarding script for IPv6 → localhost
COPY port-forward.sh /usr/local/bin/port-forward.sh
RUN chmod +x /usr/local/bin/port-forward.sh

EXPOSE 2222

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
