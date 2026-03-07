"""CLI entry point for Identity Tree Mapper."""

import sys
import logging

from .config import build_parser, Config
from .api_client import ApiClient
from .database import Database
from .phase1_crawler import run_phase1
from .phase2_crawler import run_phase2


def setup_logging(level: str):
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def run_cli():
    parser = build_parser()
    args = parser.parse_args()
    config = Config.from_args(args)

    if args.gui:
        from .gui import run_gui
        run_gui(config)
        return

    setup_logging(config.log_level)
    log = logging.getLogger("identity_tree_mapper")

    log.info("Identity Tree Mapper starting")
    log.info("  Endpoint: %s", config.endpoint)
    log.info("  Source DB: %s", config.source_db)
    log.info("  Output DB: %s", config.output_db)
    log.info("  Phase: %s", config.phase)
    log.info("  Rate limit: %.1f req/s", config.rate_limit)
    log.info("  Resume: %s", config.resume)

    db = Database(config.output_db)
    api = ApiClient(config.endpoint, rate_limit=config.rate_limit, max_retries=config.max_retries)

    try:
        if config.phase in ("1", "all"):
            run_phase1(db, api, config.source_db, resume=config.resume)

        if config.phase in ("2", "all"):
            run_phase2(db, api)

        # Print final stats
        stats = db.get_stats()
        log.info("=== Final Statistics ===")
        for k, v in stats.items():
            if isinstance(v, dict):
                log.info("  %s: %s", k, v)
            else:
                log.info("  %s: %d", k, v)
    finally:
        db.close()

    log.info("Done. Output database: %s", config.output_db)


if __name__ == "__main__":
    run_cli()
