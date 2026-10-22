#!/usr/bin/env python3
"""Render the R2R TOML template with environment values (container startup).

The template keeps secrets out of git; the container receives them through env.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

TEMPLATE = Path(os.environ.get("R2R_CONFIG_TEMPLATE", "/app/config-template/meeting_records.toml.template"))
TARGET = Path(os.environ.get("R2R_CONFIG_PATH", "/app/config/meeting_records.toml"))

PLACEHOLDER = re.compile(r"\$\{([A-Z0-9_]+)\}")


def render(text: str) -> str:
    missing: list[str] = []

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        value = os.environ.get(name)
        if value is None or value == "":
            missing.append(name)
            return ""
        return value

    rendered = PLACEHOLDER.sub(replace, text)
    if missing:
        raise SystemExit(f"missing environment values for R2R config: {sorted(set(missing))}")
    return rendered


def main() -> int:
    if not TEMPLATE.exists():
        raise SystemExit(f"config template not found: {TEMPLATE}")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(render(TEMPLATE.read_text(encoding="utf-8")), encoding="utf-8")
    print(f"rendered R2R config -> {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
