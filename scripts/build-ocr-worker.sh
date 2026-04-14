#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-ocr-worker"
WORKER_SCRIPT="$ROOT_DIR/src-tauri/resources/ocr-worker/rapidocr_worker.py"
BUILD_ROOT="$ROOT_DIR/.pyinstaller-rapidocr-worker"
DIST_DIR="$BUILD_ROOT/dist"
WORK_DIR="$BUILD_ROOT/build"
SPEC_DIR="$BUILD_ROOT/spec"
TARGET_DIR="$ROOT_DIR/src-tauri/binaries"
CONFIG_DIR="$BUILD_ROOT/config"

PYINSTALLER_CONFIG_DIR="$CONFIG_DIR" "$VENV_DIR/bin/python" -m PyInstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name rapidocr-worker \
  --distpath "$DIST_DIR" \
  --workpath "$WORK_DIR" \
  --specpath "$SPEC_DIR" \
  --collect-all rapidocr_onnxruntime \
  "$WORKER_SCRIPT"

mkdir -p "$TARGET_DIR"
cp "$DIST_DIR/rapidocr-worker" "$TARGET_DIR/rapidocr-worker"

echo "RapidOCR worker binary generated at: $TARGET_DIR/rapidocr-worker"
