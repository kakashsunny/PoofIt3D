# Google Colab T4 setup

Use [`PoofIt3D_T4_Setup.ipynb`](../PoofIt3D_T4_Setup.ipynb) for the reproducible setup and real smoke run. Colab deletes `/content`, installed packages, downloaded caches, and running processes when a runtime resets. Keep source in Git and copy only user assets that must persist to Drive.

## Runtime architecture

- FastAPI and Stable Diffusion 1.5 + ControlNet Scribble run in Colab's Python environment, using its already-installed CUDA PyTorch and FP16 model loading.
- InstantMesh uses a separate Python 3.10 virtual environment. Its upstream pins older Diffusers/Transformers than this backend; do not install InstantMesh requirements into the backend environment.
- The backend launches InstantMesh `run.py` as a subprocess, with a T4 config (`grid_res=64`). It exports textured OBJ/MTL, then the backend converts and validates the textured GLB.

The notebook clones the branch `feat/instantmesh-sketch-to-3d` from `kakashsunny/PoofIt3D`. Push that branch to GitHub before using the notebook's automatic checkout. It verifies `/api/health`, performs a real ControlNet generation from `backend/test_sketches/house_sketch.png`, invokes `/api/3d/generate`, downloads the returned GLB, and parses its geometry/material with trimesh. These are real GPU operations and may download several GB of model weights.

## Run order

1. Select Runtime → Change runtime type → T4 GPU.
2. Run notebook cells in order; confirm the GPU is visible.
3. The notebook installs system libraries, backend dependencies and trimesh without specifying a new backend torch wheel.
4. It clones TencentARC/InstantMesh only if `/content/InstantMesh/run.py` is absent, creates the isolated Python 3.10 environment, and installs the official runtime requirements there.
5. It caches the two InstantMesh checkpoints under that checkout's `ckpts/`; Zero123++ weights are downloaded by the official pipeline on first inference.
6. It writes only runtime paths to `backend/.env`, starts FastAPI, waits for its health endpoint, then runs 2D and 3D smoke generations.

The exact InstantMesh CLI is `python run.py <config> <input-image> --export_texmap --output_path <directory>`. The official CLI exports OBJ/MTL plus a texture map under `<directory>/<config-name>/meshes`; it does not output GLB. The backend performs and validates the conversion. The bundled config uses the official `instant-mesh-large` model settings with `grid_res` lowered from 128 to 64 for the T4.

## Connect the React application

Keep FastAPI running, expose port 8000 through a temporary tunnel provider, and set the existing frontend build variable `REACT_APP_API_URL` to the tunnel origin ending in `/api`. The frontend API helper uses that setting for REST, SSE progress, image URLs, QR sharing and GLB downloads. Set `FRONTEND_URL` to the frontend origin and `PUBLIC_URL` to the backend tunnel origin for CORS and share QR codes, then restart FastAPI. Avoid committing a tunnel URL or exposing the unauthenticated prototype broadly.

The notebook smoke test approves the first variation for integration verification. In the app, users must first select a generated variation and click **approve selected image for 3D** before the separate Generate 3D action becomes available.

No GPU inference is claimed until the notebook's HTTP generation, InstantMesh run, GLB download and parse cells all succeed. Single-image reconstruction infers hidden sides; it is not a geometry guarantee or CAD reconstruction.
