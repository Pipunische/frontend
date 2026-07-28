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




@router.get("/dev-lobby", response_class=HTMLResponse)
async def dev_page_lobby(request: Request):
    """
    Секретный эндпоинт для тестирования верстки Лобби без Java-бэкенда.
    Доступен по адресу: http://127.0.0.1:8000/dev-lobby
    """
    # 1. Фейковый юзер с ограниченным бюджетом (чтобы протестить блокировку VIP стола)
    mock_user = {
        "user_id": "hero_123",
        "name": "Arseniy",
        "wallet_balance": 1500, # Денег мало!
        "token": "fake_token",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=Arseniy"
    }

    # 2. Фейковые столы всех возможных типов
    mock_tables = [
        {
            "table_id": "table_1",
            "table_name": "Новички (Low Stake)",
            "blinds": "10/20",
            "min_buy_in": 200, 
            "current_players": 5,
            "max_players": 10
        },
        {
            "table_id": "table_2",
            "table_name": "Стандарт (Standard)",
            "blinds": "50/100",
            "min_buy_in": 1000, 
            "current_players": 9,
            "max_players": 9 # Стол заполнен (МЕСТ НЕТ)
        },
        {
            "table_id": "table_3",
            "table_name": "Хайроллеры (VIP Stake)",
            "blinds": "500/1000",
            "min_buy_in": 10000, # У юзера нет таких денег (Блокировка)
            "current_players": 2,
            "max_players": 6
        },
        {
            "table_id": "table_4",
            "table_name": "ОДИН НА ОДИН",
            "blinds": "100/200",
            "min_buy_in": 2000, 
            "current_players": 1,
            "max_players": 2
        },
        {
            "table_id": "table_4",
            "table_name": "Один на один (Heads Up)",
            "blinds": "100/200",
            "min_buy_in": 2000, 
            "current_players": 1,
            "max_players": 2
        },
        {
            "table_id": "table_4",
            "table_name": "Один на один (Heads Up)",
            "blinds": "100/200",
            "min_buy_in": 2000, 
            "current_players": 1,
            "max_players": 2
        },
        {
            "table_id": "table_4",
            "table_name": "Один на один (Heads Up)",
            "blinds": "100/200",
            "min_buy_in": 2000, 
            "current_players": 1,
            "max_players": 2
        }
    ]

    context = {
        "tables": mock_tables,
        "is_server_down": False, # Измени на True, чтобы протестить красную плашку "Сервер упал"
        "user": mock_user,
        "user_token": mock_user["token"],
        "error": None,
        "java_host": settings.FRONTEND_JAVA_HOST,
        "v": settings.APP_VERSION
    }

    return templates.TemplateResponse(request=request, name="clear_lobby.html", context=context)