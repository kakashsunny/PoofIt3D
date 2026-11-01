import os
import hashlib
import json
import time
import qrcode
import io
import uuid
from datetime import datetime
from typing import List
from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse, Response, HTMLResponse
from app.core.config import settings
from app.services.progress_tracker import update_progress, get_progress, remove_progress
from app.models.image import ImageResponse, StyleOption, ModelOption
import asyncio

router = APIRouter()

@router.get("/health")
async def health_check():
    """Lightweight readiness check; does not load ML weights."""
    gpu = None
    try:
        import torch
        if torch.cuda.is_available():
            gpu = {"name": torch.cuda.get_device_name(0), "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)}
    except Exception:
        pass
    return {"status": "ok", "service": "poofit3d-api", "gpu": gpu}

AVAILABLE_STYLES = [
    StyleOption(id="photorealistic", name="Photorealistic", prompt_prefix="a photorealistic image of"),
    StyleOption(id="anime", name="Anime", prompt_prefix="an anime style drawing of"),
    StyleOption(id="oil_painting", name="Oil Painting", prompt_prefix="an oil painting of"),
    StyleOption(id="watercolor", name="Watercolor", prompt_prefix="a watercolor painting of"),
    StyleOption(id="sketch", name="Detailed Sketch", prompt_prefix="a detailed sketch of"),
]

def generate_sketch_hash(sketch_content: bytes, model_id: str, style_id: str, description: str) -> str:
    """Generate a unique hash for this generation request (includes timestamp for uniqueness)"""
    hasher = hashlib.sha256()
    hasher.update(sketch_content)
    hasher.update(model_id.encode('utf-8'))
    hasher.update(style_id.encode('utf-8'))
    hasher.update(description.encode('utf-8'))
    # Add current timestamp to ensure uniqueness for each generation
    hasher.update(str(time.time()).encode('utf-8'))
    return hasher.hexdigest()[:16]  # Use first 16 characters for shorter filenames

def save_generation_metadata(sketch_hash: str, metadata: dict):
    """Save generation metadata to JSON file"""
    metadata_path = os.path.join(settings.DATASET_METADATA_DIR, f"{sketch_hash}.json")
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

def generate_qr_code(url: str) -> bytes:
    """Generate QR code image as bytes"""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Convert to bytes
    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    img_byte_arr.seek(0)
    return img_byte_arr.getvalue()

@router.get("/styles", response_model=List[StyleOption])
async def get_styles():
    """Get available style options for image generation"""
    return AVAILABLE_STYLES

@router.get("/models", response_model=List[ModelOption])
async def get_models():
    """Get available model options for image generation"""
    models = []
    for model_id, model_data in settings.AVAILABLE_MODELS.items():
        description = f"Inference speed: {model_data['inference_speed']}"
        
        models.append(
            ModelOption(
                id=model_id,
                name=model_data["name"],
                description=description,
                huggingface_id=model_data["huggingface_id"],
                inference_speed=model_data["inference_speed"],
                recommended_for=model_data["recommended_for"]
            )
        )
    return models

@router.get("/progress/{generation_id}")
async def get_progress_stream(generation_id: str):
    """Stream progress updates using Server-Sent Events."""
    async def event_stream():
        yield f"data: {json.dumps({'type': 'connected', 'generation_id': generation_id})}\n\n"
        start_time = time.time()
        last_progress = None
        last_heartbeat = start_time

        while True:
            metadata_path = os.path.join(settings.DATASET_METADATA_DIR, f"{generation_id}.json")
            if os.path.exists(metadata_path):
                with open(metadata_path, "r", encoding="utf-8") as handle:
                    metadata = json.load(handle)
                if metadata.get("failed"):
                    yield f"data: {json.dumps({'type': 'error', 'generation_id': generation_id, 'message': metadata.get('error', 'Generation failed.')})}\n\n"
                    remove_progress(generation_id)
                    break
                if "file_info" in metadata:
                    yield f"data: {json.dumps({'type': 'completed', 'generation_id': generation_id})}\n\n"
                    remove_progress(generation_id)
                    break

            current_progress = get_progress(generation_id)
            if current_progress and current_progress != last_progress:
                if current_progress.get("eta_seconds") is None and current_progress["current_step"] > 0:
                    elapsed = max(time.time() - start_time, 0.1)
                    steps_per_second = current_progress["current_step"] / elapsed
                    remaining_steps = current_progress["total_steps"] - current_progress["current_step"]
                    current_progress["eta_seconds"] = (
                        int(remaining_steps / steps_per_second) if steps_per_second > 0 else None
                    )
                progress_data = {
                    "type": "progress",
                    "generation_id": generation_id,
                    **current_progress,
                }
                yield f"data: {json.dumps(progress_data)}\n\n"
                last_progress = current_progress.copy()

            if time.time() - last_heartbeat >= 15:
                yield ": keep-alive\n\n"
                last_heartbeat = time.time()

            await asyncio.sleep(0.5)
            # A cold model download can take substantially longer than five minutes.
            if time.time() - start_time > 3600:
                yield f"data: {json.dumps({'type': 'timeout', 'generation_id': generation_id})}\n\n"
                remove_progress(generation_id)
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/generate", response_model=ImageResponse)
async def generate_image(
    background_tasks: BackgroundTasks,
    sketch_file: UploadFile = File(...),
    style_id: str = Form(...),
    model_id: str = Form(None),
    description: str = Form(None),
):
    """Generate images from a sketch with the specified style and model"""
    
    style = next((s for s in AVAILABLE_STYLES if s.id == style_id), None)
    if not style:
        raise HTTPException(status_code=400, detail=f"Invalid style ID: {style_id}")
    
    if not model_id:
        model_id = settings.DEFAULT_MODEL_ID
    
    if model_id not in settings.AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Invalid model ID: {model_id}")
    description = (description or "").strip()
    if len(description) > 1000:
        raise HTTPException(status_code=422, detail="Description must be 1,000 characters or fewer.")
    
    model_info = settings.AVAILABLE_MODELS[model_id]
    
    # Validate the upload before persisting it.
    allowed_types = {"image/png", "image/jpeg", "image/webp"}
    if sketch_file.content_type and sketch_file.content_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPEG, or WEBP sketch.")
    sketch_content = await sketch_file.read()
    if not sketch_content:
        raise HTTPException(status_code=400, detail="The uploaded sketch is empty.")
    if len(sketch_content) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Sketch must be 12 MB or smaller.")
    try:
        from PIL import Image, ImageOps
        with Image.open(io.BytesIO(sketch_content)) as uploaded_image:
            uploaded_image.verify()
        with Image.open(io.BytesIO(sketch_content)) as uploaded_image:
            uploaded_image = ImageOps.exif_transpose(uploaded_image)
            if uploaded_image.width * uploaded_image.height > 30_000_000:
                raise HTTPException(status_code=413, detail="Sketch dimensions must be 30 megapixels or smaller.")
            rgba = uploaded_image.convert("RGBA")
            white = Image.new("RGBA", rgba.size, "white")
            white.alpha_composite(rgba)
            normalized = io.BytesIO()
            white.convert("RGB").save(normalized, format="PNG", optimize=True)
            sketch_content = normalized.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid image.") from exc

    # Generate hash-based ID
    sketch_hash = generate_sketch_hash(sketch_content, model_id, style_id, description or "")
    
    total_steps = model_info.get("config", {}).get("num_inference_steps", 20)
    update_progress(sketch_hash, 0, total_steps, "initializing")
    
    # Save sketch directly to dataset
    sketch_path = os.path.join(settings.DATASET_SKETCH_DIR, f"{sketch_hash}.png")
    with open(sketch_path, "wb") as f:
        f.write(sketch_content)
    
    try:
        if description:
            prompt = (f"{description}, {style.name} style, single object, centered, isolated on a plain "
                      "white background, studio lighting, best quality, extremely detailed")
        else:
            prompt = (
                "a clean product render of the sketched object, centered, "
                "single object, isolated on a plain light background, "
                f"{style.name} style, best quality, highly detailed"
            )
        
        negative_prompt = model_info.get("config", {}).get("default_negative_prompt", 
                                                        "longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality")        negative_prompt = f"{negative_prompt}, busy background, scenery, landscape, multiple objects, watermark, text"

        
        # Create initial metadata
        metadata = {
            "sketch_hash": sketch_hash,
            "prompt": prompt,
            "model_id": model_id,
            "style_id": style_id,
            "timestamp": datetime.now().isoformat(),
            "generation_params": {
                "num_inference_steps": model_info.get("config", {}).get("num_inference_steps", 20),
                "guidance_scale": model_info.get("config", {}).get("guidance_scale", 7.5),
                "negative_prompt": negative_prompt
            }
        }
        
        # Keep the heavy diffusion dependencies out of lightweight API startup.
        from app.services.generation import generate_image_from_sketch
        background_tasks.add_task(
            generate_image_from_sketch,
            sketch_path=sketch_path,
            prompt=prompt,
            model_id=model_id,
            negative_prompt=negative_prompt,
            sketch_hash=sketch_hash,
            metadata=metadata,
        )
        
        return ImageResponse(
            generation_id=sketch_hash,
            status="processing",
            message=f"Image generation started using {model_info['name']}. Connect to progress stream for real-time updates."
        )
    
    except Exception as e:
        remove_progress(sketch_hash)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status/{generation_id}", response_model=ImageResponse)
async def get_generation_status(generation_id: str):
    """Check the status of an image generation request"""
    # Check metadata to see if generation is complete
    metadata_path = os.path.join(settings.DATASET_METADATA_DIR, f"{generation_id}.json")
    
    if os.path.exists(metadata_path):
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        if metadata.get("failed"):
            return ImageResponse(
                generation_id=generation_id,
                status="failed",
                message=metadata.get("error", "Image generation failed.")
            )

        if "file_info" in metadata:
            # Generation completed
            result_count = metadata["file_info"]["result_count"]
            if result_count == 1:
                image_url = f"/api/images/{generation_id}"
            else:
                image_url = f"/api/images/{generation_id}_1"
                
            return ImageResponse(
                generation_id=generation_id,
                status="completed",
                message=f"Image generation completed. Generated {result_count} images.",
                image_url=image_url,
                quality=metadata.get("quality"),
                generation_seconds=metadata["file_info"].get("generation_time")
            )
    
    return ImageResponse(
        generation_id=generation_id,
        status="processing",
        message="Images are still being generated"
    )

@router.get("/images/{image_id}")
async def get_generated_image(image_id: str):
    """Get the generated image by ID"""
    # Handle both single image and multi-image cases
    import re
    if not re.fullmatch(r"[a-f0-9]{16}(_[1-9])?", image_id):
        raise HTTPException(status_code=400, detail="Invalid image id.")
    result_path = os.path.join(settings.DATASET_RESULT_DIR, f"{image_id}.png")
    
    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail="Generated image not found")
    
    # Add cache-busting headers to ensure fresh images are served
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    }
    
    return FileResponse(result_path, headers=headers)

@router.get("/share/{generation_id}")
async def get_share_qr_code(generation_id: str, image_index: int = 1):
    """Generate QR code for sharing the generated image"""
    # Check if generation exists
    metadata_path = os.path.join(settings.DATASET_METADATA_DIR, f"{generation_id}.json")
    
    if not os.path.exists(metadata_path):
        raise HTTPException(status_code=404, detail="Generation not found")
    
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    if "file_info" not in metadata:
        raise HTTPException(status_code=400, detail="Generation not completed yet")
    
    result_count = metadata["file_info"]["result_count"]
    
    # Validate image index
    if image_index < 1 or image_index > result_count:
        raise HTTPException(status_code=400, detail=f"Invalid image index. Valid range: 1-{result_count}")
    
    # Generate shareable URL
    base_url = settings.PUBLIC_URL or "http://localhost:3000"
    
    if result_count == 1:
        share_url = f"{base_url}/api/shared/{generation_id}"
    else:
        share_url = f"{base_url}/api/shared/{generation_id}/{image_index}"
    
    # Generate QR code
    qr_bytes = generate_qr_code(share_url)
    
    return Response(content=qr_bytes, media_type="image/png")

@router.get("/shared/{generation_id}")
@router.get("/shared/{generation_id}/{image_index}")
async def get_shared_image(generation_id: str, image_index: int = 1):
    """Public endpoint to view and download shared images"""
    # Check if generation exists
    metadata_path = os.path.join(settings.DATASET_METADATA_DIR, f"{generation_id}.json")
    
    if not os.path.exists(metadata_path):
        raise HTTPException(status_code=404, detail="Generation not found")
    
    with open(metadata_path, 'r') as f:
        metadata = json.load(f)
    
    if "file_info" not in metadata:
        raise HTTPException(status_code=400, detail="Generation not completed yet")
    
    result_count = metadata["file_info"]["result_count"]
    
    # Validate image index
    if image_index < 1 or image_index > result_count:
        raise HTTPException(status_code=400, detail=f"Invalid image index. Valid range: 1-{result_count}")
    
    # Construct the correct image URL
    if result_count == 1:
        image_url = f"/api/images/{generation_id}"
    else:
        image_url = f"/api/images/{generation_id}_{image_index}"
    
    # Return simple HTML page that displays the image
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Shared Image - PoofIt3D</title>
        <style>
            body {{
                margin: 0;
                padding: 20px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                background: #f5f5f5;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
            }}
            .container {{
                background: white;
                border-radius: 8px;
                padding: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                max-width: 800px;
                width: 100%;
            }}
            h1 {{
                margin: 0 0 20px 0;
                font-size: 24px;
                color: #333;
            }}
            img {{
                width: 100%;
                height: auto;
                border-radius: 4px;
                display: block;
            }}
            .download-btn {{
                display: inline-block;
                margin-top: 20px;
                padding: 12px 24px;
                background: #0A6A99;
                color: white;
                text-decoration: none;
                border-radius: 4px;
                font-weight: 500;
            }}
            .download-btn:hover {{
                background: #085580;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Generated Image</h1>
            <img src="{image_url}" alt="Generated image from sketch">
            <a href="{image_url}" download="generated-image.png" class="download-btn">Download Image</a>
        </div>
    </body>
    </html>
    """
    
    return HTMLResponse(content=html_content)

@router.post("/3d/generate")
async def generate_3d_model(generation_id: str = Form(...), image_index: int = Form(0)):
    """Reconstruct the approved generated image with InstantMesh and return a validated GLB."""
    import re
    from app.services.three_d import image_to_glb

    if not re.fullmatch(r"[a-f0-9]{16}", generation_id):
        raise HTTPException(status_code=400, detail="Invalid generation_id.")
    if image_index < 0 or image_index > 2:
        raise HTTPException(status_code=400, detail="image_index must be 0, 1, or 2.")
    metadata_path = os.path.join(settings.DATASET_METADATA_DIR, f"{generation_id}.json")
    if not os.path.isfile(metadata_path):
        raise HTTPException(status_code=404, detail="Generation not found.")
    with open(metadata_path, "r", encoding="utf-8") as handle:
        metadata = json.load(handle)
    count = int(metadata.get("file_info", {}).get("result_count", 0))
    if image_index >= count:
        raise HTTPException(status_code=404, detail="Requested image variation does not exist.")
    image_name = f"{generation_id}.png" if count == 1 else f"{generation_id}_{image_index + 1}.png"
    image_path = os.path.join(settings.DATASET_RESULT_DIR, image_name)
    if not os.path.isfile(image_path):
        raise HTTPException(status_code=404, detail="Selected generated image was not found on disk.")
    output_name = f"{generation_id}_{image_index + 1}_{uuid.uuid4().hex[:12]}.glb"
    output_path = os.path.join(settings.DATASET_RESULT_DIR, output_name)
    try:
        stats = await run_in_threadpool(image_to_glb, image_path, output_path)
        if not os.path.isfile(output_path) or os.path.getsize(output_path) < 20:
            raise RuntimeError("InstantMesh did not produce a valid GLB file.")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        if os.path.exists(output_path):
            os.remove(output_path)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        if os.path.exists(output_path):
            os.remove(output_path)
        raise HTTPException(status_code=500, detail=f"3D generation failed: {exc}") from exc
    return {"status": "completed", "model_url": f"/api/3d/files/{output_name}", "filename": output_name, **stats}


@router.get("/3d/files/{filename}")
async def download_3d_model(filename: str):
    import re
    if not re.fullmatch(r"[a-f0-9]{16}_[1-3]_[a-f0-9]{12}\.glb", filename):
        raise HTTPException(status_code=400, detail="Invalid model filename.")
    path = os.path.join(settings.DATASET_RESULT_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="3D model not found.")
    return FileResponse(path, media_type="model/gltf-binary", filename=filename)
