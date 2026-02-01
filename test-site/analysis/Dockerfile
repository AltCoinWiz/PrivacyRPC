# Isolated analysis container - NO network access
FROM node:18-alpine

# Install tools for analysis
RUN apk add --no-cache unzip file

WORKDIR /analysis

# Create non-root user for extra safety
RUN adduser -D analyst
USER analyst

# Entry point just keeps container running
CMD ["sh", "-c", "echo 'Analysis container ready. Files in /analysis/malware/' && sh"]
