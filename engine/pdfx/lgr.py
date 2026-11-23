"""Import access to the vendored literature-guide-read scripts (vendor/lgr/scripts)."""
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parent / "vendor" / "lgr"
SCRIPTS = VENDOR / "scripts"
REFERENCES = VENDOR / "references"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import common  # noqa: E402,F401
import check  # noqa: E402,F401
