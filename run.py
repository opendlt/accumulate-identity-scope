"""Launcher script — run from inside the identity_tree_mapper directory."""

import sys
import os

# Add the parent directory to sys.path so `identity_tree_mapper` is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from identity_tree_mapper.__main__ import run_cli

if __name__ == "__main__":
    run_cli()
