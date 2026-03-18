FROM ubuntu:24.04

# Install Node.js 22 — Ubuntu 24.04 has GLIBC 2.39 (>= 2.38 required by @xmtp/node-bindings)
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps — fresh install to ensure platform-specific optional deps resolve correctly
COPY package.json ./
RUN npm install

# Copy source and build
COPY tsup.config.ts tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

ENV PORT=3100
ENV NODE_ENV=production

# XMTP SQLite DB lives on the persistent volume (mounted at /data on Railway)
# RAILWAY_VOLUME_MOUNT_PATH is set automatically by Railway

EXPOSE 3100
CMD ["node", "dist/index.js"]
