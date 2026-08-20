from __future__ import annotations

from datetime import datetime, timedelta, timezone


UTC_TIMEZONE = timezone.utc
KOREA_TIMEZONE = timezone(timedelta(hours=9), name="Asia/Seoul")


def utc_now() -> datetime:
    """Return a timezone-aware instant for database persistence."""
    return datetime.now(UTC_TIMEZONE)


def korea_now() -> datetime:
    """Return the current wall-clock time in Korea."""
    return datetime.now(KOREA_TIMEZONE)


def as_korea(value: datetime) -> datetime:
    """Convert a stored instant to Korea time.

    SQLite drops timezone information from DateTime columns, while its
    CURRENT_TIMESTAMP is UTC. Treat naive database values as UTC so local
    development and PostgreSQL use the same Korean calendar date.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC_TIMEZONE)
    return value.astimezone(KOREA_TIMEZONE)
