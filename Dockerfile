FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data

# Do not depend on a hidden .npmrc file. GitHub browser uploads may omit
# dotfiles, so the public registry is specified directly in this command.
COPY package.json package-lock.json ./
RUN npm ci \
    --omit=dev \
    --include=optional \
    --no-audit \
    --no-fund \
    --registry=https://registry.npmjs.org/

COPY server.js ./
COPY public ./public
RUN mkdir -p /data/uploads

EXPOSE 3000
CMD ["node", "server.js"]
