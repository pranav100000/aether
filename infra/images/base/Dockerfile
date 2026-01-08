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
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3-pip \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && rm -rf /var/lib/apt/lists/*

RUN wget https://go.dev/dl/go1.21.6.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.21.6.linux-amd64.tar.gz \
    && rm go1.21.6.linux-amd64.tar.gz

ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/home/coder/go"
ENV PATH="${GOPATH}/bin:${PATH}"

# Make dev servers bind to all interfaces by default (required for preview proxy)
# These are respected by Vite, webpack-dev-server, Next.js, and many other tools
ENV HOST=0.0.0.0
ENV HOSTNAME=0.0.0.0
# Vite specifically uses this
ENV VITE_HOST=0.0.0.0

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

RUN mkdir -p /home/coder/go/bin /home/coder/go/src /home/coder/go/pkg \
    && mkdir -p /home/coder/project

COPY --chown=coder:coder bashrc /home/coder/.bashrc

USER root

EXPOSE 2222

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
