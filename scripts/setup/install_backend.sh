#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python}"

echo "Preparing PyTorch for PoofIt3D"
if ! "${PYTHON_BIN}" -c "import torch" >/dev/null 2>&1; then
  if [[ -n "${TORCH_INDEX_URL:-}" ]]; then
    "${PYTHON_BIN}" -m pip install torch torchvision --index-url "${TORCH_INDEX_URL}"
  else
    echo "No PyTorch installation detected; installing CPU wheels."
    "${PYTHON_BIN}" -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
  fi
fi

echo "Installing PoofIt3D backend dependencies"
"${PYTHON_BIN}" -m pip install --upgrade pip
"${PYTHON_BIN}" -m pip install -r "${ROOT_DIR}/backend/requirements.txt"
"${PYTHON_BIN}" -m pip install -r "${ROOT_DIR}/backend/requirements-3d.txt"

"${PYTHON_BIN}" - <<'PY'
import torch
import torchvision
import diffusers
import transformers
import accelerate
import cv2
print('Diffusers:', diffusers.__version__)
print('Transformers:', transformers.__version__)
print('Accelerate:', accelerate.__version__)
print('OpenCV:', cv2.__version__)
print('PyTorch:', torch.__version__)
print('Torchvision:', torchvision.__version__)
print('CUDA available:', torch.cuda.is_available())
if torch.cuda.is_available():
    print('GPU:', torch.cuda.get_device_name(0))
else:
    print('CPU mode; inference will be significantly slower.')
PY

echo "Backend dependency setup finished. Configure the separate InstantMesh environment using docs/3d-setup.md."
