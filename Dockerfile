FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV NODE_NO_WARNINGS=1

COPY package.json package-lock.json ./
RUN npm ci \
    --omit=dev \
    --include=optional \
    --no-audit \
    --no-fund \
    --registry=https://registry.npmjs.org/

COPY server.js ./
COPY public ./public

EXPOSE 3000
CMD ["node", "--no-warnings", "server.js"]
