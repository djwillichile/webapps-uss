import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from geoworker.config import Config


def write_raster(path, data, *, crs="EPSG:4326", west=-71.0, north=-33.0, res=0.1, nodata=-9999.0):
    with rasterio.open(
        path, "w", driver="GTiff", width=data.shape[1], height=data.shape[0], count=1,
        dtype="float32", crs=crs, transform=from_origin(west, north, res, res), nodata=nodata,
    ) as dst:
        dst.write(data.astype("float32"), 1)
    return path


@pytest.fixture
def grid_raster(tmp_path):
    """10x10 raster, 0.1 deg pixels from (-71, -33); each pixel value = its column index."""
    data = np.tile(np.arange(10, dtype="float32"), (10, 1))
    data[9, 9] = -9999.0  # one nodata pixel
    return write_raster(tmp_path / "grid.tif", data)


def rect(west, south, east, north):
    return {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}


@pytest.fixture
def config(grid_raster):
    return Config.from_env({"DATASETS": f"grid={grid_raster}", "GEO_MAX_AREA_KM2": "5000"})
