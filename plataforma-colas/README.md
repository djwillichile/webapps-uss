# Plataforma de colas (API segura + Redis + workers)

Proyecto de aprendizaje: una API recibe trabajos pesados (análisis de tendencia de series climáticas), los deja en una **cola** (BullMQ sobre Redis) y responde de inmediato; uno o más **workers** los procesan a su ritmo. Así el servidor nunca se satura.

👉 **Lee primero [`GUIA.md`](GUIA.md)**: conceptos, arquitectura, seguridad, experimentos y ejercicios.

## Inicio rápido

```bash
npm install
npm run hash-key -- alice      # crea una API key y su hash
cp .env.example .env           # pega la línea API_KEYS
npm run api                    # terminal 1 (requiere Redis en localhost:6379)
npm run worker                 # terminal 2 (y 3, 4... para más workers)
```

O con Docker: `docker compose up --build --scale worker=3`.

## Endpoints

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| `GET` | `/health` | No | `200 { status: "ok" }` |
| `POST` | `/api/jobs` | `X-API-Key` | `202 { jobId, statusUrl }` · 400 · 401 · 413 · 429 · 503 |
| `GET` | `/api/jobs/:id` | `X-API-Key` | `200 { state, progress, result }` · 404 |

## Stack

Node.js 20+ · Express 5 · BullMQ · Redis 7 · zod · helmet · express-rate-limit · `node:test`
