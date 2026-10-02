import numpy as np
import pytest

from geoworker.zonal import UserInputError, geodesic_metrics, parse_polygon, zonal_stats
from tests.conftest import rect, write_raster


def test_pixel_centers_inside_polygon_are_counted(grid_raster):
    # Columns 2..4 (centers -70.75, -70.65, -70.55) x first two rows -> values 2, 3, 4 twice.
    poly = parse_polygon(rect(-70.8, -33.2, -70.5, -33.0))
    r = zonal_stats(grid_raster, poly, max_pixels=1000)
    assert r["pixels_valid"] == 6
    assert r["stats"]["min"] == 2 and r["stats"]["max"] == 4
    assert r["stats"]["mean"] == pytest.approx(3)
    assert r["stats"]["p50"] == pytest.approx(3)


def test_nodata_pixels_are_excluded(grid_raster):
    poly = parse_polygon(rect(-70.2, -34.0, -70.0, -33.8))  # bottom-right 2x2 block, one is nodata
    r = zonal_stats(grid_raster, poly, max_pixels=1000)
    assert r["pixels_inside"] == 4
    assert r["pixels_valid"] == 3
    assert r["pixels_nodata"] == 1


def test_geodesic_area_is_in_km2_not_square_degrees():
    m = geodesic_metrics(parse_polygon(rect(-70.8, -33.2, -70.5, -33.0)))
    # ~0.3 deg lon x 0.2 deg lat at 33 S is roughly 28 km x 22 km.
    assert 600 < m["area_km2"] < 640
    assert m["centroid"] == [-70.65, -33.1]


def test_area_does_not_depend_on_ring_orientation():
    ccw = rect(-70.8, -33.2, -70.5, -33.0)
    cw = {"type": "Polygon", "coordinates": [ccw["coordinates"][0][::-1]]}
    assert geodesic_metrics(parse_polygon(cw))["area_km2"] == pytest.approx(geodesic_metrics(parse_polygon(ccw))["area_km2"])


def test_rejects_self_intersecting_polygon():
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}
    with pytest.raises(UserInputError, match="Self-intersection"):
        parse_polygon(bowtie)


def test_rejects_polygon_outside_dataset(grid_raster):
    with pytest.raises(UserInputError, match="does not intersect"):
        zonal_stats(grid_raster, parse_polygon(rect(10, 10, 10.1, 10.1)), max_pixels=1000)


def test_rejects_polygon_smaller_than_a_pixel_center(grid_raster):
    tiny = parse_polygon(rect(-70.99, -33.01, -70.98, -33.0))  # does not contain any pixel center
    with pytest.raises(UserInputError, match="no valid pixels"):
        zonal_stats(grid_raster, tiny, max_pixels=1000)


def test_enforces_pixel_budget(grid_raster):
    with pytest.raises(UserInputError, match="too many pixels"):
        zonal_stats(grid_raster, parse_polygon(rect(-71, -34, -70, -33)), max_pixels=50)


def test_projected_raster_polygon_is_reprojected(tmp_path):
    # UTM 19S raster around Santiago (1 km pixels, constant value 7).
    path = write_raster(tmp_path / "utm.tif", np.full((50, 50), 7.0), crs="EPSG:32719",
                        west=330_000, north=6_310_000, res=1000)
    r = zonal_stats(path, parse_polygon(rect(-70.7, -33.5, -70.6, -33.4)), max_pixels=10_000)
    assert r["crs"] == "EPSG:32719"
    assert r["stats"]["mean"] == 7
    assert 80 < r["pixels_valid"] < 120  # ~9.3 km x 11.1 km of 1 km pixels
