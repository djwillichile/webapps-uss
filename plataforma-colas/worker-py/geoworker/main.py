"""Entry point: python -m geoworker.main"""

import asyncio
import json
import logging
import os
import signal
import socket
import sys
from datetime import datetime, timezone

from bullmq import Worker

from .config import Config
from .processor import create_processor


class JsonFormatter(logging.Formatter):
    """Same one-JSON-per-line format as the Node services, so logs can be merged."""

    def format(self, record):
        entry = {
            "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
            **getattr(record, "fields", {}),
        }
        return json.dumps(entry)


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
log = logging.getLogger("geoworker")
log.addHandler(handler)
log.setLevel(logging.INFO)


def info(msg, **fields):
    log.info(msg, extra={"fields": fields})


async def main():
    config = Config.from_env()
    for dataset_id, path in config.datasets.items():
        if not path.is_file():  # fail fast instead of failing every job later
            raise SystemExit(f"dataset {dataset_id!r} not found at {path}")

    name = f"{socket.gethostname()}-{os.getpid()}-py"
    connection = {"host": config.redis_host, "port": config.redis_port, "password": config.redis_password}
    worker = Worker(
        config.queue_name,
        create_processor(config),
        {"connection": connection, "concurrency": config.concurrency, "name": name},
    )

    worker.on("active", lambda job, *_: info("job started", jobId=job.id, worker=name))
    worker.on("completed", lambda job, *_: info("job completed", jobId=job.id, worker=name))
    worker.on("failed", lambda job, err, *_: log.warning(
        "job failed", extra={"fields": {"jobId": job.id, "worker": name, "err": str(err)}}))

    info("worker ready", worker=name, queue=config.queue_name, concurrency=config.concurrency,
         datasets=sorted(config.datasets))

    # Graceful shutdown: on SIGTERM/SIGINT wait for active jobs, then close connections.
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    info("shutting down worker", worker=name)
    await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
