"""Sketch-fidelity scoring for best-of-N selection.

Each generated variation is compared to the user's sketch by *silhouette IoU*:
  1. sketch  -> filled silhouette (stroke threshold, morphological close, fill external contours)
  2. output  -> foreground silhouette (border-colour distance + Otsu, largest blob, holes filled)
  3. both silhouettes are cropped to their bounding box, padded to a square and resized to 128x128,
     so the score is invariant to translation and uniform scale
  4. score = |A ∩ B| / |A ∪ B|
Pure NumPy/OpenCV: no extra model weights, runs on CPU in milliseconds.
"""
from __future__ import annotations

from typing import List, Optional

import cv2
import numpy as np
from PIL import Image

_GRID = 128


def _square_norm(mask: np.ndarray) -> Optional[np.ndarray]:
    ys, xs = np.where(mask > 0)
    if len(ys) < 20:
        return None
    crop = mask[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1]
    h, w = crop.shape
    side = max(h, w)
    canvas = np.zeros((side, side), np.uint8)
    canvas[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = crop
    return cv2.resize(canvas, (_GRID, _GRID), interpolation=cv2.INTER_AREA) > 127


def sketch_silhouette(image: Image.Image) -> Optional[np.ndarray]:
    gray = np.array(image.convert("L"))
    strokes = (gray < 200).astype(np.uint8) * 255
    k = max(3, int(max(gray.shape) * 0.012) | 1)
    closed = cv2.morphologyEx(strokes, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(closed)
    cv2.drawContours(filled, contours, -1, 255, thickness=cv2.FILLED)
    return _square_norm(filled)


def output_silhouette(image: Image.Image) -> Optional[np.ndarray]:
    rgb = np.array(image.convert("RGB")).astype(np.float32)
    h, w, _ = rgb.shape
    b = max(2, min(h, w) // 40)
    border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
                             rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.linalg.norm(rgb - bg, axis=2)
    dist8 = np.clip(dist / max(dist.max(), 1e-6) * 255, 0, 255).astype(np.uint8)
    dist8 = cv2.GaussianBlur(dist8, (5, 5), 0)
    _, fg = cv2.threshold(dist8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg)
    if n <= 1:
        return None
    keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    blob = (labels == keep).astype(np.uint8) * 255
    contours, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(blob)
    cv2.drawContours(filled, contours, -1, 255, thickness=cv2.FILLED)
    return _square_norm(filled)


def silhouette_iou(sketch: Image.Image, output: Image.Image) -> float:
    a, b = sketch_silhouette(sketch), output_silhouette(output)
    if a is None or b is None:
        return 0.0
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / union) if union else 0.0


def score_variations(sketch_path: str, images: List[Image.Image]) -> dict:
    """Return {'metric','scores','best_index'} (scores rounded to 3 dp)."""
    sketch = Image.open(sketch_path)
    scores = [round(silhouette_iou(sketch, img), 3) for img in images]
    best = int(np.argmax(scores)) if scores else 0
    return {"metric": "silhouette_iou", "scores": scores, "best_index": best}
