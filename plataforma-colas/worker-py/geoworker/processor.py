"""Turns a BullMQ job into a call to the pure geospatial functions."""

import asyncio

from bullmq import UnrecoverableError

from .config import Config
from .zonal import UserInputError, geodesic_metrics, parse_polygon, zonal_stats

# Prefix understood by the API: messages starting with it are safe to show to the client.
PUBLIC_ERROR_PREFIX = "user: "


def validate_payload(data: dict, config: Config) -> tuple[str, dict]:
    """Defense in depth: the API already validated, but never trust what is in Redis."""
    if not isinstance(data, dict) or data.get("type") != "zonal-stats":
        raise UserInputError("unsupported job type for the geo queue")
    dataset_id = data.get("dataset")
    if dataset_id not in config.datasets:  # allowlist: the client never supplies a path
        raise UserInputError("unknown dataset")
    geometry = data.get("geometry")
    if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
        raise UserInputError("geometry must be a GeoJSON Polygon")
    return dataset_id, geometry


def compute(data: dict, config: Config) -> dict:
    """Synchronous, CPU/IO-bound work. Runs in a thread, see create_processor."""
    dataset_id, geometry = validate_payload(data, config)
    polygon = parse_polygon(geometry)
    metrics = geodesic_metrics(polygon)
    if metrics["area_km2"] > config.max_area_km2:
        raise UserInputError(f"polygon area exceeds the limit of {config.max_area_km2} km2")
    raster = zonal_stats(config.datasets[dataset_id], polygon, max_pixels=config.max_pixels)
    return {"dataset": dataset_id, "geometry": metrics, **raster}


def create_processor(config: Config):
    async def process(job, token):
        await job.updateProgress(10)
        try:
            # rasterio/numpy work would block the asyncio event loop, and with it the
            # lock renewal: the job would look "stalled" and another worker would take it.
            # Running it in a thread keeps the loop (and the lock) alive.
            result = await asyncio.to_thread(compute, job.data, config)
        except UserInputError as exc:
            # Bad input: retrying cannot fix it, and the reason is useful for the client.
            raise UnrecoverableError(f"{PUBLIC_ERROR_PREFIX}{exc}") from exc
        await job.updateProgress(100)
        return result

    return process
