"""Configuration for Identity Tree Mapper."""

import os
import argparse
from dataclasses import dataclass


@dataclass
class Config:
    endpoint: str = "https://mainnet.accumulatenetwork.io"
    source_db: str = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        "accumulate_adi_crawler", "identities.db"
    )
    output_db: str = os.path.join(os.path.dirname(__file__), "identity_tree.db")
    rate_limit: float = 8.0
    max_retries: int = 5
    batch_size: int = 50
    log_level: str = "INFO"
    phase: str = "all"
    resume: bool = True

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> "Config":
        return cls(
            endpoint=args.endpoint,
            source_db=args.source_db,
            output_db=args.output_db,
            rate_limit=args.rate_limit,
            max_retries=args.max_retries,
            batch_size=args.batch_size,
            log_level=args.log_level,
            phase=args.phase,
            resume=not args.fresh,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="identity-tree-mapper",
        description="Crawl and analyze Accumulate ADI directory trees.",
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("ACCUMULATE_ENDPOINT", "https://mainnet.accumulatenetwork.io"),
        help="Accumulate API endpoint",
    )
    parser.add_argument(
        "--source-db",
        default=os.environ.get("SOURCE_DB", Config.source_db),
        help="Path to the ADI crawler identities.db",
    )
    parser.add_argument(
        "--output-db",
        default=os.environ.get("OUTPUT_DB", os.path.join(os.path.dirname(__file__), "identity_tree.db")),
        help="Output database path",
    )
    parser.add_argument("--rate-limit", type=float, default=8.0, help="Requests per second")
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    parser.add_argument(
        "--phase", default="all", choices=["1", "2", "all"],
        help="Which phase to run: 1 (directory crawl), 2 (key page details), all (both)",
    )
    parser.add_argument("--fresh", action="store_true", help="Start fresh (ignore resume state)")
    parser.add_argument("--gui", action="store_true", help="Launch simple GUI")
    return parser
