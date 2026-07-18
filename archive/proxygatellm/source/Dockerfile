# Dockerfile — Jeumpa LLM v1.0.0
# Multi-stage build for minimal image size

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production --no-bin-links

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV PORT=3333
ENV JEUMPA_DATA_DIR=/data

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3333/health', r => {process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
