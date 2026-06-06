FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git openssh-client

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV TASKS_DIR=/app/volumes/tasks
ENV LOGS_DIR=/app/volumes/logs
ENV DATA_DIR=/app/volumes/data
ENV DISCOVERY_INTERVAL_MS=30000
ENV RETENTION_DAYS=90

RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /app/volumes/tasks /app/volumes/logs /app/volumes/data && chown -R app:app /app

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/server.js"]
