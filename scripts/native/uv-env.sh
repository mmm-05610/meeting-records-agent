#!/bin/bash
# Cache locations for uv/pnpm/HF so an install is self-contained in the checkout.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT
export UV_CACHE_DIR="$ROOT/.local/uv-cache"
export UV_PYTHON_INSTALL_DIR="$ROOT/.local/uv-python"
export XDG_CACHE_HOME="$ROOT/.local/cache"
export XDG_DATA_HOME="$ROOT/.local/share"
export HF_HOME="$ROOT/.local/hf"
export PIP_CACHE_DIR="$ROOT/.local/pip-cache"
export PATH="$ROOT/.local/pg17/bin:$PATH"
