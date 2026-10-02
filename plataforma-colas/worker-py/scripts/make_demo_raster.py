"""Create a SYNTHETIC demo DEM (GeoTIFF, EPSG:4326) roughly over Santiago and the Andes.

The values are invented (an eastward ramp plus hills): useful to test the pipeline,
NOT for analysis. Replace it with a real DEM (SRTM, Copernicus GLO-30) via DATASETS.

Usage: python scripts/make_demo_raster.py [output.tif]
"""

import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

WEST, NORTH = -71.0, -33.0  # upper-left corner
RES = 0.002                 # degrees (~200 m)
WIDTH, HEIGHT = 750, 500    # covers lon -71.0..-69.5, lat -34.0..-33.0
NODATA = -9999.0


def make_dem() -> np.ndarray:
    lon = WEST + RES * (np.arange(WIDTH) + 0.5)
    lat = NORTH - RES * (np.arange(HEIGHT) + 0.5)
    lon2d, lat2d = np.meshgrid(lon, lat)
    ramp = 450 + 3600 * np.clip((lon2d + 70.9) / 1.2, 0, 1) ** 1.6   # valley -> Andes
    hills = 180 * np.sin(lon2d * 40) * np.cos(lat2d * 35)
    dem = (ramp + hills).astype("float32")
    dem[:20, :20] = NODATA  # a small nodata patch, to exercise masking
    return dem


def main(out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        "driver": "GTiff", "width": WIDTH, "height": HEIGHT, "count": 1, "dtype": "float32",
        "crs": "EPSG:4326", "transform": from_origin(WEST, NORTH, RES, RES), "nodata": NODATA,
        "compress": "deflate", "tiled": True, "blockxsize": 256, "blockysize": 256,
    }
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(make_dem(), 1)
        dst.set_band_unit(1, "m")
        dst.update_tags(description="SYNTHETIC demo DEM - not real elevation data")
    print(f"wrote {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data" / "dem_demo.tif")
