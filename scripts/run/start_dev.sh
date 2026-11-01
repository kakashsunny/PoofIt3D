#!/bin/bash

echo "=== Starting Sketch-to-3D (Development Mode) ==="

# Get the project root directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Check if conda environments exist
if ! conda env list | grep -q "poofit3d-backend"; then
    echo "Error: Backend environment not found. Please run setup first:"
    echo "  ./scripts/setup/setup_conda.sh"
    exit 1
fi

if ! conda env list | grep -q "poofit3d-frontend"; then
    echo "Error: Frontend environment not found. Please run setup first:"
    echo "  ./scripts/setup/setup_conda.sh"
    exit 1
fi

# Function to cleanup processes
cleanup() {
    echo ""
    echo "Shutting down services..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo "✓ Backend stopped"
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null
        echo "✓ Frontend development server stopped"
    fi
    exit 0
}

# Set trap for cleanup
trap cleanup SIGINT SIGTERM

# Start backend
echo "Starting backend server..."
cd "$PROJECT_DIR/backend"
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate poofit3d-backend
python main.py &
BACKEND_PID=$!

# Wait for backend to start
echo "Waiting for backend to initialize..."
sleep 5

# Check if backend is running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Error: Backend failed to start"
    exit 1
fi

echo "✓ Backend started successfully"

# Start frontend in development mode
echo "Starting frontend development server..."
cd "$PROJECT_DIR/frontend"
conda activate poofit3d-frontend

# Set the API proxy target
export REACT_APP_API_URL=http://localhost:8000/api

# Start React development server
npm start &
FRONTEND_PID=$!

# Wait for frontend to start
echo "Waiting for frontend development server to initialize..."
sleep 5

# Check if frontend is running
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Error: Frontend development server failed to start"
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

echo "✓ Frontend development server started successfully"

echo ""
echo "✅ Application Started in Development Mode!"
echo ""
echo "Access the application:"
echo "  - Frontend Dev Server: http://localhost:3000 (with hot reload)"
echo "  - Backend API: http://localhost:8000"
echo ""
echo "Features:"
echo "  - ⚡ Hot reload enabled - changes appear instantly"
echo "  - 🔄 Auto-refresh on file save"
echo "  - 🐛 Better error messages"
echo ""
echo "Press Ctrl+C to stop both services"
echo ""

# Wait for processes
wait $BACKEND_PID $FRONTEND_PID