#!/usr/bin/env python3
"""Triangle mode fallback — same server, reuse_port=True, instance=2."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src", "python"))
os.environ["JEUMAPPA_INSTANCE"] = "2"
os.environ.setdefault("JEUMAPPA_REUSE_PORT", "1")
from jeumpa import main
main()
