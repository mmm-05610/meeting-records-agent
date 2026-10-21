# Upstream source

- Project: R2R-Application
- URL: https://github.com/SciPhi-AI/R2R-Application
- Pinned commit: c4612ab48af002d4cd078659d11db88ed61d53b8
- Imported: 2026-10-22 (`git init` + `git fetch --depth 1 <sha>` + checkout, nested `.git` removed)
- License: MIT (`apps/web/LICENSE` unchanged)
- Chat integration reference: CopilotKit `examples/integrations/langgraph-fastapi` at abc6807f35865e043c498398e3080f137ddbdad9 (local reference clone under `upstream/reference/`, not committed). AG-UI transport uses the official `@ag-ui/client` package.
- Local modifications: same-origin API routes, meeting UI, AG-UI chat client; see `docs/upstream/patches.md`.
