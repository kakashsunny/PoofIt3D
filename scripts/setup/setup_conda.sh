#!/bin/bash

echo "=== Sketch-to-3D Conda Setup ==="
echo "Setting up conda environments and dependencies..."

# Check if conda is available
if ! command -v conda &> /dev/null; then
    echo "Error: Conda is not installed or not in PATH. Please install Miniconda/Anaconda first."
    exit 1
fi

# Get the project root directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Create required directories
echo "Creating required directories..."
mkdir -p "$PROJECT_DIR/backend/dataset/sketch" "$PROJECT_DIR/backend/dataset/result" "$PROJECT_DIR/backend/dataset/metadata"
chmod -R 755 "$PROJECT_DIR/backend/dataset"
echo "✓ Created dataset directories with proper permissions"

# Setup Backend Environment
echo ""
echo "=== Setting up Backend Environment ==="
echo "Creating conda environment: poofit3d-backend"

# Remove existing environment if it exists
conda env remove -n poofit3d-backend -y 2>/dev/null || true

# Create new environment
conda create -n poofit3d-backend python=3.10 -y
if [ $? -ne 0 ]; then
    echo "Error: Failed to create backend conda environment"
    exit 1
fi

echo "✓ Created poofit3d-backend environment"

# Activate backend environment and install dependencies
echo "Installing backend dependencies..."
source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate poofit3d-backend

# Install system-level dependencies
echo "Installing system dependencies..."
conda install -y requests urllib3 certifi

# Install PyTorch with appropriate version
echo "Installing PyTorch..."
if command -v nvidia-smi &> /dev/null; then
    echo "NVIDIA GPU detected - installing CUDA 11.8 version"
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu118
    DEVICE_SETTING="cuda"
else
    echo "No NVIDIA GPU detected - installing CPU version"
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
    DEVICE_SETTING="cpu"
fi

echo "✓ PyTorch installed"

# Install remaining requirements
echo "Installing remaining requirements..."
cd "$PROJECT_DIR/backend"
pip install --no-cache-dir -r requirements.txt

echo "✓ Backend dependencies installed"

# Create backend .env file
echo "Creating backend configuration..."
cat > .env << EOF
# Device Configuration
DEVICE=$DEVICE_SETTING
INSTANTMESH_TIMEOUT=1800
# Set INSTANTMESH_DIR and INSTANTMESH_PYTHON in .env for your separate checkout/env.

# Backend Settings
HOST=0.0.0.0
PORT=8000
DEBUG_MODE=true
DEFAULT_MODEL_ID=controlnet_scribble
NUM_INFERENCE_STEPS=20
GUIDANCE_SCALE=7.5
OUTPUT_IMAGE_SIZE=512

# Frontend Settings
FRONTEND_URL=http://localhost:3000
PUBLIC_URL=http://localhost:3000

# Dataset Directory (direct save)
DATASET_DIR=dataset

# Hugging Face Token for private models
# HUGGING_FACE_HUB_TOKEN=your_token_here
EOF

echo "✓ Backend configuration created"

# Setup Frontend Environment
echo ""
echo "=== Setting up Frontend Environment ==="

# Deactivate current environment
conda deactivate

# Remove existing environment if it exists
conda env remove -n poofit3d-frontend -y 2>/dev/null || true

# Create frontend environment
echo "Creating conda environment: poofit3d-frontend"
conda create -n poofit3d-frontend -y
if [ $? -ne 0 ]; then
    echo "Error: Failed to create frontend conda environment"
    exit 1
fi

echo "✓ Created poofit3d-frontend environment"

# Activate frontend environment and install Node.js
echo "Installing Node.js from conda-forge..."
conda activate poofit3d-frontend
conda install conda-forge::nodejs -y
if [ $? -ne 0 ]; then
    echo "Error: Failed to install Node.js"
    exit 1
fi

echo "✓ Node.js installed successfully"

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd "$PROJECT_DIR/frontend"
npm install
if [ $? -ne 0 ]; then
    echo "Error: Failed to install frontend dependencies"
    exit 1
fi

echo "✓ Frontend dependencies installed"

# Build frontend
echo "Building frontend for production..."
npm run build
if [ $? -ne 0 ]; then
    echo "Error: Failed to build frontend"
    exit 1
fi

echo "✓ Frontend built successfully"

# Install proxy server dependencies
echo "Installing proxy server dependencies..."
cd "$PROJECT_DIR/proxy-server"
npm install
if [ $? -ne 0 ]; then
    echo "Error: Failed to install proxy server dependencies"
    exit 1
fi

echo "✓ Proxy server dependencies installed"

conda deactivate

echo ""
echo "===== Conda Setup Complete! ====="
echo ""
echo "Created conda environments:"
echo "  - poofit3d-backend (Python 3.10 + PyTorch + AI libraries)"
echo "  - poofit3d-frontend (Node.js + React)"
echo ""
echo "Directory structure:"
echo "  backend/dataset/sketch/    - Sketch dataset"
echo "  backend/dataset/result/    - Result dataset"
echo "  backend/dataset/metadata/  - Generation metadata"
echo ""
echo "Architecture:"
echo "  - Backend (FastAPI): Runs on http://localhost:8000 (internal)"
echo "  - Proxy (Express): Serves React app + proxies API calls on http://localhost:3000"
echo ""
echo "To start the application:"
echo "  ./scripts/run/start_conda.sh"
echo ""
echo "Configuration:"
echo "  - Device: $DEVICE_SETTING"
echo "  - Main access: http://localhost:3000"
echo ""
echo "Note: The first image generation will take longer as models are downloaded."
