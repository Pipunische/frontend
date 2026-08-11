from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.services import templates, java_request, is_core_unreachable
from app.routers import auth, lobby, tables

app = FastAPI(title="PoluPoker BFF", version="2.0.0")


class StaticCacheMiddleware(BaseHTTPMiddleware):
    """Long-cache versioned static files; HTML/API stay fresh."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path

        if not path.startswith("/static/"):
            return response

        query = request.url.query or ""
        if "v=" in query:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=300"

        return response


app.add_middleware(StaticCacheMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_KEY,
    max_age=604800
)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(auth.router)
app.include_router(lobby.router)
app.include_router(tables.router)


@app.get("/api/health")
async def api_health():
    return {"status": "ok", "service": "polupoker-bff", "version": settings.APP_VERSION}


@app.get("/api/health/core")
async def api_health_core(request: Request):
    user = request.session.get("user")
    if not user:
        return JSONResponse(
            status_code=401,
            content={"redirect": "/login?error=session_expired"},
        )

    response = await java_request("GET", settings.JAVA_TABLES_URL, request)
    if is_core_unreachable(response):
        return JSONResponse(
            status_code=503,
            content={
                "core": "unreachable",
                "error": "core_unreachable",
                "retry": True,
            },
        )

    return {
        "core": "ok",
        "status_code": response.status_code,
    }


@app.get("/", response_class=HTMLResponse)
def page_home(request: Request):
    current_user = request.session.get("user")

    context = {
        "club_name": "PoluPoker",
        "creator_name": "SiliVal",
        "user": current_user,
        "v": settings.APP_VERSION,
    }
    return templates.TemplateResponse(
        request=request, name="clear_home.html", context=context
    )
