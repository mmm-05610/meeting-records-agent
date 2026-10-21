# Upstream source

- Project: R2R
- URL: https://github.com/SciPhi-AI/R2R
- Pinned commit: 9c5a94d151f90876bd7eb860f300a8fd662dc481 (package version 3.6.6)
- Imported: 2026-10-22 (`git init` + `git fetch --depth 1 <sha>` + checkout, nested `.git` removed)
- License: MIT (`apps/rag/LICENSE.md` unchanged)
- Local modifications: `py/pyproject.toml` dependency patches (google-genai, mistralai) and product configuration under `deployment/r2r/`; see `docs/upstream/patches.md`.
