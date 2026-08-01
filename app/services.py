import asyncio

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates
from loguru import logger

from app.config import settings

templates = Jinja2Templates(directory="templates")

JAVA_RETRYABLE_STATUSES = {502, 503, 504}
JAVA_MAX_RETRIES = 3
JAVA_RETRY_DELAYS = (0.3, 0.6, 1.2)


def extract_cards(player: dict) -> list:
    cards = player.get("cards")
    if isinstance(cards, list):
        return cards
    return []


def is_core_unreachable(response) -> bool:
    return response is None


def core_unreachable_json(message: str = "Игровое ядро временно недоступно") -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "error": "core_unreachable",
            "errorType": "CoreUnavailable",
            "message": message,
            "retry": True,
        },
    )


def _should_retry_request(method: str, response: httpx.Response, attempt: int) -> bool:
    if attempt >= JAVA_MAX_RETRIES - 1:
        return False
    return method.upper() in ("GET", "HEAD") and response.status_code in JAVA_RETRYABLE_STATUSES


async def _refresh_access_token(client: httpx.AsyncClient, request: Request, user: dict, headers: dict):
    refresh_url = f"{settings.JAVA_AUTH_URL}/refresh"
    refresh_payload = {"refresh_token": user.get("refresh_token")}

    refresh_res = await client.post(refresh_url, json=refresh_payload)

    if refresh_res.status_code == 200:
        new_tokens = refresh_res.json()
        user["token"] = new_tokens.get("access_token")

        if new_tokens.get("refresh_token"):
            user["refresh_token"] = new_tokens.get("refresh_token")

        request.session["user"] = user
        logger.success("Токен успешно обновлен. Пробую повторить запрос...")
        headers["Authorization"] = f"Bearer {user['token']}"
        return True

    logger.warning(f"❌ Ядро отказало в рефреше! Статус: {refresh_res.status_code}")
    logger.warning("Рефреш токен истек. Сессия закончена.")
    request.session.clear()
    return refresh_res


async def java_request(method: str, url: str, request: Request, json_data=None, params=None):
    user = request.session.get("user")
    if not user:
        return None

    headers = {
        "Authorization": f"Bearer {user.get('token')}",
        "Accept-Language": "ru-RU",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        for attempt in range(JAVA_MAX_RETRIES):
            try:
                res = await client.request(method, url, json=json_data, params=params, headers=headers)

                if res.status_code == 401 and user.get("refresh_token"):
                    logger.info(f"🔄 Access Token для {user['name']} истек. Попытка динамического обновления...")
                    refresh_result = await _refresh_access_token(client, request, user, headers)

                    if refresh_result is not True:
                        return refresh_result

                    user = request.session.get("user")
                    res = await client.request(method, url, json=json_data, params=params, headers=headers)

                if _should_retry_request(method, res, attempt):
                    logger.warning(
                        f"Ядро вернуло {res.status_code} для {method} {url}. "
                        f"Повтор {attempt + 2}/{JAVA_MAX_RETRIES}..."
                    )
                    await asyncio.sleep(JAVA_RETRY_DELAYS[attempt])
                    continue

                return res

            except httpx.RequestError as e:
                logger.warning(
                    f"Ошибка соединения с Ядром (попытка {attempt + 1}/{JAVA_MAX_RETRIES}): {e}"
                )
                if attempt < JAVA_MAX_RETRIES - 1:
                    await asyncio.sleep(JAVA_RETRY_DELAYS[attempt])
                    continue

                logger.error(f"Ядро недоступно после {JAVA_MAX_RETRIES} попыток: {e}")
                return None
