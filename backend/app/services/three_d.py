"""Run the official InstantMesh CLI outside the FastAPI request process."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

_INFERENCE_LOCK = threading.Lock()


def _require_trimesh():
    try:
        import trimesh
    except ImportError as exc:
        raise RuntimeError(
            "GLB conversion dependency is missing. Install backend/requirements-3d.txt in the FastAPI environment."
        ) from exc
    return trimesh


def _resolve_python(value: str) -> str:
    candidate = Path(value).expanduser()
    if candidate.is_file():
        return str(candidate.resolve())
    located = shutil.which(value)
    if located:
        return located
    raise RuntimeError(
        f"InstantMesh Python executable '{value}' was not found. Set INSTANTMESH_PYTHON "
        "to the Python environment where InstantMesh dependencies are installed."
    )


def _mesh_stats(scene: Any) -> tuple[int, int, int]:
    trimesh = _require_trimesh()

    geometries = list(scene.geometry.values()) if isinstance(scene, trimesh.Scene) else [scene]
    vertices = sum(len(mesh.vertices) for mesh in geometries if hasattr(mesh, "vertices"))
    faces = sum(len(mesh.faces) for mesh in geometries if hasattr(mesh, "faces"))
    textures = 0
    for mesh in geometries:
        visual = getattr(mesh, "visual", None)
        material = getattr(visual, "material", None)
        if material is not None and (
            getattr(material, "image", None) is not None
            or getattr(material, "baseColorTexture", None) is not None
        ):
            textures += 1
    return int(vertices), int(faces), textures


def image_to_glb(image_path: str | Path, output_path: str | Path) -> dict:
    """Reconstruct the approved image with InstantMesh and return validated GLB stats.

    InstantMesh's own environment is selected through INSTANTMESH_PYTHON. Its
    dependencies are never installed into or imported by the FastAPI process.
    """
    source = Path(os.getenv("INSTANTMESH_DIR", "/content/InstantMesh")).expanduser().resolve()
    runner = source / "run.py"
    config_env = os.getenv("INSTANTMESH_CONFIG", "")
    config = Path(config_env).expanduser() if config_env else (
        Path(__file__).resolve().parents[2] / "config" / "instant-mesh-large-t4.yaml"
    )
    if not config.is_absolute():
        config = source / config
    config = config.resolve()
    python = _resolve_python(os.getenv("INSTANTMESH_PYTHON", sys.executable))
    image = Path(image_path).resolve()
    target = Path(output_path).resolve()

    if not runner.is_file():
        raise RuntimeError(
            f"InstantMesh checkout is missing at {source}. Restore/clone TencentARC/InstantMesh "
            "and set INSTANTMESH_DIR."
        )
    if not config.is_file():
        raise RuntimeError(f"InstantMesh config is missing: {config}")
    if not image.is_file():
        raise FileNotFoundError(f"Approved enhancement image was not found: {image}")
    if not _INFERENCE_LOCK.acquire(blocking=False):
        raise RuntimeError("InstantMesh is already processing another image. Try again when it finishes.")

    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix="poofit3d-instantmesh-") as temporary:
            output_dir = Path(temporary) / "outputs"
            command = [
                python, str(runner), str(config), str(image),
                "--export_texmap", "--output_path", str(output_dir),
            ]
            timeout = max(60, int(os.getenv("INSTANTMESH_TIMEOUT", "1800")))
            env = os.environ.copy()
            # InstantMesh JIT-compiles nvdiffrast CUDA kernels: ninja (in its venv) and nvcc must be on PATH.
            cuda_home = env.get("CUDA_HOME") or (
                str(Path(shutil.which("nvcc")).resolve().parent.parent) if shutil.which("nvcc") else "/usr/local/cuda"
            )
            env["CUDA_HOME"] = cuda_home
            env["PATH"] = os.pathsep.join([str(Path(python).parent), f"{cuda_home}/bin", env.get("PATH", "")])
            env.setdefault("TORCH_CUDA_ARCH_LIST", "7.5")
            if os.getenv("INSTANTMESH_CUDA_VISIBLE_DEVICES"):
                env["CUDA_VISIBLE_DEVICES"] = os.environ["INSTANTMESH_CUDA_VISIBLE_DEVICES"]
            try:
                completed = subprocess.run(
                    command, cwd=source, capture_output=True, text=True, timeout=timeout, check=False, env=env
                )
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError(
                    f"InstantMesh exceeded {timeout} seconds. Check the T4 runtime and model checkpoints."
                ) from exc

            if completed.returncode != 0:
                log_tail = (completed.stderr or completed.stdout or "No subprocess output")[-6000:]
                if "out of memory" in log_tail.lower() or "cuda oom" in log_tail.lower():
                    raise RuntimeError(
                        "InstantMesh ran out of T4 GPU memory. Keep grid_res=64 in the configured "
                        "T4 YAML and close other GPU workloads. Details: " + log_tail
                    )
                raise RuntimeError(
                    f"InstantMesh exited with code {completed.returncode}. Check its environment, "
                    f"checkpoints, and logs: {log_tail}"
                )

            obj_candidates = list(output_dir.rglob("*.obj"))
            if not obj_candidates:
                raise RuntimeError("InstantMesh returned success but did not create a textured OBJ mesh.")
            obj_path = max(obj_candidates, key=lambda path: path.stat().st_mtime)

            trimesh = _require_trimesh()
            scene = trimesh.load(str(obj_path), force="scene", process=False)
            vertices, faces, source_textures = _mesh_stats(scene)
            if not vertices or not faces:
                raise RuntimeError("InstantMesh output contains no mesh vertices or faces.")
            if source_textures == 0:
                raise RuntimeError(
                    "InstantMesh OBJ did not load with a texture material. Check its MTL and PNG outputs."
                )

            target.parent.mkdir(parents=True, exist_ok=True)
            scene.export(str(target), file_type="glb")
            if not target.is_file() or target.stat().st_size < 20:
                raise RuntimeError("InstantMesh GLB export is empty or invalid.")
            validated = trimesh.load(str(target), file_type="glb", force="scene", process=False)
            glb_vertices, glb_faces, glb_textures = _mesh_stats(validated)
            if not glb_vertices or not glb_faces or glb_textures == 0:
                raise RuntimeError("Exported GLB failed validation: geometry or embedded texture is missing.")

        return {
            "vertices": glb_vertices,
            "faces": glb_faces,
            "device": "cuda",
            "engine": "InstantMesh",
            "textured": True,
            "texture_materials": glb_textures,
            "elapsed_seconds": round(time.monotonic() - started, 2),
        }
    finally:
        _INFERENCE_LOCK.release()
