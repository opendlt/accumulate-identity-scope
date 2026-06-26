"""Standalone, idempotent schema migration for the explorer database.

Run once after (re)building the crawler database to add the read-side indexes
and the denormalized ``account_authorities.adi_url`` column the analytics
endpoints depend on. The API server also runs this automatically at startup,
so this script is mainly for build pipelines / Docker images.

Usage:
    python -m server.migrate
    EXPLORER_DB_PATH=/data/identity.db python -m server.migrate
"""

from .database import DB_PATH, ensure_schema


def main() -> None:
    print(f"Migrating database: {DB_PATH}")
    status = ensure_schema()
    if status.get("skipped"):
        print(f"  WARNING: {status['skipped']}")
    else:
        created = status.get("indexes_created") or []
        print(f"  indexes created: {created if created else 'none (already present)'}")
        if status.get("adi_url_added"):
            print("  added column account_authorities.adi_url")
        if status.get("adi_url_populated"):
            print(f"  populated adi_url for {status['adi_url_populated']} distinct account URLs")
        print("  done.")


if __name__ == "__main__":
    main()
