FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data

# Keep dependency installation in its own layer so Railway can reuse it
# whenever package.json and package-lock.json have not changed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --prefer-offline

COPY server.js ./
COPY public ./public
RUN mkdir -p /data/uploads

EXPOSE 3000
CMD ["node", "server.js"]
