# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node","apps/web/.next/standalone/server.js"]
