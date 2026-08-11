from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from loguru import logger
import asyncio

from app.config import settings
from app.models import CreateTableRequest
from app.services import (
    templates,
    java_request,
    core_unreachable_json,
    is_core_unreachable,
    enrich_lobby_tables,
    enrich_user_wallet_display,
    format_poker_amount,
)

router = APIRouter(tags=["Lobby"])

LOBBY_TABLES_RETRY_DELAYS = (0.25, 0.5, 0.75)


async def fetch_lobby_tables(request: Request):
    """Fetch tables with short retries — avoids false server_down on Ctrl+F5 / WS reconnect races."""
    last_status = None

    for attempt, delay in enumerate(LOBBY_TABLES_RETRY_DELAYS):
        tables_res = await java_request("GET", settings.JAVA_TABLES_URL, request)

        if is_core_unreachable(tables_res):
            if attempt < len(LOBBY_TABLES_RETRY_DELAYS) - 1:
                logger.warning(
                    f"🔄 Лобби: ядро не ответило на /tables (попытка {attempt + 1}), retry..."
                )
                await asyncio.sleep(delay)
                continue
            return [], True, "unreachable"

        if tables_res and tables_res.status_code == 200:
            return tables_res.json(), False, None

        last_status = getattr(tables_res, "status_code", None)
        if attempt < len(LOBBY_TABLES_RETRY_DELAYS) - 1:
            logger.warning(
                f"🔄 Лобби: /tables вернул {last_status} (попытка {attempt + 1}), retry..."
            )
            await asyncio.sleep(delay)

    logger.error(f"🛑 Лобби: не удалось получить столы после retry (status={last_status})")
    return [], True, last_status


async def load_lobby_context(request: Request):
    current_user = request.session.get("user")
    if not current_user:
        return None

    balance_url = f"{settings.JAVA_AUTH_URL}/{current_user['user_id']}/balance"
    balance_res = await java_request("GET", balance_url, request)

    if is_core_unreachable(balance_res):
        logger.error("🛑 Ядро недоступно при загрузке лобби")
        return {"error": "core_unreachable"}

    if balance_res.status_code == 401:
        logger.error("🚨 При обновлении сессии возникли ошибки. Отправляю в login...")
        request.session.clear()
        return {"redirect": "/login?error=session_expired"}

    if balance_res.status_code == 200:
        new_balance = balance_res.json().get("wallet_balance")
        if new_balance is not None:
            current_user["wallet_balance"] = new_balance
            request.session["user"] = current_user
            logger.success(f"💰 Баланс успешно получен: {new_balance}")

    tables_data, is_down, _tables_error = await fetch_lobby_tables(request)
    tables_data = enrich_lobby_tables(tables_data)
    current_user = enrich_user_wallet_display(current_user)
    if current_user.get("wallet_balance") is not None:
        request.session["user"] = current_user

    return {
        "tables": tables_data,
        "is_server_down": is_down,
        "user": current_user,
        "user_token": current_user.get("token") or "",
        "java_host": settings.FRONTEND_JAVA_HOST,
        "v": settings.APP_VERSION,
    }


def _lobby_state_payload(lobby_data: dict) -> dict:
    user = lobby_data["user"]
    wallet = user.get("wallet_balance")
    return {
        "tables": lobby_data["tables"],
        "is_server_down": lobby_data["is_server_down"],
        "user": {
            "wallet_balance": wallet,
            "wallet_balance_formatted": user.get("wallet_balance_formatted")
            or (format_poker_amount(wallet) if wallet is not None else None),
            "name": user.get("name"),
        },
        "token": lobby_data["user_token"],
    }


def _respond_lobby_result(lobby_data, *, json_mode: bool = False):
    if lobby_data is None:
        if json_mode:
            return JSONResponse(
                status_code=401,
                content={"redirect": "/login?error=session_expired"},
            )
        return RedirectResponse(url="/login", status_code=303)

    if lobby_data.get("error") == "core_unreachable":
        if json_mode:
            return core_unreachable_json()
        return RedirectResponse(url="/lobby?error=server_down", status_code=303)

    if lobby_data.get("redirect"):
        if json_mode:
            return JSONResponse(status_code=401, content={"redirect": lobby_data["redirect"]})
        return RedirectResponse(url=lobby_data["redirect"], status_code=303)

    return _lobby_state_payload(lobby_data)


@router.get("/lobby", response_class=HTMLResponse)
async def page_lobby(request: Request, error: str = None):
    lobby_data = await load_lobby_context(request)
    json_mode = request.headers.get("accept") == "application/json"

    if lobby_data is None:
        return RedirectResponse(url="/login", status_code=303)

    if lobby_data.get("error") == "core_unreachable":
        if json_mode:
            return core_unreachable_json()
        lobby_data = {
            "tables": [],
            "is_server_down": True,
            "user": request.session.get("user") or {},
            "user_token": "",
            "java_host": settings.FRONTEND_JAVA_HOST,
            "v": settings.APP_VERSION,
        }
    elif lobby_data.get("redirect"):
        return RedirectResponse(url=lobby_data["redirect"], status_code=303)

    if json_mode:
        return JSONResponse(content=_lobby_state_payload(lobby_data))

    context = {
        **lobby_data,
        "error": error,
        "is_dev_lobby": False,
    }

    return templates.TemplateResponse(request=request, name="lobby.html", context=context)


@router.get("/api/lobby/state")
async def api_lobby_state(request: Request):
    lobby_data = await load_lobby_context(request)
    response = _respond_lobby_result(lobby_data, json_mode=True)

    if isinstance(response, dict):
        return response

    return response


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
    mock_user = enrich_user_wallet_display({
        "user_id": "hero_123",
        "name": "Arseniy",
        "wallet_balance": 1500, # Денег мало!
        "token": "fake_token",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=Arseniy"
    })

    # 2. Фейковые столы всех возможных типов
    mock_tables = enrich_lobby_tables([
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
    ])

    context = {
        "tables": mock_tables,
        "is_server_down": False, # Измени на True, чтобы протестить красную плашку "Сервер упал"
        "user": mock_user,
        "user_token": mock_user["token"],
        "error": None,
        "java_host": settings.FRONTEND_JAVA_HOST,
        "v": settings.APP_VERSION,
        "is_dev_lobby": True,
    }

    return templates.TemplateResponse(request=request, name="lobby.html", context=context)
