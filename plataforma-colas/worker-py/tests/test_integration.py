"""Real Redis: Python Queue -> Python Worker. Skipped if Redis is not reachable."""

import asyncio
import os
import uuid

import pytest
import redis
from bullmq import Queue, Worker

from geoworker.processor import create_processor
from tests.conftest import rect

PORT = int(os.environ.get("TEST_REDIS_PORT", "6379"))


def redis_available():
    try:
        return redis.Redis(port=PORT, socket_connect_timeout=0.5).ping()
    except redis.exceptions.ConnectionError:
        return False


pytestmark = pytest.mark.skipif(not redis_available(), reason="Redis not available")


async def wait_finished(queue, job_id):
    for _ in range(200):
        job = await queue.getJob(job_id)
        state = await job.getState()
        if state in ("completed", "failed"):
            return state, job
        await asyncio.sleep(0.05)
    raise TimeoutError(job_id)


def test_job_flows_through_redis(config):
    async def scenario():
        name = f"it-geo-{uuid.uuid4().hex[:8]}"
        connection = {"host": "127.0.0.1", "port": PORT}
        queue = Queue(name, {"connection": connection})
        worker = Worker(name, create_processor(config), {"connection": connection})
        try:
            ok = await queue.add("zonal-stats", {"type": "zonal-stats", "dataset": "grid",
                                                 "geometry": rect(-70.8, -33.2, -70.5, -33.0)},
                                 {"jobId": str(uuid.uuid4()), "attempts": 3})
            bad = await queue.add("zonal-stats", {"type": "zonal-stats", "dataset": "grid",
                                                  "geometry": rect(10, 10, 10.1, 10.1)},
                                  {"jobId": str(uuid.uuid4()), "attempts": 3})
            state, job = await wait_finished(queue, ok.id)
            assert state == "completed"
            assert job.returnvalue["stats"]["mean"] == pytest.approx(3)

            state, job = await wait_finished(queue, bad.id)
            assert state == "failed"
            assert job.attemptsMade == 1  # UnrecoverableError: no retries
            assert job.failedReason.startswith("user: ")
        finally:
            await worker.close()
            await queue.obliterate(force=True)
            await queue.close()

    asyncio.run(scenario())
