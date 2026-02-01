# PrivacyRPC Test Harness - Docker Container
# Run drainer tests safely in isolation

FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy all test files
COPY . .

# Expose port
EXPOSE 3333

# Start server
CMD ["node", "server.js"]
