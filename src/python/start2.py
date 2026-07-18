#!/usr/bin/env python3
"""Triangle mode fallback instance — same server, auto reuse_port=True."""
import os
os.environ["JEUMAPPA_INSTANCE"] = "2"
os.environ.setdefault("JEUMAPPA_REUSE_PORT", "1")
from jeumpa import main
main()
