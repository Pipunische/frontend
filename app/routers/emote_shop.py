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
    owned_ids_for_user,
    set_session_owned_ids,
)
from app.models import EmotePurchaseRequest
from app.services import is_core_unreachable, java_request
from app.session_utils import (
    is_dev_mock_user,
    refresh_wallet_from_java,
    require_user,
    sync_user_wallet,
    unauthorized_json,
)

router = APIRouter(tags=["Emote Shop"])


def _mock_shop_state(request: Request, user: dict, *, include_mock: bool | None = None) -> dict:
    use_mock_catalog = is_dev_mock_user(user) if include_mock is None else include_mock
    owned_ids = owned_ids_for_user(
        user.get("user_id"),
        get_session_owned_ids(request.session, include_mock=use_mock_catalog),
        include_mock=use_mock_catalog,
    )
    set_session_owned_ids(request.session, owned_ids)
    wallet_balance = int(user.get("wallet_balance") or 0)
    return build_shop_response(
        wallet_balance,
        owned_ids,
        source="mock",
        include_mock=use_mock_catalog,
    )


def _apply_mock_purchase(
    request: Request,
    user: dict,
    owned_ids: list[str],
    emote_id: str,
    *,
    conflict_on_owned: bool = True,
):
    success, error = mock_purchase(user, owned_ids, emote_id)
    if error:
        status_code = 409 if conflict_on_owned and error.get("errorType") == "AlreadyOwned" else 400
        return JSONResponse(status_code=status_code, content=error)
    set_session_owned_ids(request.session, success["owned_emote_ids"])
    sync_user_wallet(request, success["wallet_balance"])
    return success


@router.get("/api/emotes")
async def api_get_emotes(request: Request):
    user = require_user(request)
    if not user:
        return unauthorized_json()

    if is_dev_mock_user(user):
        return _mock_shop_state(request, user)

    user_id = user.get("user_id")
    target_url = f"{settings.BASE_JAVA_URL}/user/{user_id}/emotes"
    response = await java_request("GET", target_url, request)

    if is_core_unreachable(response):
        logger.warning("Emote shop: Java недоступен, отдаём BFF mock")
        wallet_balance = await refresh_wallet_from_java(request, user)
        user = require_user(request) or user
        owned_ids = owned_ids_for_user(user.get("user_id"), get_session_owned_ids(request.session))
        set_session_owned_ids(request.session, owned_ids)
        return build_shop_response(wallet_balance, owned_ids, source="mock")

    if response.status_code == 401:
        return unauthorized_json()

    if response.status_code == 200:
        try:
            payload = enrich_java_shop_payload(response.json(), user_id=user_id)
        except Exception as exc:
            logger.error(f"Emote shop: не удалось разобрать ответ Java: {exc}")
            return JSONResponse(status_code=502, content={"errorType": "InvalidResponse", "message": "Некорректный ответ сервера"})

        set_session_owned_ids(request.session, payload.get("owned_emote_ids", []))
        sync_user_wallet(request, payload.get("wallet_balance", 0))
        return payload

    if java_emotes_unavailable(response):
        logger.info(f"Emote shop: Java emotes API недоступен ({response.status_code}), BFF mock")
        await refresh_wallet_from_java(request, user)
        user = require_user(request) or user
        return _mock_shop_state(request, user)

    try:
        error_payload = response.json()
    except Exception:
        error_payload = {"message": response.text}

    return JSONResponse(status_code=response.status_code, content=error_payload)


@router.post("/api/emotes/purchase")
async def api_purchase_emote(request: Request, body: EmotePurchaseRequest):
    user = require_user(request)
    if not user:
        return unauthorized_json()

    if is_dev_mock_user(user):
        owned_ids = get_session_owned_ids(request.session)
        return _apply_mock_purchase(request, user, owned_ids, body.emote_id)

    user_id = user.get("user_id")
    target_url = f"{settings.BASE_JAVA_URL}/user/{user_id}/emotes/purchase"
    payload = {"emote_id": body.emote_id}

    response = await java_request("POST", target_url, request, json_data=payload)

    if is_core_unreachable(response):
        logger.warning("Emote shop purchase: Java недоступен, BFF mock")
        owned_ids = owned_ids_for_user(user.get("user_id"), get_session_owned_ids(request.session))
        return _apply_mock_purchase(
            request, user, owned_ids, body.emote_id, conflict_on_owned=False
        )

    if response.status_code == 401:
        return unauthorized_json()

    if response.status_code == 200:
        try:
            result = enrich_java_shop_payload(response.json(), user_id=user_id)
        except Exception as exc:
            logger.error(f"Emote shop purchase: не удалось разобрать ответ Java: {exc}")
            return JSONResponse(status_code=502, content={"errorType": "InvalidResponse", "message": "Некорректный ответ сервера"})

        set_session_owned_ids(request.session, result.get("owned_emote_ids", []))
        sync_user_wallet(request, result.get("wallet_balance", 0))
        result["status"] = "success"
        result["source"] = "java"
        return result

    if java_emotes_unavailable(response):
        logger.info(f"Emote shop purchase: Java API недоступен ({response.status_code}), BFF mock")
        owned_ids = owned_ids_for_user(user.get("user_id"), get_session_owned_ids(request.session))
        return _apply_mock_purchase(request, user, owned_ids, body.emote_id)

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
