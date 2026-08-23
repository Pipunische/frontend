import httpx
from fastapi import APIRouter, FastAPI, Request, Form, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from loguru import logger

from app.config import settings
from app.models import GoogleAuthRequest, NicknameRequest
from app.services import templates, java_request, core_unreachable_json, is_core_unreachable, normalize_user_stats
from app.session_utils import (
    is_dev_mock_user,
    require_user,
    sync_user_wallet,
    unauthorized_json,
)
from app.spa import spa_enabled, spa_index_response

router = APIRouter(tags=["Authentication & Profile"])

DEFAULT_PROFILE_STATS = {
    "hands_played": 0,
    "total_won": 0,
    "win_ratio": 0,
    "biggest_pot": 0,
    "rank": "Sucker",
}


def _wants_json(request: Request) -> bool:
    accept = (request.headers.get("accept") or "").lower()
    return "application/json" in accept


async def _load_profile_stats(request: Request, user: dict) -> dict:
    stats_data = dict(DEFAULT_PROFILE_STATS)
    if is_dev_mock_user(user):
        return normalize_user_stats(stats_data)

    user_id = user.get("user_id")
    stats_url = f"{settings.BASE_JAVA_URL}/user/{user_id}/stats"
    stats_res = await java_request("GET", stats_url, request)

    if stats_res and stats_res.status_code == 200:
        stats_data = stats_res.json()
    else:
        err_msg = stats_res.text if stats_res else "No Response"
        status = stats_res.status_code if stats_res else "N/A"
        logger.error(
            f"Failed to fetch stats from Java | Status: {status} | URL: {stats_url} | Error: {err_msg}"
        )

    return normalize_user_stats(stats_data)


def _profile_user_json(user: dict) -> dict:
    return {
        "user_id": str(user.get("user_id")),
        "name": user.get("name"),
        "avatar_url": user.get("avatar_url") or "",
        "wallet_balance": int(user.get("wallet_balance") or 0),
    }

@router.get("/login", response_class=HTMLResponse)
async def page_login(request: Request, error: str = None):
    if request.session.get("user"):
        return RedirectResponse(url="/lobby", status_code=303)

    if spa_enabled():
        return spa_index_response()

    context = {"v": settings.APP_VERSION, "error": error}
    return templates.TemplateResponse(request=request, name="login.html", context=context)


@router.post("/api/auth/google")
async def google_auth_process(request: Request, data: GoogleAuthRequest):
    logger.info("🔑 Получен Google Token от фронтенда, передаю ядру...")

    auth_url = f"{settings.JAVA_AUTH_URL}/google"

    try:

        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.post(auth_url, json={"token": data.token})

            if response.status_code == 200:
                user_data = response.json()

                avatar_file = user_data.get("avatar_url", "")

                request.session["user"] = {
                    "user_id": str(user_data.get("user_id")),
                    "name": user_data.get("nickname"),
                    "wallet_balance": user_data.get("wallet_balance", 0),
                    "token": user_data.get("access_token"),
                    "refresh_token": user_data.get("refresh_token"),
                    "avatar_url": avatar_file
                }

                logger.success(f"✅ Google Auth успешен. Зашел юзер: {user_data.get('nickname')}")

                is_new = user_data.get("is_new_user", False)
                if is_new:
                    return {"status": "success", "is_new_user": True}

                return {"status": "success", "redirect": "/lobby"}         
            else:
                logger.error(f"❌ Ядро отклонило Google Token (Status {response.status_code}): {response.text[:200]}...")
                return {"error": "Ошибка авторизации"}

    except Exception as e:
        logger.error(f"❌ Бекенд упал при Google Auth: {e}")
        return {"error": "Сервер не доступен"}


@router.post("/api/upload-avatar")
async def upload_avatar(request: Request, avatar: UploadFile = File(...)):
    json_mode = _wants_json(request)
    user = require_user(request)
    if not user:
        if json_mode:
            return unauthorized_json()
        return RedirectResponse(url="/login", status_code=303)

    if is_dev_mock_user(user) and json_mode:
        seed = avatar.filename or user.get("name") or "mock"
        avatar_url = f"https://api.dicebear.com/7.x/avataaars/svg?seed={seed}"
        user["avatar_url"] = avatar_url
        request.session["user"] = user
        logger.info(f"🧪 Mock avatar для {user.get('name')}: {avatar_url}")
        return {"status": "success", "avatar_url": avatar_url}

    if not avatar.content_type or not avatar.content_type.startswith("image/"):
        if json_mode:
            return JSONResponse(
                status_code=400,
                content={
                    "error": True,
                    "errorType": "InvalidFile",
                    "message": "Нужен файл изображения",
                },
            )
        return RedirectResponse(url="/profile?error=invalid_file", status_code=303)

    file_bytes = await avatar.read()
    files = {"file": (avatar.filename, file_bytes, avatar.content_type)}

    target_url = f"{settings.JAVA_AUTH_URL}/avatar"

    logger.info(f"📤 Перемылаю аватарку {user['name']} в Ядро...")

    headers = {"Authorization": f"Bearer {user.get('token')}"}

    try:

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(target_url, headers=headers, files=files)

            if response.status_code == 401:
                request.session.clear()
                if json_mode:
                    return unauthorized_json()
                return RedirectResponse(url="/login?error=session_expired", status_code=303)

            if response.status_code == 200:
                result = response.json()
                avatar_url = result.get("avatar_url")

                if avatar_url:
                    user["avatar_url"] = avatar_url
                    request.session["user"] = user
                    logger.success(f"✅ Аватар успешно сохранен Ядром. URL: {avatar_url}")
                    if json_mode:
                        return {"status": "success", "avatar_url": avatar_url}
                    return RedirectResponse(url="/profile", status_code=303)
                else:
                    logger.error(f"❌ Ядро вернуло 200, но не преслало avatar_url")
                    if json_mode:
                        return JSONResponse(
                            status_code=502,
                            content={
                                "error": True,
                                "errorType": "BackendError",
                                "message": "Ядро не вернуло avatar_url",
                            },
                        )
                    return RedirectResponse(url="/profile?error=beckend_error", status_code=303)
            else:
                body_text = (response.text or "")[:500]
                error_type = "UploadRejected"
                message = "Ядро отклонило файл"
                try:
                    err = response.json()
                    if isinstance(err, dict):
                        message = str(err.get("message") or err.get("error") or message)
                        error_type = str(err.get("errorType") or err.get("error_type") or error_type)
                except Exception:
                    if body_text:
                        message = body_text
                logger.error(
                    f"❌ Ядро отклонило файл. Статус: {response.status_code} | Body: {body_text}"
                )
                if json_mode:
                    return JSONResponse(
                        status_code=response.status_code,
                        content={
                            "error": True,
                            "errorType": error_type,
                            "message": message,
                        },
                    )
                return RedirectResponse(url="/profile?error=upload_rejected", status_code=303)

    except Exception as e:
        logger.error(f"❌ Ошибка связи с ядром при отправке файла: {e}")
        if json_mode:
            return JSONResponse(
                status_code=503,
                content={
                    "error": True,
                    "errorType": "CoreUnavailable",
                    "message": "Игровое ядро временно недоступно",
                },
            )
        return RedirectResponse(url="/profile?error=server_down", status_code=303)


@router.post("/api/profile/nickname")
async def update_nickname(request: Request, data: NicknameRequest):
    user = require_user(request)
    if not user:
        return unauthorized_json()

    user_id = user.get("user_id")
    target_url = f"{settings.JAVA_AUTH_URL}/{user_id}/nickname"
    payload = {"new_nickname": data.new_nickname}

    logger.info(f"🔄 Запрос на смену ника: {user['name']} -> {data.new_nickname}")

    response = await java_request("PATCH", target_url, request, json_data=payload)

    status = getattr(response, 'status_code', None)
    logger.info(f"Java-ответ: Статус: {status}")

    if not response or response.status_code == 401:
        return unauthorized_json()
    
    if response.status_code == 200:
        user['name'] = data.new_nickname
        request.session["user"] = user
        logger.success(f"✅ Ник успешно изменен на {data.new_nickname}")
        return {"status": "success", "new_nickname": data.new_nickname}

    else:
        error_text = "Unknown error"
        try:
            error_text = response.json().get("error", response.text)
        except:
            error_text = response.text
        logger.error(f"❌ При смене ника произошла ошибка: {error_text}")
        return {"error": error_text}


@router.get("/api/profile")
async def api_profile(request: Request):
    current_user = require_user(request)
    if not current_user:
        return unauthorized_json()

    stats_data = await _load_profile_stats(request, current_user)
    return {
        "user": _profile_user_json(current_user),
        "stats": stats_data,
        "java_host": settings.FRONTEND_JAVA_HOST,
    }


@router.get("/profile", response_class=HTMLResponse)
async def page_profile(request: Request):
    current_user = require_user(request)
    if not current_user:
        return RedirectResponse(url="/login", status_code=303)

    if spa_enabled():
        return spa_index_response()

    stats_data = await _load_profile_stats(request, current_user)

    context = {
        "user": current_user,
        "stats": stats_data,
        "v": settings.APP_VERSION
    }

    return templates.TemplateResponse(request=request, name="profile.html", context=context)


@router.get("/api/session/me")
async def session_me(request: Request):
    """Cookie-only session snapshot for the SPA. Does not call Java."""
    user = require_user(request)
    if not user:
        return unauthorized_json()

    return {
        "user_id": str(user.get("user_id")),
        "name": user.get("name"),
        "avatar_url": user.get("avatar_url") or "",
        "wallet_balance": int(user.get("wallet_balance") or 0),
        "java_host": settings.FRONTEND_JAVA_HOST,
    }


@router.get("/api/session/token")
async def get_session_token(request: Request):
    user = require_user(request)
    if not user:
        return unauthorized_json()

    balance_url = f"{settings.JAVA_AUTH_URL}/{user['user_id']}/balance"
    balance_res = await java_request("GET", balance_url, request)

    if is_core_unreachable(balance_res):
        return core_unreachable_json()

    if balance_res.status_code == 401:
        request.session.clear()
        return unauthorized_json()

    wallet_balance = int(user.get("wallet_balance") or 0)
    if balance_res.status_code == 200:
        new_balance = balance_res.json().get("wallet_balance")
        if new_balance is not None:
            sync_user_wallet(request, int(new_balance))
            wallet_balance = int(new_balance)
            user = require_user(request) or user

    return {
        "token": user.get("token"),
        "wallet_balance": wallet_balance
    }


async def _logout_java_and_clear_session(request: Request) -> None:
    user = require_user(request)

    if user:
        user_name = user.get("name", "Unknown")
        logger.info(f"🚪 Игрок с ником {user_name} пытается закончить сессию...")

        logout_url = f"{settings.JAVA_AUTH_URL}/logout"

        try:
            logout_response = await java_request(
                "POST", logout_url, request, json_data={"user_id": user.get("user_id")}
            )
            if logout_response and logout_response.status_code == 200:
                logger.success(f"🥷 Игрок с ником {user_name} успешно закончил сессию.")
            else:
                status = logout_response.status_code if logout_response else "No Response"
                logger.warning(
                    f"По неизвестной причине игрок с ником {user_name} не смог закончить сессию, status_code {status}"
                )
        except Exception as e:
            logger.error(f"🚫 БЕК-СЕРВЕР НЕ В СОСТОЯНИИ ОБРАБАТЫВАТЬ ЗАПРОСЫ {e}")

    request.session.clear()
    logger.info("👌 BFF сессия была очищена")


@router.post("/api/logout")
async def api_logout(request: Request):
    await _logout_java_and_clear_session(request)
    return {"status": "success"}


@router.get("/logout")
async def logout(request: Request):
    await _logout_java_and_clear_session(request)
    return RedirectResponse(url="/login", status_code=303)