# InstantMesh and textured GLB setup

The frontend first displays the enhanced ControlNet result. The user selects a variation and explicitly approves it; only then does the UI call `POST /api/3d/generate` with the generation ID and zero-based variation index.

## Keep runtimes isolated

InstantMesh's official environment pins older Diffusers and Transformers than this backend. Do not install its requirements into the FastAPI environment. The backend calls its Python executable as a subprocess and installs only `trimesh` locally to convert and validate the exported mesh.

Configure the FastAPI process with:

```env
INSTANTMESH_DIR=/content/InstantMesh
INSTANTMESH_PYTHON=/content/instantmesh-venv/bin/python
INSTANTMESH_CONFIG=
INSTANTMESH_TIMEOUT=1800
```

An empty `INSTANTMESH_CONFIG` uses `backend/config/instant-mesh-large-t4.yaml`, which follows the official `instant-mesh-large` config and sets `grid_res: 64` for the T4. Set it to a different config path if needed. An override path may be absolute or relative to `INSTANTMESH_DIR`.

The checkout must contain `run.py` and the config must be readable. The official runner downloads its checkpoints from Hugging Face if they are missing. `INSTANTMESH_PYTHON` must be the Python where the InstantMesh dependencies and CUDA-enabled PyTorch are installed. The API reports a configuration error if the checkout or interpreter is absent; it does not treat importing the service as proof that InstantMesh is ready.

## Reconstruction and export

The adapter executes the [official InstantMesh CLI](https://github.com/TencentARC/InstantMesh#running-with-command-line) with the selected generated image, `--export_texmap`, and a temporary output directory. The CLI writes a textured OBJ/MTL plus texture map under `<output>/<config-name>/meshes`; it does not write GLB directly. The backend loads the OBJ scene with its material files, exports GLB with embedded texture, reloads the GLB, and checks nonempty vertices/faces plus a texture material before returning success.

Only one InstantMesh run may use the configured GPU at a time. Requests have an environment-configured timeout. CUDA out-of-memory and missing-checkout failures return actionable API errors; there is no CPU fallback because the official InstantMesh runner is CUDA-bound.

## API

- `POST /api/3d/generate`: multipart `generation_id` (16 lowercase hex chars), `image_index` (zero-based).
- `GET /api/3d/files/{filename}`: validated GLB download. Filenames are random per request and constrained by a strict pattern.

The returned model URL and counts are derived from the actual generated GLB. See [`colab-t4-setup.md`](colab-t4-setup.md) for a complete runtime setup and smoke test.
