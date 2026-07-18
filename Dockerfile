FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data

# Force the public npm registry. This prevents Railway from trying to use
# a machine-specific or private registry captured in a lockfile.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --include=optional --no-audit --no-fund

COPY server.js ./
COPY public ./public
RUN mkdir -p /data/uploads

EXPOSE 3000
CMD ["node", "server.js"]
