"""Launcher for the Identity Tree Explorer."""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault(
    "EXPLORER_DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "identity_tree_complete.db"),
)

from explorer.server.app import main

if __name__ == "__main__":
    main()
