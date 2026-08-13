import urllib.parse

from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from loguru import logger

from app.config import settings
from app.emote_shop import (
    emotes_dict,
    emotes_lottie_dict,
    enrich_java_shop_payload,
    get_session_owned_ids,
    java_emotes_unavailable,
    merge_owned_ids,
    owned_ids_for_user,
    panel_emotes_for_owned,
    premium_emote_ids,
    set_session_owned_ids,
)
from app.models import ActionRequest
from app.table_layouts import (
    build_opponent_seats_by_pos,
    get_opponent_pos_layout,
    normalize_max_players,
)
from app.services import (
    templates,
    java_request,
    extract_cards,
    core_unreachable_json,
    is_core_unreachable,
)

router = APIRouter(tags=["Game Tables"])


def _order_players(game_state: dict, my_id: str):
    dealer_idx = game_state.get("dealer_seat", -1)
    active_idx = game_state.get("current_turn_seat", -1)

    my_player = None
    my_cards = []
    others_raw = []

    for p in game_state.get("players", []):
        seat = p.get("seat_index", -1)
        p["is_dealer"] = (seat == dealer_idx)
        p["is_active_turn"] = (seat == active_idx)
        p["round_contribution"] = p.get("round_contribution", 0)
        p["avatar_url"] = p.get("avatar_url", "")

        real_cards = extract_cards(p)

        if str(p.get("user_id")) == my_id:
            my_player = p
            my_cards = real_cards
        else:
            state = game_state.get("state")
            if state == "SHOWDOWN":
                p["cards"] = real_cards
            elif state == "WAITING_FOR_PLAYERS":
                p["cards"] = []
            else:
                p["cards"] = ["card_back", "card_back"]
            others_raw.append(p)

    max_players = normalize_max_players(game_state.get("max_players"))
    max_opponents = max(max_players - 1, 0)

    ordered_others = [None] * max_opponents
    if my_player:
        hero_seat = my_player.get("seat_index", 0)
        for p in others_raw:
            opp_seat = p.get("seat_index", 0)
            relative_pos = (opp_seat - hero_seat - 1 + max_players) % max_players
            if 0 <= relative_pos < max_opponents:
                ordered_others[relative_pos] = p
    else:
        layout = get_opponent_pos_layout(max_players)
        for p in others_raw:
            seat = p.get("seat_index", 0)
            if seat in layout:
                ordered_others[layout.index(seat)] = p

    return my_player, my_cards, ordered_others


def _emote_panel_context(owned_ids: list[str] | None = None, *, include_mock: bool = False) -> dict:
    owned = merge_owned_ids(owned_ids, include_mock=include_mock)
    return {
        "owned_emote_ids": owned,
        "panel_emotes": panel_emotes_for_owned(owned, include_mock=include_mock),
        "emotes_dict": emotes_dict(include_mock=include_mock),
        "emotes_lottie_dict": emotes_lottie_dict(include_mock=include_mock),
    }


async def _resolve_owned_emotes(request: Request, my_user: dict) -> list[str]:
    """Prefer Java ownership; VIP accounts always get premium; else session/defaults."""
    session_owned = get_session_owned_ids(request.session)
    user_id = my_user.get("user_id")

    if my_user.get("token") == "fake_token":
        return owned_ids_for_user(
            user_id,
            get_session_owned_ids(request.session, include_mock=True),
            include_mock=True,
        )

    if not user_id:
        return session_owned

    target_url = f"{settings.BASE_JAVA_URL}/user/{user_id}/emotes"
    response = await java_request("GET", target_url, request)

    if is_core_unreachable(response) or java_emotes_unavailable(response):
        return owned_ids_for_user(user_id, session_owned)

    if response.status_code == 200:
        try:
            payload = enrich_java_shop_payload(response.json(), user_id=user_id)
            owned = payload.get("owned_emote_ids") or owned_ids_for_user(user_id, session_owned)
            set_session_owned_ids(request.session, owned)
            return owned
        except Exception as exc:
            logger.warning(f"Table emotes: failed to parse Java ownership: {exc}")

    return owned_ids_for_user(user_id, session_owned)


def _build_table_context(
    game_state: dict,
    table_id: str,
    my_user: dict,
    *,
    owned_emote_ids: list[str] | None = None,
    include_mock_emotes: bool = False,
) -> dict:
    my_id = str(my_user.get("user_id"))
    my_player, my_cards, ordered_others = _order_players(game_state, my_id)
    max_players = normalize_max_players(game_state.get("max_players"))
    seat_layout_opponents = get_opponent_pos_layout(max_players)
    opponent_seats_by_pos = build_opponent_seats_by_pos(ordered_others, max_players)
    game_with_size = {**game_state, "max_players": max_players}
    emote_ctx = _emote_panel_context(owned_emote_ids, include_mock=include_mock_emotes)

    return {
        "my_player": my_player,
        "ordered_others": ordered_others,
        "max_players": max_players,
        "seat_layout_opponents": seat_layout_opponents,
        "opponent_seats_by_pos": opponent_seats_by_pos,
        "game": game_with_size,
        "table_id": table_id,
        "table_name": game_state.get("table_name"),
        "user": my_user,
        "user_token": my_user.get("token") or "",
        "my_cards": my_cards,
        "community_cards": game_state.get("community_cards", []),
        "java_host": settings.FRONTEND_JAVA_HOST,
        "v": settings.APP_VERSION,
        "is_dev_table": False,
        **emote_ctx,
    }


def _table_state_json(context: dict) -> dict:
    return {k: v for k, v in context.items() if k != "request"}


async def load_table_context(
    request: Request,
    table_id: str,
    *,
    buy_in: int = 0,
    passcode: str = "",
    allow_join: bool = False,
):
    my_user = request.session.get("user")
    if not my_user:
        return None

    base_table_url = f"{settings.JAVA_TABLES_URL}/{table_id}"
    response = await java_request("GET", base_table_url, request)

    if is_core_unreachable(response):
        return {"error": "core_unreachable"}

    if response.status_code == 401:
        request.session.clear()
        return {"redirect": "/login?error=session_expired"}

    if response.status_code != 200:
        return {"redirect": "/lobby"}

    game_state = response.json()
    my_id = str(my_user.get("user_id"))
    current_player_ids = [str(p.get("user_id")) for p in game_state.get("players", [])]

    if my_id not in current_player_ids:
        if allow_join and buy_in > 0:
            min_required = int(game_state.get("min_buy_in", 0))
            wallet = int(my_user.get("wallet_balance", 0))

            if wallet >= min_required:
                logger.info(f"🚀 Игрок {my_user['name']} пытается сесть за стол с buy_in: {buy_in}")

                final_buy_in = buy_in if buy_in >= min_required else min_required
                join_data = {
                    "user_id": my_id,
                    "chips": final_buy_in,
                    "token": my_user.get("token"),
                    "passcode": passcode,
                }
                join_res = await java_request("POST", f"{base_table_url}/join", request, json_data=join_data)

                if is_core_unreachable(join_res):
                    return {"error": "core_unreachable"}

                if join_res and join_res.status_code == 200:
                    logger.success("✅ Успешная посадка")
                    java_res = await java_request("GET", base_table_url, request)
                    if is_core_unreachable(java_res):
                        return {"error": "core_unreachable"}
                    game_state = java_res.json()
                else:
                    try:
                        resp_json = join_res.json()
                        error_message = resp_json.get("message", "Ошибка посадки")
                        error_type = resp_json.get("errorType", "JoinError")
                    except Exception:
                        error_message = "Сервер отклонил посадку"
                        error_type = "JoinError"

                    logger.error(f"❌ Ошибка посадки: {error_type} - {error_message}")
                    safe_msg = urllib.parse.quote(error_message)
                    safe_type = urllib.parse.quote(error_type)
                    return {"redirect": f"/lobby?errorType={safe_type}&message={safe_msg}"}
            else:
                logger.warning(f"⚠️ У игрока {my_user['name']} недостаточно средств для данного стола.")
                return {"redirect": "/lobby?error=no_money"}
        else:
            return {"redirect": "/lobby", "error": "not_at_table"}

    my_user = request.session.get("user")
    owned_emote_ids = await _resolve_owned_emotes(request, my_user)
    context = _build_table_context(
        game_state,
        table_id,
        my_user,
        owned_emote_ids=owned_emote_ids,
    )
    return {"context": context}


def _respond_table_result(result, *, json_mode: bool):
    if result is None:
        if json_mode:
            return JSONResponse(
                status_code=401,
                content={"redirect": "/login?error=session_expired"},
            )
        return RedirectResponse(url="/login", status_code=303)

    if result.get("error") == "core_unreachable":
        if json_mode:
            return core_unreachable_json()
        return RedirectResponse(url="/lobby?error=server_down", status_code=303)

    redirect = result.get("redirect")
    if redirect:
        if json_mode:
            status_code = 401 if "login" in redirect else 403
            payload = {"redirect": redirect}
            if result.get("error"):
                payload["error"] = result["error"]
            return JSONResponse(status_code=status_code, content=payload)
        return RedirectResponse(url=redirect, status_code=303)

    context = result["context"]
    if json_mode:
        return JSONResponse(content=_table_state_json(context))

    return templates.TemplateResponse(name="table.html", context=context, request=result["request"])


@router.get("/dev-table", response_class=HTMLResponse)
async def dev_page_table(request: Request, size: int = 10, vip: int = 0):
    """
    Секретный эндпоинт для тестирования верстки без Java-бэкенда.
    Доступен по адресу: http://127.0.0.1:8000/dev-table?size=6
    Купленные эмодзи берутся из session (после магазина в /dev-lobby).
    ?vip=1 — открыть все VIP-эмодзи для превью панели.
    """
    from app.table_layouts import SEAT_LAYOUTS

    max_players = size if size in SEAT_LAYOUTS else 10
    max_opponents = max(max_players - 1, 0)

    mock_user = {
        "user_id": "17",
        "name": "ЕБУЕБАК",
        "wallet_balance": 50000,
        "token": "fake_token",
        "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=EBUEBAK",
    }

    mock_community_cards = ["As", "Kh", "10d"]

    mock_my_player = {
        "user_id": "17",
        "name": "ЕБУЕБАК",
        "seat_index": 0,
        "chips": 1500,
        "status": "ACTIVE",
        "is_dealer": True,
        "is_active_turn": True,
        "round_contribution": 100,
        "avatar_url": mock_user["avatar_url"],
    }

    bot_names = ["SiliVal", "Ivan99", "ProGamer", "Kicker", "Loser99", "Shark", "Fish", "Lucky", "Donk"]
    mock_players = [mock_my_player]

    for rel_idx in range(max_opponents):
        if rel_idx >= len(bot_names):
            break
        mock_players.append({
            "user_id": f"opp_{rel_idx}",
            "name": bot_names[rel_idx],
            "seat_index": rel_idx + 1,
            "chips": 1000 + (rel_idx * 350),
            "status": "ACTIVE",
            "is_dealer": False,
            "is_active_turn": False,
            "round_contribution": 50,
            "cards": ["card_back", "card_back"],
            "avatar_url": f"https://api.dicebear.com/7.x/avataaars/svg?seed={bot_names[rel_idx]}" if rel_idx % 2 == 0 else "",
        })

    mock_game = {
        "state": "FLOP",
        "pot": 150,
        "big_blind": 100,
        "max_players": max_players,
        "community_cards": mock_community_cards,
        "players": mock_players,
        "dealer_seat": 0,
        "current_turn_seat": 0,
        "time_to_act_ms": 15000,
    }

    # Keep wallet/owned from shop session when possible; only replace identity for table hero.
    existing_user = request.session.get("user") or {}
    if existing_user.get("wallet_balance") is not None:
        mock_user["wallet_balance"] = existing_user["wallet_balance"]
    request.session["user"] = mock_user

    session_owned = get_session_owned_ids(request.session, include_mock=True)
    owned_emote_ids = owned_ids_for_user(mock_user["user_id"], session_owned, include_mock=True)
    if vip:
        owned_emote_ids = merge_owned_ids(
            owned_emote_ids,
            premium_emote_ids(include_mock=True),
            include_mock=True,
        )

    context = _build_table_context(
        mock_game,
        "dev_table_777",
        mock_user,
        owned_emote_ids=owned_emote_ids,
        include_mock_emotes=True,
    )
    context["table_name"] = f"Dev {max_players}-max"
    context["my_cards"] = ["Ah", "Ac"]
    context["is_dev_table"] = True

    return templates.TemplateResponse(name="table.html", context=context, request=request)


@router.get("/table/{table_id}", response_class=HTMLResponse)
async def page_table(request: Request, table_id: str, buy_in: int = 0, passcode: str = ""):
    json_mode = request.headers.get("accept") == "application/json"

    try:
        result = await load_table_context(
            request,
            table_id,
            buy_in=buy_in,
            passcode=passcode,
            allow_join=not json_mode,
        )
        result["request"] = request
        return _respond_table_result(result, json_mode=json_mode)
    except Exception as e:
        logger.error(f"💥 Стол упал: {e}")
        if json_mode:
            return core_unreachable_json("Не удалось загрузить состояние стола")
        return RedirectResponse(url="/lobby", status_code=303)


@router.get("/api/table/{table_id}/state")
async def api_table_state(request: Request, table_id: str):
    try:
        result = await load_table_context(request, table_id, allow_join=False)
        return _respond_table_result(result, json_mode=True)
    except Exception as e:
        logger.error(f"💥 API стола упало: {e}")
        return core_unreachable_json("Не удалось загрузить состояние стола")


@router.get("/api/table/{table_id}/events")
async def api_table_events(request: Request, table_id: str, since: int = 0):
    my_user = request.session.get("user")
    if not my_user:
        return JSONResponse(
            status_code=401,
            content={"redirect": "/login?error=session_expired"},
        )

    target_url = f"{settings.JAVA_TABLES_URL}/{table_id}/events"
    response = await java_request("GET", target_url, request, params={"since": since})

    if is_core_unreachable(response):
        return core_unreachable_json("Не удалось получить пропущенные события")

    if response.status_code == 401:
        return JSONResponse(
            status_code=401,
            content={"redirect": "/login?error=session_expired"},
        )

    if response.status_code != 200:
        try:
            payload = response.json()
        except Exception:
            payload = {"error": response.text}
        return JSONResponse(status_code=response.status_code, content=payload)

    return response.json()


@router.post("/table/{table_id}/action")
async def handle_action_(table_id: str, action: ActionRequest, request: Request):
    my_user = request.session.get("user")
    if not my_user:
        return {"error": "unauthorized", "redirect": "/login"}

    target_url = f"{settings.JAVA_TABLES_URL}/{table_id}/action"
    payload = action.model_dump()
    logger.info(f"📡 ВХОДЯЩИЙ ЭКШЕН: {action.type} от {my_user['name']}")

    response = await java_request("POST", target_url, request, json_data=payload)

    status = getattr(response, "status_code", None)
    logger.info(f"🎯 Итоговый статус в контроллере: {status}")

    if is_core_unreachable(response):
        return {
            "error": True,
            "errorType": "CoreUnavailable",
            "message": "Игровое ядро временно недоступно",
            "retry": True,
        }

    if status == 401:
        return {"redirect": "/login?error=session_expired"}

    if response.status_code != 200:
        try:
            resp_json = response.json()
            error_message = resp_json.get("message", response.text)
            error_type = resp_json.get("errorType", "UnknownError")
        except Exception:
            error_message = response.text
            error_type = "UnknownError"

        logger.error(f"🚨 ОТКАЗ ЯДРА НА ДЕЙСТВИЕ ({response.status_code}): {error_type} - {error_message}")
        return {"error": True, "errorType": error_type, "message": error_message}

    logger.success(f"✅ Действие {action.type} успешно обработано Ядром")
    return response.json()


@router.post("/table/{table_id}/rebuy")
async def rebuy_process(table_id: str, request: Request, amount: int = Form(...)):
    user = request.session.get("user")
    if not user:
        return {"error": "unauthorized", "redirect": "/login"}

    target_url = f"{settings.JAVA_TABLES_URL}/{table_id}/rebuy"
    payload = {"user_id": user.get("user_id"), "amount": amount}

    logger.info(f"🚀 ШЛЮ РЕБАЙ НА БЕКЕНД: {payload}")

    response = await java_request("POST", target_url, request, json_data=payload)

    if is_core_unreachable(response):
        return {
            "error": True,
            "errorType": "CoreUnavailable",
            "message": "Игровое ядро временно недоступно",
            "retry": True,
        }

    if response.status_code == 401:
        return {"redirect": "/login?error=session_expired"}

    if response.status_code == 200:
        data = response.json()
        user["wallet_balance"] = data.get("wallet_balance")
        user["chips"] = data.get("chips", user.get("chips", 0))
        request.session["user"] = user

        logger.success(f"✅ Ребай на {amount} прошел успешно для {user.get('name')}")
        return {"status": "success"}

    try:
        resp_json = response.json()
        error_message = resp_json.get("message", response.text)
        error_type = resp_json.get("errorType", "UnknownError")
    except Exception:
        error_message = response.text
        error_type = "UnknownError"

    logger.error(f"❌ БЕКЕНД ОТКАЗАЛ В РЕБАЕ: {error_type} - {error_message}")
    return {"error": True, "errorType": error_type, "message": error_message}


@router.post("/table/{table_id}/leave")
async def leave_table(request: Request, table_id: str, user_id: str = Form(None)):
    user = request.session.get("user")
    action_user_id = user.get("user_id") if user else user_id
    user_name = user.get("name") if user else "Spectator"

    if not action_user_id:
        return RedirectResponse(url="/login", status_code=303)

    target_url = f"{settings.JAVA_TABLES_URL}/{table_id}/leave"
    payload = {"user_id": action_user_id}

    logger.info(f"🏃 Игрок с ником {user_name} запрашивает выход из стола {table_id}")

    response = await java_request("POST", target_url, request, json_data=payload)

    if is_core_unreachable(response):
        return {
            "error": True,
            "errorType": "CoreUnavailable",
            "message": "Игровое ядро временно недоступно",
            "retry": True,
            "redirect": "/lobby",
        }

    if response and response.status_code == 200:
        logger.success(f"✅ Игрок с ником {user_name} успешно вышел со стола {table_id} в lobby")
        return {"status": "success", "redirect": "/lobby"}

    try:
        resp_json = response.json()
        error_message = resp_json.get("message", "No response")
        error_type = resp_json.get("errorType", "UnknownError")
    except Exception:
        error_message = response.text if response else "No response"
        error_type = "UnknownError"

    logger.error(f"🚫 БЕКЕНД НЕ ПОДТВЕРДИЛ ВЫХОД ИГРОКА С НИКОМ {user_name}. ({error_type}): {error_message}")

    return {"error": True, "errorType": error_type, "message": error_message, "redirect": "/lobby"}
