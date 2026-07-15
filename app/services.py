import httpx
from fastapi import Request
from fastapi.templating import Jinja2Templates
from loguru import logger

from app.config import settings

templates = Jinja2Templates(directory="templates")

def extract_cards(player: dict) -> list:
    cards = player.get("cards")
    if isinstance(cards, list):
        return cards
    return []
# -----------------------------------
async def java_request(method: str, url: str, request: Request, json_data=None, params=None):
    user = request.session.get("user")
    if not user:
        return None
    
    headers = {"Authorization": f"Bearer {user.get('token')}"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            res = await client.request(method, url, json=json_data, params=params, headers=headers)

            if res.status_code == 401 and user.get("refresh_token"):
                logger.info(f"🔄 Access Token для {user['name']} истек. Попытка динамического обновления...")
                refresh_url = f"https://{settings.JAVA_HOST}/api/auth/refresh"
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

                    return await client.request(method, url, json=json_data, params=params, headers=headers)

                else:
                    logger.warning(f"❌ Ядро отказало в рефреше! Статус: {refresh_res.status_code}")
                    logger.warning("Рефреш токен истек. Сессия закончена.")
                    request.session.clear()
                    return refresh_res

            return res

        except httpx.RequestError as e:
            logger.error(f"Ошибка соединения с Ядром: {e}")
            return None