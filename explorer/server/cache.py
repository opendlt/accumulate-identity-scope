"""Tiny thread-safe in-process cache for read-only aggregation endpoints.

The explorer serves a static SQLite snapshot, so the expensive aggregation
endpoints (topology, intelligence, network summary, authority flows, the
authority graph, and stats) produce identical results until the database file
is re-crawled. Memoizing them turns repeated multi-second requests into ~0ms
lookups and protects the request threadpool from being exhausted by a few
concurrent heavy queries.
"""

import threading
import time
from functools import wraps

_DEFAULT_TTL = 600.0  # seconds; the DB is a static snapshot, so this is conservative.

_lock = threading.Lock()
_store: dict[str, tuple[float, object]] = {}


def _make_key(name: str, args: tuple, kwargs: dict) -> str:
    return name + "|" + repr(args) + "|" + repr(sorted(kwargs.items()))


def cached(ttl: float = _DEFAULT_TTL):
    """Memoize a sync endpoint's return value keyed on its arguments.

    Results are cached for ``ttl`` seconds. Thread-safe; the cached value is the
    already-built response dict, so concurrent callers share one computation.
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            key = _make_key(fn.__qualname__, args, kwargs)
            now = time.monotonic()
            with _lock:
                hit = _store.get(key)
                if hit is not None and hit[0] > now:
                    return hit[1]
            # Compute outside the lock so a slow query doesn't block other keys.
            value = fn(*args, **kwargs)
            with _lock:
                _store[key] = (now + ttl, value)
            return value

        wrapper.cache_clear = lambda: _clear()  # type: ignore[attr-defined]
        return wrapper

    return decorator


def _clear() -> None:
    with _lock:
        _store.clear()


def clear_all() -> None:
    """Drop every cached entry (used after a schema migration / data refresh)."""
    _clear()
