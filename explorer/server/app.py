"""FastAPI application for the Identity Tree Explorer."""

import os
import logging
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .database import ensure_schema
from .routes import stats, adis, accounts, keys, authorities, search, intelligence, network, lite

app = FastAPI(title="Identity Tree Explorer", version="1.0.0")


logger = logging.getLogger("explorer")


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    """Return a clean JSON 500 instead of leaking a stack trace to the client."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.on_event("startup")
def _migrate_on_startup() -> None:
    """Apply idempotent read-side schema migrations (indexes + denormalized adi_url)."""
    status = ensure_schema()
    if status.get("skipped"):
        print(f"[startup] schema migration skipped: {status['skipped']}")
    else:
        created = status.get("indexes_created") or []
        if created or status.get("adi_url_added"):
            print(f"[startup] schema migrated: indexes={created} adi_url_added={status.get('adi_url_added')}")
        else:
            print("[startup] schema up to date")


app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.middleware("http")
async def cache_control(request: Request, call_next):
    """Mark API GET responses cacheable — the DB is a static read-only snapshot."""
    response = await call_next(request)
    if request.method == "GET" and request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "public, max-age=300")
    return response


# Register API routes
app.include_router(stats.router)
app.include_router(adis.router)
app.include_router(accounts.router)
app.include_router(keys.router)
app.include_router(authorities.router)
app.include_router(search.router)
app.include_router(intelligence.router)
app.include_router(network.router)
app.include_router(lite.router)

# Serve built frontend
CLIENT_DIST = os.path.realpath(os.path.join(os.path.dirname(os.path.dirname(__file__)), "client", "dist"))
if os.path.isdir(CLIENT_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(CLIENT_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA index.html for all non-API routes."""
        index = os.path.join(CLIENT_DIST, "index.html")
        # Resolve the requested path and confirm it stays within the dist dir
        # (defends the catch-all against ../ path traversal).
        candidate = os.path.realpath(os.path.join(CLIENT_DIST, full_path))
        if (candidate == CLIENT_DIST or candidate.startswith(CLIENT_DIST + os.sep)) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(index)


def main():
    port = int(os.environ.get("PORT", "8050"))
    print(f"Starting Identity Tree Explorer on http://localhost:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
