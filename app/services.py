import asyncio

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.templating import Jinja2Templates
from loguru import logger

from app.config import settings

templates = Jinja2Templates(directory="templates")


def card_png_url(card: str) -> str:
    """Normalize card id to a Linux-safe static PNG path (e.g. Ad -> /static/cards/AD.png)."""
    if not card:
        return "/static/cards/card_back.png"

    normalized = str(card).strip()
    if normalized.lower() in ("card_back", "back"):
        return "/static/cards/card_back.png"

    return f"/static/cards/{normalized.upper()}.png"


templates.env.filters["card_png"] = card_png_url


def format_poker_amount(value) -> str:
    """Compact chip display: 1000 -> 1K, 1000000 -> 1M."""
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        return str(value) if value is not None else "0"

    if n >= 1_000_000:
        scaled = n / 1_000_000
        if scaled == int(scaled):
            return f"{int(scaled)}M"
        text = f"{scaled:.1f}".rstrip("0").rstrip(".")
        return f"{text}M"

    if n >= 1_000:
        scaled = n / 1_000
        if scaled == int(scaled):
            return f"{int(scaled)}K"
        text = f"{scaled:.1f}".rstrip("0").rstrip(".")
        return f"{text}K"

    return str(n)


def format_blinds(blinds) -> str:
    if blinds is None:
        return "0/0"

    text = str(blinds).strip()
    if not text:
        return "0/0"

    if any(ch.isalpha() for ch in text):
        return text

    parts = text.split("/")
    if len(parts) == 2:
        return f"{format_poker_amount(parts[0].strip())}/{format_poker_amount(parts[1].strip())}"

    return format_poker_amount(text)


def enrich_lobby_table(table: dict) -> dict:
    enriched = dict(table)

    if not enriched.get("blinds"):
        small = enriched.get("small_blind")
        big = enriched.get("big_blind")
        if small is not None and big is not None:
            enriched["blinds"] = f"{small}/{big}"

    enriched["blinds"] = format_blinds(enriched.get("blinds"))
    enriched["min_buy_in_formatted"] = format_poker_amount(enriched.get("min_buy_in"))
    return enriched


def enrich_lobby_tables(tables: list) -> list:
    if not tables:
        return []
    return [enrich_lobby_table(table) for table in tables]


def enrich_user_wallet_display(user: dict) -> dict:
    if not user:
        return user
    if user.get("wallet_balance") is not None:
        user["wallet_balance_formatted"] = format_poker_amount(user["wallet_balance"])
    return user


def _pick(stats: dict, *keys):
    for key in keys:
        value = stats.get(key)
        if value is not None:
            return value
    return None


def normalize_user_stats(stats: dict) -> dict:
    """Map Java UserStatsDTO field names to what profile.html expects (no rank logic)."""
    normalized = dict(stats)

    normalized["hands_played"] = _pick(stats, "hands_played", "handsPlayed") or 0
    normalized["total_won"] = _pick(stats, "total_won", "totalWon") or 0
    normalized["win_ratio"] = _pick(stats, "win_ratio", "winRatio") or 0
    normalized["biggest_pot"] = _pick(stats, "biggest_pot", "biggestPot") or 0
    normalized["rank"] = _pick(stats, "rank") or "Sucker"

    progress = _pick(stats, "rank_progress_percent", "rankProgressPercent")
    if progress is None:
        progress = _pick(stats, "rank_progress", "rankProgress")
    normalized["rank_progress_percent"] = float(progress) if progress is not None else 0

    normalized["next_rank"] = _pick(stats, "next_rank", "nextRank")
    chips = _pick(stats, "chips_to_next_rank", "chipsToNextRank")
    normalized["chips_to_next_rank"] = int(chips) if chips is not None else 0

    rank_min = _pick(stats, "rank_min_total_won", "rankMinTotalWon")
    rank_max = _pick(stats, "rank_max_total_won", "rankMaxTotalWon")
    if rank_min is not None:
        normalized["rank_min_total_won"] = int(rank_min)
    if rank_max is not None:
        normalized["rank_max_total_won"] = int(rank_max)

    return normalized


templates.env.filters["poker_amount"] = format_poker_amount
templates.env.filters["poker_blinds"] = format_blinds

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
