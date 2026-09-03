# Production 24/7 Cloud Dockerfile for WhatsApp AI Agent
FROM node:20-slim

# Install Chromium dependencies for headless WhatsApp Web engine
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    pangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer executable path to system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=3000
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy package manifests and install dependencies
COPY package*.json tsconfig.json ./
RUN npm ci --only=production

# Copy application source code
COPY . .

# Build TypeScript
RUN npm run build || true

# Expose server port
EXPOSE 3000

# Health check endpoint for Cloud auto-recovery
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Default execution command
CMD ["npx", "tsx", "src/index.ts"]
