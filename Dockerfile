# Stage 1: Build - TypeScript compilation
FROM node:20-slim AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript to JavaScript
RUN npm run build

# Stage 2: Playwright - Install Chromium and dependencies
FROM mcr.microsoft.com/playwright:v1.58.1-noble AS playwright

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy built application from builder stage
COPY --from=builder /build/dist ./dist

# Install Chromium browser
RUN npx playwright install chromium

# Stage 3: Runtime - Final production image
FROM node:20-slim

WORKDIR /app

# Install required system libraries for Chromium
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r gradingworker && useradd -r -g gradingworker gradingworker

# Copy node_modules and dist from playwright stage
COPY --from=playwright --chown=gradingworker:gradingworker /app/node_modules ./node_modules
COPY --from=playwright --chown=gradingworker:gradingworker /app/dist ./dist

# Copy Chromium binaries from playwright stage
COPY --from=playwright /ms-playwright /ms-playwright

# Set environment variable for Playwright browsers path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Change to non-root user
USER gradingworker

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Health check (optional, Cloud Run has its own health checks)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/main.js"]
