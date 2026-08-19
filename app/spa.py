from pathlib import Path

from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings

SPA_DIST = Path("web/dist")
SPA_INDEX = SPA_DIST / "index.html"
SPA_ASSETS = SPA_DIST / "assets"


def spa_enabled() -> bool:
    return bool(settings.SPA_SERVE)


def spa_index_response() -> FileResponse:
    return FileResponse(
        SPA_INDEX,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


def mount_spa_assets(app) -> None:
    if not spa_enabled():
        return
    if SPA_ASSETS.is_dir():
        app.mount("/assets", StaticFiles(directory=str(SPA_ASSETS)), name="spa-assets")
