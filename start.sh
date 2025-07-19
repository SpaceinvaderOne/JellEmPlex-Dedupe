#!/bin/sh

# Function to check if Node.js server is running
check_node_server() {
    curl -s http://localhost:3000/health > /dev/null 2>&1
    return $?
}

# Start Node.js server in background
echo "Starting Node.js API server..."
node server.js &
NODE_PID=$!

# Wait for Node.js server to be ready
echo "Waiting for Node.js server to start..."
for i in $(seq 1 30); do
    if check_node_server; then
        echo "Node.js server is ready after ${i} seconds"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "ERROR: Node.js server failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Test nginx configuration
echo "Testing nginx configuration..."
nginx -t
if [ $? -ne 0 ]; then
    echo "ERROR: nginx configuration test failed"
    exit 1
fi

# Start nginx in foreground
echo "Starting nginx..."
nginx -g "daemon off;"