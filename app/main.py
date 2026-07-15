from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import settings
from app.services import templates
from app.routers import auth, lobby, tables

app = FastAPI(title="PoluPoker BFF", version="2.0.0")

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SESSION_KEY,
    max_age=604800
)

app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(auth.router)
app.include_router(lobby.router)
app.include_router(tables.router)

@app.get("/", response_class=HTMLResponse)
def page_home(request: Request):
    current_user = request.session.get("user")

    context = {
        "club_name": "PoluPoker",
        "creator_name": "SiliVal",
        "user": current_user
    }
    return templates.TemplateResponse(
        request=request, name="clear_home.html", context=context
    )