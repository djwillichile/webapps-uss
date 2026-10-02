"""Pure geospatial computations (no Redis, no queue): easy to test and reuse."""

import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Geod
from rasterio.features import geometry_mask
from rasterio.warp import transform_geom
from rasterio.windows import Window, from_bounds
from shapely.geometry import Polygon, box, mapping, shape
from shapely.validation import explain_validity

GEOD = Geod(ellps="WGS84")


class UserInputError(ValueError):
    """Invalid request: retrying will not help and the message is safe to show to the client."""


def parse_polygon(geojson: dict) -> Polygon:
    try:
        geom = shape(geojson)
    except Exception as exc:  # shapely raises several types for malformed input
        raise UserInputError("geometry is not valid GeoJSON") from exc
    if geom.geom_type != "Polygon" or geom.is_empty:
        raise UserInputError("geometry must be a non-empty Polygon")
    if not geom.is_valid:
        # e.g. "Self-intersection[-70.5 -33.4]"
        raise UserInputError(f"invalid polygon: {explain_validity(geom)}")
    return geom


def geodesic_metrics(polygon: Polygon) -> dict:
    """Area/perimeter on the WGS84 ellipsoid: never compute areas in square degrees."""
    area_m2, perimeter_m = GEOD.geometry_area_perimeter(polygon)
    minx, miny, maxx, maxy = polygon.bounds
    centroid = polygon.centroid
    return {
        "area_km2": abs(area_m2) / 1e6,  # sign depends on ring orientation
        "perimeter_km": perimeter_m / 1e3,
        "centroid": [round(centroid.x, 6), round(centroid.y, 6)],
        "bbox": [minx, miny, maxx, maxy],
    }


def zonal_stats(raster_path: Path, polygon: Polygon, *, max_pixels: int, all_touched: bool = False) -> dict:
    """Statistics of the raster pixels whose centers fall inside the polygon (WGS84)."""
    with rasterio.open(raster_path) as src:
        # Bring the polygon to the raster CRS instead of reprojecting the raster.
        geom = mapping(polygon) if src.crs.to_epsg() == 4326 else transform_geom("EPSG:4326", src.crs, mapping(polygon))
        geom_shape = shape(geom)

        if not geom_shape.intersects(box(*src.bounds)):
            raise UserInputError("polygon does not intersect the dataset extent")

        # Read only the window covering the polygon, never the whole raster.
        # Floor the start and ceil the end so a polygon smaller than a pixel still gets
        # a non-empty window (plain rounding can produce width 0).
        raw = from_bounds(*geom_shape.bounds, transform=src.transform)
        col0, row0 = math.floor(raw.col_off), math.floor(raw.row_off)
        col1, row1 = math.ceil(raw.col_off + raw.width), math.ceil(raw.row_off + raw.height)
        window = Window(col0, row0, max(col1 - col0, 1), max(row1 - row0, 1)).intersection(
            Window(0, 0, src.width, src.height)
        )
        if window.width * window.height > max_pixels:
            raise UserInputError("polygon covers too many pixels for this dataset")

        data = src.read(1, window=window, masked=True)
        transform = src.window_transform(window)
        outside = geometry_mask([geom], out_shape=data.shape, transform=transform, all_touched=all_touched)
        values = np.ma.array(data, mask=np.ma.getmaskarray(data) | outside)

        inside_total = int((~outside).sum())
        valid = values.compressed().astype("float64")
        res_x, res_y = src.res
        result = {
            "crs": src.crs.to_string(),
            "pixel_size": [res_x, res_y],
            "units": src.units[0] if src.units and src.units[0] else None,
            "pixels_inside": inside_total,
            "pixels_valid": int(valid.size),
            "pixels_nodata": inside_total - int(valid.size),
        }

    if valid.size == 0:
        raise UserInputError("no valid pixels inside the polygon (too small or only nodata)")

    p10, p50, p90 = np.percentile(valid, [10, 50, 90])
    result["stats"] = {
        "min": float(valid.min()),
        "max": float(valid.max()),
        "mean": float(valid.mean()),
        "std": float(valid.std(ddof=1)) if valid.size > 1 else 0.0,
        "p10": float(p10),
        "p50": float(p50),
        "p90": float(p90),
    }
    return result
