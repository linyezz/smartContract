#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


def decode_image(data_url: str) -> Image.Image:
    if not data_url:
        raise ValueError("empty image payload")

    _, _, encoded = data_url.partition(",")
    payload = encoded if encoded else data_url
    binary = base64.b64decode(payload)
    image = Image.open(io.BytesIO(binary))
    return image.convert("RGB")


def normalize_result(page_number: int, raw_result) -> dict:
    entries = raw_result or []
    lines = []

    for item in entries:
        if not item or len(item) < 3:
            continue
        points = item[0] or []
        text = str(item[1] or "").strip()
        score = item[2]
        if not text:
            continue
        xs = [float(point[0]) for point in points if point and len(point) >= 2]
        ys = [float(point[1]) for point in points if point and len(point) >= 2]
        if not xs or not ys:
            continue
        lines.append({
            "text": text,
            "score": float(score) if score is not None else None,
            "left": min(xs),
            "top": min(ys),
            "right": max(xs),
            "bottom": max(ys),
        })

    avg_score = None
    if lines:
        valid_scores = [line["score"] for line in lines if line["score"] is not None]
        if valid_scores:
            avg_score = sum(valid_scores) / len(valid_scores)

    return {
        "pageNumber": page_number,
        "text": "\n".join(line["text"] for line in lines),
        "lineCount": len(lines),
        "avgScore": avg_score,
        "lines": lines,
    }


def run_worker(input_path: Path, output_path: Path) -> None:
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    pages = payload.get("pages") or []

    engine = RapidOCR()
    results = []

    for page in pages:
        page_number = int(page.get("pageNumber") or 0)
        image = decode_image(page.get("imageDataUrl") or "")
        inference = engine(np.array(image))
        raw_result = inference[0] if isinstance(inference, tuple) else inference
        normalized_page = normalize_result(page_number, raw_result)
        normalized_page["imageWidth"] = int(page.get("width") or image.width)
        normalized_page["imageHeight"] = int(page.get("height") or image.height)
        results.append(normalized_page)

    response = {
        "tool": "rapidocr",
        "engine": "rapidocr_onnxruntime",
        "pages": results,
    }
    output_path.write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local RapidOCR worker")
    parser.add_argument("--input", required=True, help="Input JSON file path")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_worker(Path(args.input), Path(args.output))


if __name__ == "__main__":
    main()
