import httpx
from fastapi import APIRouter, FastAPI, Request, Form, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse
from loguru import logger

from app.config import settings
from app.models import GoogleAuthRequest, NicknameRequest
from app.services import templates, java_request

router = APIRouter(tags=["Authentication & Profile"])

@router.get("/login", response_class=HTMLResponse)
async def page_login(request: Request, error: str = None):
    if request.session.get("user"):
        return RedirectResponse(url="/lobby", status_code=303)

    context = {"v": settings.APP_VERSION, "error": error}
    return templates.TemplateResponse(request=request, name="login.html", context=context)
# -----------------------------------
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
# -----------------------------------
@router.post("/api/upload-avatar")
async def upload_avatar(request: Request, avatar: UploadFile = File(...)):
    user = request.session.get("user")
    if not user:
        return RedirectResponse(url="/login", status_code=303)
    
    if not avatar.content_type.startswith("image/"):
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
                return RedirectResponse(url="/login?error=session_expired", status_code=303)

            if response.status_code == 200:
                result = response.json()
                avatar_url = result.get("avatar_url")

                if avatar_url:
                    user["avatar_url"] = avatar_url
                    request.session["user"] = user
                    logger.success(f"✅ Аватар успешно сохранен Ядром. URL: {avatar_url}")
                    return RedirectResponse(url="/profile", status_code=303)
                else:
                    logger.error(f"❌ Ядро вернуло 200, но не преслало avatar_url")
                    return RedirectResponse(url="/profile?error=beckend_error", status_code=303)
            else:
                logger.error(f"❌ Ядро отклонило файл. Статус: {response.status_code}")
                return RedirectResponse(url="/profile?error=upload_rejected", status_code=303)

    except Exception as e:
        logger.error(f"❌ Ошибка связи с ядром при отправке файла: {e}")
        return RedirectResponse(url="/profile?error=server_down", status_code=303)
# -----------------------------------
@router.post("/api/profile/nickname")
async def update_nickname(request: Request, data: NicknameRequest):
    user = request.session.get("user")
    if not user:
        return {"redirect": "/login?error=session_expired"}

    user_id = user.get("user_id")
    target_url = f"{settings.JAVA_AUTH_URL}/{user_id}/nickname"
    payload = {"new_nickname": data.new_nickname}

    logger.info(f"🔄 Запрос на смену ника: {user['name']} -> {data.new_nickname}")

    response = await java_request("PATCH", target_url, request, json_data=payload)

    status = getattr(response, 'status_code', None)
    logger.info(f"Java-ответ: Статус: {status}")

    if not response or response.status_code == 401:
        return {"redirect": "/login?error=session_expired"}
    
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
# -----------------------------------
@router.get("/profile", response_class=HTMLResponse)
async def page_profile(request: Request):
    current_user = request.session.get("user")
    if not current_user:
        return RedirectResponse(url="/login", status_code=303)

    user_id = current_user.get("user_id")

    stats_data = {
        "hands_played": 0,
        "total_won": 0,
        "win_ratio": 0,
        "biggest_pot": 0,
        "rank": "Sucker"
    }

    stats_url = f"{settings.BASE_JAVA_URL}/user/{user_id}/stats"
    stats_res = await java_request("GET", stats_url, request)

    if stats_res and stats_res.status_code == 200:
        stats_data = stats_res.json()
    else:
        err_msg = stats_res.text if stats_res else "No Response"
        status = stats_res.status_code if stats_res else "N/A"
        logger.error(f"Failed to fetch stats from Java | Status: {status} | URL: {stats_url} | Error: {err_msg}")

    context = {
        "user": current_user,
        "stats": stats_data,
        "v": settings.APP_VERSION
    }

    return templates.TemplateResponse(request=request, name="profile.html", context=context)
# -----------------------------------
@router.get("/logout")
async def logout(request: Request):
    user = request.session.get("user")

    if user:
        user_name = user.get('name', 'Unknown')
        logger.info(f"🚪 Игрок с ником {user_name} пытается закончить сессию...")

        logout_url = f"{settings.JAVA_AUTH_URL}/logout"

        try:
            logout_response = await java_request("POST", logout_url, request, json_data={"user_id": user.get('user_id')})
            if logout_response and logout_response.status_code == 200:
                logger.success(f"🥷 Игрок с ником {user_name} успешно закончил сессию.")
            else:
                status = logout_response.status_code if logout_response else "No Response"
                logger.warning(f"По неизвестной причине игрок с ником {user_name} не смог закончить сессию, status_code {status}")
        except Exception as e:
            logger.error(f"🚫 БЕК-СЕРВЕР НЕ В СОСТОЯНИИ ОБРАБАТЫВАТЬ ЗАПРОСЫ {e}")

    request.session.clear()
    logger.info("👌 BFF сессия была очищена, а также был произведен редирект на login")
    return RedirectResponse(url="/login", status_code=303)