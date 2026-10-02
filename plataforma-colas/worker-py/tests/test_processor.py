import asyncio

import pytest
from bullmq import UnrecoverableError

from geoworker.config import Config, parse_datasets
from geoworker.processor import compute, create_processor
from geoworker.zonal import UserInputError
from tests.conftest import rect


class FakeJob:
    def __init__(self, data):
        self.data = data
        self.progress = []

    async def updateProgress(self, value):
        self.progress.append(value)


def job_data(**overrides):
    return {"type": "zonal-stats", "dataset": "grid", "geometry": rect(-70.8, -33.2, -70.5, -33.0), **overrides}


def test_compute_returns_geometry_and_raster_stats(config):
    result = compute(job_data(), config)
    assert result["dataset"] == "grid"
    assert result["geometry"]["area_km2"] > 0
    assert result["stats"]["mean"] == pytest.approx(3)


@pytest.mark.parametrize("data, message", [
    (job_data(type="series-stats"), "unsupported job type"),
    (job_data(dataset="../../etc/passwd"), "unknown dataset"),
    (job_data(geometry={"type": "Point", "coordinates": [0, 0]}), "Polygon"),
])
def test_rejects_tampered_payloads(config, data, message):
    with pytest.raises(UserInputError, match=message):
        compute(data, config)


def test_enforces_area_limit(grid_raster):
    small_limit = Config.from_env({"DATASETS": f"grid={grid_raster}", "GEO_MAX_AREA_KM2": "100"})
    with pytest.raises(UserInputError, match="area exceeds"):
        compute(job_data(), small_limit)


def test_processor_reports_progress_and_marks_user_errors_as_public(config):
    process = create_processor(config)
    job = FakeJob(job_data())
    result = asyncio.run(process(job, "token"))
    assert job.progress == [10, 100]
    assert result["pixels_valid"] == 6

    with pytest.raises(UnrecoverableError, match="^user: polygon does not intersect"):
        asyncio.run(process(FakeJob(job_data(geometry=rect(10, 10, 10.1, 10.1))), "token"))


def test_config_validation():
    with pytest.raises(ValueError, match="DATASETS"):
        parse_datasets("no-equals-sign")
    with pytest.raises(ValueError, match="REDIS_PASSWORD"):
        Config.from_env({"NODE_ENV": "production"})
