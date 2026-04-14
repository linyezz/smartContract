#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-ocr-worker"
REQUIREMENTS_FILE="$ROOT_DIR/src-tauri/resources/ocr-worker/requirements.txt"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$REQUIREMENTS_FILE"

echo "RapidOCR worker environment is ready: $VENV_DIR"
