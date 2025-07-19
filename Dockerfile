FROM node:18-alpine

# Install nginx
RUN apk add --no-cache nginx curl

# Set working directory
WORKDIR /app

# Create directories
RUN mkdir -p /var/lib/nginx/body /var/log/nginx /run/nginx
RUN mkdir -p /app/serverconfig

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy application files
COPY index.html ./
COPY script.js ./
COPY styles.css ./
COPY server.js ./
COPY sio.png ./

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

# Copy startup script
COPY start.sh ./
RUN chmod +x start.sh

# Start both nginx and Node.js server
CMD ["./start.sh"]