from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from loguru import logger

from app.config import settings
from app.emote_shop import (
    build_shop_response,
    enrich_java_shop_payload,
    get_session_owned_ids,
    java_emotes_unavailable,
    mock_purchase,
    set_session_owned_ids,
)
from app.models import EmotePurchaseRequest
from app.services import is_core_unreachable, java_request

router = APIRouter(tags=["Emote Shop"])


def _is_dev_mock_user(user: dict) -> bool:
    return user.get("token") == "fake_token"


def _unauthorized():
    return JSONResponse(
        status_code=401,
        content={"redirect": "/login?error=session_expired"},
    )


def _sync_user_wallet(request: Request, wallet_balance: int) -> None:
    user = request.session.get("user")
    if not user:
        return
    user["wallet_balance"] = wallet_balance
    request.session["user"] = user


async def _refresh_wallet_from_java(request: Request, user: dict) -> int:
    balance_url = f"{settings.JAVA_AUTH_URL}/{user['user_id']}/balance"
    balance_res = await java_request("GET", balance_url, request)

    if balance_res and balance_res.status_code == 200:
        wallet_balance = balance_res.json().get("wallet_balance")
        if wallet_balance is not None:
            _sync_user_wallet(request, int(wallet_balance))
            return int(wallet_balance)

    return int(user.get("wallet_balance") or 0)


def _mock_shop_state(request: Request, user: dict) -> dict:
    owned_ids = get_session_owned_ids(request.session)
    wallet_balance = int(user.get("wallet_balance") or 0)
    return build_shop_response(wallet_balance, owned_ids, source="mock")


@router.get("/api/emotes")
async def api_get_emotes(request: Request):
    user = request.session.get("user")
    if not user:
        return _unauthorized()

    if _is_dev_mock_user(user):
        return _mock_shop_state(request, user)

    user_id = user.get("user_id")
    target_url = f"{settings.BASE_JAVA_URL}/user/{user_id}/emotes"
    response = await java_request("GET", target_url, request)

    if is_core_unreachable(response):
        logger.warning("Emote shop: Java недоступен, отдаём BFF mock")
        wallet_balance = await _refresh_wallet_from_java(request, user)
        user = request.session.get("user") or user
        owned_ids = get_session_owned_ids(request.session)
        return build_shop_response(wallet_balance, owned_ids, source="mock")

    if response.status_code == 401:
        return _unauthorized()

    if response.status_code == 200:
        try:
            payload = enrich_java_shop_payload(response.json())
        except Exception as exc:
            logger.error(f"Emote shop: не удалось разобрать ответ Java: {exc}")
            return JSONResponse(status_code=502, content={"errorType": "InvalidResponse", "message": "Некорректный ответ сервера"})

        set_session_owned_ids(request.session, payload.get("owned_emote_ids", []))
        _sync_user_wallet(request, payload.get("wallet_balance", 0))
        return payload

    if java_emotes_unavailable(response):
        logger.info(f"Emote shop: Java emotes API недоступен ({response.status_code}), BFF mock")
        wallet_balance = await _refresh_wallet_from_java(request, user)
        user = request.session.get("user") or user
        return _mock_shop_state(request, user)

    try:
        error_payload = response.json()
    except Exception:
        error_payload = {"message": response.text}

    return JSONResponse(status_code=response.status_code, content=error_payload)


@router.post("/api/emotes/purchase")
async def api_purchase_emote(request: Request, body: EmotePurchaseRequest):
    user = request.session.get("user")
    if not user:
        return _unauthorized()

    if _is_dev_mock_user(user):
        owned_ids = get_session_owned_ids(request.session)
        success, error = mock_purchase(user, owned_ids, body.emote_id)
        if error:
            status_code = 409 if error.get("errorType") == "AlreadyOwned" else 400
            return JSONResponse(status_code=status_code, content=error)
        set_session_owned_ids(request.session, success["owned_emote_ids"])
        _sync_user_wallet(request, success["wallet_balance"])
        return success

    user_id = user.get("user_id")
    target_url = f"{settings.BASE_JAVA_URL}/user/{user_id}/emotes/purchase"
    payload = {"emote_id": body.emote_id}

    response = await java_request("POST", target_url, request, json_data=payload)

    if is_core_unreachable(response):
        logger.warning("Emote shop purchase: Java недоступен, BFF mock")
        owned_ids = get_session_owned_ids(request.session)
        success, error = mock_purchase(user, owned_ids, body.emote_id)
        if error:
            return JSONResponse(status_code=400, content=error)
        set_session_owned_ids(request.session, success["owned_emote_ids"])
        _sync_user_wallet(request, success["wallet_balance"])
        return success

    if response.status_code == 401:
        return _unauthorized()

    if response.status_code == 200:
        try:
            result = enrich_java_shop_payload(response.json())
        except Exception as exc:
            logger.error(f"Emote shop purchase: не удалось разобрать ответ Java: {exc}")
            return JSONResponse(status_code=502, content={"errorType": "InvalidResponse", "message": "Некорректный ответ сервера"})

        set_session_owned_ids(request.session, result.get("owned_emote_ids", []))
        _sync_user_wallet(request, result.get("wallet_balance", 0))
        result["status"] = "success"
        result["source"] = "java"
        return result

    if java_emotes_unavailable(response):
        logger.info(f"Emote shop purchase: Java API недоступен ({response.status_code}), BFF mock")
        owned_ids = get_session_owned_ids(request.session)
        success, error = mock_purchase(user, owned_ids, body.emote_id)
        if error:
            status_code = 409 if error.get("errorType") == "AlreadyOwned" else 400
            return JSONResponse(status_code=status_code, content=error)
        set_session_owned_ids(request.session, success["owned_emote_ids"])
        _sync_user_wallet(request, success["wallet_balance"])
        return success

    try:
        error_payload = response.json()
    except Exception:
        error_payload = {
            "error": True,
            "errorType": "PurchaseFailed",
            "message": response.text or "Не удалось купить эмодзи",
        }

    if "errorType" not in error_payload:
        error_payload.setdefault("error", True)
        error_payload.setdefault("errorType", "PurchaseFailed")

    return JSONResponse(status_code=response.status_code, content=error_payload)
