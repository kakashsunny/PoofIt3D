"""Headless end-to-end run: sketch -> 3 enhanced images -> InstantMesh GLB, for every test sketch.

Usage (API must be running):  python run_e2e.py [--api http://127.0.0.1:8000/api] [--out ../docs/results]
Produces per sketch: <name>_grid.png (sketch | 3 variations), <name>.glb, and results.json (timings, mesh stats).
Use the PNG grids as README example photos; screen-record the UI for the demo video.
"""
import argparse, json, time
from pathlib import Path
import requests
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent


def wait(api, gid, timeout=1800):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = requests.get(f"{api}/status/{gid}", timeout=30).json()
        if r["status"] in ("completed", "failed"):
            return r
        time.sleep(3)
    raise TimeoutError(gid)


def grid(sketch: Path, variants: list, out: Path):
    tiles = [Image.open(sketch).convert("RGB")] + [Image.open(v).convert("RGB") for v in variants]
    size = 384
    canvas = Image.new("RGB", (size * len(tiles), size + 28), "white")
    d = ImageDraw.Draw(canvas)
    for i, (tile, label) in enumerate(zip(tiles, ["Sketch", "Variation 1", "Variation 2", "Variation 3"])):
        tile.thumbnail((size, size))
        canvas.paste(tile, (i * size + (size - tile.width) // 2, 28))
        d.text((i * size + 8, 8), label, fill="black")
    canvas.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000/api")
    ap.add_argument("--out", default=str(HERE.parent / "docs" / "results"))
    ap.add_argument("--model", default="controlnet_scribble")
    ap.add_argument("--no3d", action="store_true")
    ap.add_argument("--sketch", help="run a single sketch image instead of the 5 bundled tests")
    ap.add_argument("--prompt", default="", help="optional text prompt (only with --sketch)")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    health = requests.get(f"{a.api}/health", timeout=30).json()
    gpu = health.get("gpu") or {"name": "CPU only", "vram_gb": 0}
    if a.sketch:
        jobs = [(Path(a.sketch).resolve(), a.prompt)]
    else:
        prompts = json.loads((HERE / "test_sketches" / "prompts.json").read_text())
        jobs = [(HERE / "test_sketches" / f, p) for f, p in prompts.items()]
    summary = {}
    for sketch, prompt in jobs:
        fname = sketch.name
        name = sketch.stem.replace("_sketch", "")
        t0 = time.time()
        with sketch.open("rb") as fh:
            r = requests.post(f"{a.api}/generate", files={"sketch_file": (fname, fh, "image/png")},
                              data={"style_id": "photorealistic", "model_id": a.model, "description": prompt}, timeout=60)
        r.raise_for_status()
        gid = r.json()["generation_id"]
        res = wait(a.api, gid)
        if res["status"] != "completed":
            raise RuntimeError(f"{name}: {res['message']}")
        variants = []
        for k in (1, 2, 3):
            p = out / f"{name}_v{k}.png"
            p.write_bytes(requests.get(f"{a.api}/images/{gid}_{k}", timeout=60).content)
            variants.append(p)
        grid(sketch, variants, out / f"{name}_grid.png")
        entry = {"generation_id": gid, "image_seconds": round(time.time() - t0, 1),
                 "fidelity_scores": (res.get("quality") or {}).get("scores"),
                 "best_variation": ((res.get("quality") or {}).get("best_index", 0)) + 1}
        if not a.no3d:
            try:
                m = requests.post(f"{a.api}/3d/generate", data={"generation_id": gid, "image_index": entry["best_variation"] - 1}, timeout=2000)
                if not m.ok:
                    raise RuntimeError(f"HTTP {m.status_code}: {m.text[-1500:]}")
                m = m.json()
                glb = requests.get(a.api.rsplit("/api", 1)[0] + m["model_url"], timeout=120)
                glb.raise_for_status()
                (out / f"{name}.glb").write_bytes(glb.content)
                entry.update({k: m[k] for k in ("vertices", "faces", "textured", "elapsed_seconds")})
            except Exception as exc:  # keep going: 2D results for the other sketches are still valuable
                entry["error_3d"] = str(exc)[:1500]
                print(f"[{name}] 3D FAILED: {exc}", flush=True)
        summary[name] = entry
        print(name, entry, flush=True)
    (out / "results.json").write_text(json.dumps({"hardware": gpu, "runs": summary}, indent=2))
    rows = ["| Sketch | 2D enhance (s) | 3D reconstruct (s) | Fidelity (IoU, v1/v2/v3) | Best | Vertices | Faces |", "|---|---|---|---|---|---|---|"]
    for n, e in summary.items():
        sc = " / ".join(f"{x:.2f}" for x in (e["fidelity_scores"] or []))
        rows.append(f"| {n} | {e['image_seconds']} | {e.get('elapsed_seconds', '-')} | {sc} | v{e['best_variation']} | {e.get('vertices', '-')} | {e.get('faces', '-')} |")
    (out / "RESULTS.md").write_text(f"Hardware: **{gpu['name']}** ({gpu['vram_gb']} GB VRAM)\n\n" + "\n".join(rows) + "\n")
    print("Done ->", out)


if __name__ == "__main__":
    main()
