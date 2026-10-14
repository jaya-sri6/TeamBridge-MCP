FROM node:22.23.3-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22.23.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY public ./public

# Create data directory for SQLite DB persistence
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
