"""FastAPI application for the Identity Tree Explorer."""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .routes import stats, adis, accounts, keys, authorities, search, intelligence, network

app = FastAPI(title="Identity Tree Explorer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(stats.router)
app.include_router(adis.router)
app.include_router(accounts.router)
app.include_router(keys.router)
app.include_router(authorities.router)
app.include_router(search.router)
app.include_router(intelligence.router)
app.include_router(network.router)

# Serve built frontend
CLIENT_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "client", "dist")
if os.path.isdir(CLIENT_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(CLIENT_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Serve the SPA index.html for all non-API routes."""
        file_path = os.path.join(CLIENT_DIST, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(CLIENT_DIST, "index.html"))


def main():
    port = int(os.environ.get("PORT", "8050"))
    print(f"Starting Identity Tree Explorer on http://localhost:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
