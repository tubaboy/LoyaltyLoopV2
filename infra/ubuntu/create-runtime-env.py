#!/usr/bin/env python3
"""Create private random credentials for the isolated Ubuntu test stack."""

from pathlib import Path
import secrets
import sys


target = Path(sys.argv[1] if len(sys.argv) > 1 else ".env.ubuntu")
if target.exists():
    raise SystemExit(f"Refusing to overwrite existing credential file: {target}")

contents = "\n".join(
    [
        f"POSTGRES_PASSWORD={secrets.token_urlsafe(36)}",
        "",
    ]
)
target.write_text(contents, encoding="utf-8")
target.chmod(0o600)
