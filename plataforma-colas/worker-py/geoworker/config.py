"""Configuration from environment variables, validated at startup (fail fast)."""

import os
import re
from dataclasses import dataclass
from pathlib import Path

DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _int(env: dict, name: str, default: int, lo: int, hi: int) -> int:
    raw = env.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if not lo <= value <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi}")
    return value


def parse_datasets(raw: str) -> dict[str, Path]:
    """Parse "id=path,id2=path2". IDs are what clients send; paths stay server-side."""
    datasets: dict[str, Path] = {}
    for entry in filter(None, (e.strip() for e in raw.split(","))):
        dataset_id, sep, path = entry.partition("=")
        if not sep or not re.fullmatch(r"[a-z0-9-]+", dataset_id) or not path:
            raise ValueError(f"invalid DATASETS entry {entry!r} (expected id=path)")
        datasets[dataset_id] = Path(path)
    if not datasets:
        raise ValueError("DATASETS must define at least one dataset")
    return datasets


@dataclass(frozen=True)
class Config:
    redis_host: str
    redis_port: int
    redis_password: str | None
    queue_name: str
    concurrency: int
    datasets: dict[str, Path]
    max_area_km2: int
    max_pixels: int

    @classmethod
    def from_env(cls, env: dict | None = None) -> "Config":
        env = dict(os.environ if env is None else env)
        queue_name = env.get("GEO_QUEUE_NAME", "geo")
        if not re.fullmatch(r"[a-z0-9-]+", queue_name):
            raise ValueError("GEO_QUEUE_NAME must match [a-z0-9-]+")
        password = env.get("REDIS_PASSWORD") or None
        if env.get("NODE_ENV") == "production" and not password:
            raise ValueError("REDIS_PASSWORD is required in production")
        return cls(
            redis_host=env.get("REDIS_HOST", "127.0.0.1"),
            redis_port=_int(env, "REDIS_PORT", 6379, 1, 65535),
            redis_password=password,
            queue_name=queue_name,
            concurrency=_int(env, "GEO_WORKER_CONCURRENCY", 2, 1, 32),
            datasets=parse_datasets(env.get("DATASETS", f"dem-demo={DEFAULT_DATA_DIR / 'dem_demo.tif'}")),
            max_area_km2=_int(env, "GEO_MAX_AREA_KM2", 5000, 1, 10_000_000),
            max_pixels=_int(env, "GEO_MAX_PIXELS", 10_000_000, 1, 500_000_000),
        )
