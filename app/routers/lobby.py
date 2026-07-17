from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from loguru import logger

from app.config import settings
from app.models import CreateTableRequest
from app.services import templates, java_request

router = APIRouter(tags=["Lobby"])

@router.get("/lobby", response_class=HTMLResponse)
async def page_lobby(request: Request, error: str = None):

    current_user = request.session.get("user")
    if not current_user:
        return RedirectResponse(url="/login", status_code=303)

    balance_url = f"{settings.JAVA_AUTH_URL}/{current_user['user_id']}/balance"
    balance_res = await java_request("GET", balance_url, request)

    if not balance_res or balance_res.status_code == 401:
        logger.error("🚨 При обновлении сессии возникли ошибки. Отправляю в login...")
        request.session.clear()
        return RedirectResponse(url="/login?error=session_expired", status_code=303)

    if balance_res.status_code == 200:
        new_balance = balance_res.json().get("wallet_balance")
        if new_balance is not None:
            current_user["wallet_balance"] = new_balance
            request.session["user"] = current_user
            logger.success(f"💰 Баланс успешно получен: {new_balance}")
    
    is_down = False
    tables_data = []

    tables_res = await java_request("GET", settings.JAVA_TABLES_URL, request)

    if tables_res and tables_res.status_code == 200:
        tables_data = tables_res.json()
    else:
        logger.error(f"🛑 При получении столов произошла ошибка: {tables_res.status_code if tables_res else 'No response'}")
        is_down = True

    context = {
        "tables": tables_data,
        "is_server_down": is_down,
        "user": current_user,
        "user_token": current_user.get("token") or "",
        "error": error,
        "java_host": settings.FRONTEND_JAVA_HOST,
        "v": settings.APP_VERSION
    }

    return templates.TemplateResponse(request=request, name="clear_lobby.html", context=context)
# -----------------------------------
@router.post("/api/tables")
async def create_table(request: Request, data: CreateTableRequest):
    user = request.session.get("user")
    if not user:
        return {"redirect": "/login?error=session_expired"}

    user_id = user.get("user_id")
    target_url = settings.JAVA_TABLES_URL

    payload = {
        "name": data.name,
        "passcode": data.passcode if data.passcode else "",
        "user_id": user_id,
        "chips": data.chips,
        "min_players_num": data.min_players_num,
        "max_players_num": data.max_players_num,
        "small_blind": data.small_blind,
        "big_blind": data.big_blind
    }

    logger.info(f"🪑 Игрок {user['name']} создает кастомный стол '{data.name}'")

    response = await java_request("POST", target_url, request, json_data=payload)
    status = getattr(response, 'status_code', None)

    if not response or status == 401:
        return {"redirect": "/login?error=session_expired"}

    if status == 200:
        table_data = response.json()
        table_name = table_data.get("table_name")
        table_id = table_data.get("table_id")

        logger.success(f"✅ Стол с именем {table_name} и id: {table_id} успешно создан. Редирект.")
        return {"status": "success", "redirect": f"/table/{table_id}"}

    else:
        error_text = "Unknown error"
        try:
            error_text = response.json().get("error", response.text)
        except:
            error_text = response.text
        logger.error(f"🚫 Java ОТКАЗАЛ В СОЗДАНИИ СТОЛА ({status}): {error_text}")
        return {"error": error_text}