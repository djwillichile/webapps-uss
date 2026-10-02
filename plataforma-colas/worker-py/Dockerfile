FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# rasterio/pyproj/shapely wheels bundle GDAL/PROJ/GEOS: no system packages needed.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY geoworker ./geoworker
COPY scripts ./scripts
# Bake the synthetic demo DEM into the image; real data is mounted read-only instead.
RUN python scripts/make_demo_raster.py /app/data/dem_demo.tif

RUN useradd --create-home --uid 10001 worker
USER worker

CMD ["python", "-m", "geoworker.main"]
