"""API client wrapper with rate limiting and retry logic."""

import sys
import time
import logging
from typing import Optional

sys.path.insert(0, r"C:\Accumulate_Stuff\opendlt-python-v2v3-sdk\unified\src")

from accumulate_client import Accumulate
from accumulate_client.v3.options import RangeOptions

log = logging.getLogger(__name__)

DIRECTORY_PAGE_SIZE = 100


class ApiClient:
    """Wraps AccumulateV3Client with rate limiting and retry."""

    def __init__(self, endpoint: str, rate_limit: float = 8.0, max_retries: int = 5):
        self.acc = Accumulate(endpoint)
        self.client = self.acc.v3
        self.max_retries = max_retries
        self._min_interval = 1.0 / rate_limit if rate_limit > 0 else 0
        self._last_request_time = 0.0
        self._request_count = 0

    @property
    def request_count(self) -> int:
        return self._request_count

    def _rate_limit_wait(self):
        if self._min_interval <= 0:
            return
        now = time.monotonic()
        elapsed = now - self._last_request_time
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_time = time.monotonic()

    def _call_with_retry(self, fn, *args, **kwargs):
        last_error = None
        for attempt in range(self.max_retries):
            self._rate_limit_wait()
            try:
                self._request_count += 1
                return fn(*args, **kwargs)
            except Exception as e:
                last_error = e
                delay = min(2 ** attempt, 60)
                log.warning(
                    "API call failed (attempt %d/%d): %s — retrying in %ds",
                    attempt + 1, self.max_retries, e, delay,
                )
                time.sleep(delay)
        raise last_error

    def query_account(self, url: str) -> Optional[dict]:
        """Query an account by URL. Returns None on failure."""
        try:
            return self._call_with_retry(self.client.query_account, url)
        except Exception as e:
            log.error("Failed to query account %s: %s", url, e)
            return None

    def query_directory_all(self, url: str) -> list[str]:
        """Query all directory entries for an ADI/key book, handling pagination."""
        all_entries = []
        start = 0
        while True:
            try:
                result = self._call_with_retry(
                    self.client.query_directory,
                    url,
                    range_options=RangeOptions(start=start, count=DIRECTORY_PAGE_SIZE),
                )
            except Exception as e:
                log.error("Failed to query directory for %s at offset %d: %s", url, start, e)
                break

            records = result.get("records", [])
            total = result.get("total", 0)

            for rec in records:
                value = rec.get("value")
                if value:
                    all_entries.append(value)

            start += len(records)
            if start >= total or not records:
                break

        return all_entries
