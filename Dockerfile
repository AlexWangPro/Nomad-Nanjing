FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
COPY public ./public
RUN mkdir -p /data/uploads
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
