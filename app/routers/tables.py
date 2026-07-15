from fastapi import APIRouter, Request, Form
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from loguru import logger

from app.config import settings
from app.models import ActionRequest
from app.services import templates, java_request, extract_cards

router = APIRouter(tags=["Game Tables"])

@router.get("/table/{table_id}", response_class=HTMLResponse)
async def page_table(request: Request, table_id: str, buy_in: int = 0):

    MY_USER = request.session.get("user")
    if not MY_USER:
        return RedirectResponse(url="/login", status_code=303)

    base_table_url = f"{settings.JAVA_URL}/{table_id}"

    try:
        response = await java_request("GET", base_table_url, request)

        if not response or response.status_code == 401:
            request.session.clear()
            return RedirectResponse(url="/login?error=session_expired", status_code=303)

        if response.status_code != 200:
            return RedirectResponse(url="/lobby", status_code=303)
    
        game_state = response.json()
        my_id = str(MY_USER.get("user_id"))
        current_player_id = [str(p.get("user_id")) for p in game_state.get("players", [])]

        if my_id not in current_player_id:
            if buy_in > 0 and request.headers.get("accept") != "application/json":
                min_required = int(game_state.get("min_buy_in", 0))
                wallet = int(MY_USER.get("wallet_balance", 0))

                if wallet >= min_required:

                    logger.info(f"🚀 Игрок {MY_USER['name']} пытается сесть за стол с buy_in: {buy_in}")

                    final_buy_in = buy_in if buy_in >= min_required else min_required
                    join_data = {"user_id": my_id, "chips": final_buy_in, "token": MY_USER.get("token")}
                    join_res = await java_request("POST", f"{base_table_url}/join", request, json_data=join_data)

                    if join_res and join_res.status_code == 200:
                        logger.success("✅ Успешная посадка")
                        game_state = await java_request("GET", base_table_url, request).json()
                    else:
                        return RedirectResponse(url="/lobby?error=join_failed", status_code=303)

                else:
                    logger.warning(f"⚠️ У игрока {MY_USER['name']} недостаточно средств для данного стола.")
                    return RedirectResponse(url="/lobby?error=no_money", status_code=303)

            else:
                if request.headers.get("accept") == "application/json":
                    return JSONResponse(content={"error": "not_at_table", "redirect": "/lobby"})
                return RedirectResponse(url="/lobby", status_code=303)

        dealer_idx = game_state.get("dealer_seat", -1)
        active_idx = game_state.get("current_turn_seat", -1)
        community_cards = game_state.get("community_cards", [])
        table_name = game_state.get("table_name")

        my_player = None
        my_cards = []
        others_raw = []

        for p in game_state.get("players", []):
            seat = p.get("seat_index", -1)
            p["is_dealer"] = (seat == dealer_idx)
            p["is_active_turn"] = (seat == active_idx)
            p["round_contribution"] = p.get("round_contribution", 0)

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

        ordered_others = [None] * 9
        if my_player:
            hero_seat = my_player.get("seat_index", 0)
            for p in others_raw:
                opp_seat = p.get("seat_index", 0)
                relative_pos = (opp_seat - hero_seat - 1 + 10) % 10
                if 0 <= relative_pos < 9:
                    ordered_others[relative_pos] = p
        else:
            for p in others_raw:
                seat = p.get("seat_index", 0)
                if 0 <= seat < 9:
                    ordered_others[seat] = p

        context = {
            "my_player": my_player,
            "ordered_others": ordered_others,
            "game": game_state,
            "table_id": table_id,
            "table_name": table_name,
            "user": MY_USER,
            "user_token": MY_USER.get("token") or "",
            "my_cards": my_cards,
            "community_cards": community_cards,
            "java_host": settings.JAVA_HOST,
            "v": settings.APP_VERSION
        }

        if request.headers.get("accept") == "application/json":
            json_data = {k: v for k, v in context.items() if k != "request"}
            return JSONResponse(content=json_data)

        return templates.TemplateResponse(name="clear_index.html", context=context, request=request)

    except Exception as e:  
        logger.error(f"💥 Стол упал: {e}")
        return RedirectResponse(url="/lobby", status_code=303)
# -----------------------------------
@router.post("/table/{table_id}/action")
async def handle_action_(table_id: str, action: ActionRequest, request: Request):

    MY_USER = request.session.get("user")
    if not MY_USER:
        return {"error": "unauthorized", "redirect": "/login"} 

    target_url = f"{settings.JAVA_URL}/{table_id}/action"
    payload = action.model_dump()
    logger.info(f"📡 ВХОДЯЩИЙ ЭКШЕН: {action.type} от {MY_USER['name']}")

    response = await java_request("POST", target_url, request, json_data=payload)
    
    status = getattr(response, 'status_code', None)
    logger.info(f"🎯 Итоговый статус в контроллере: {status}")

    if response is None or status == 401:
        return {"redirect": "/login?error=session_expired"}

    if response.status_code != 200:
        error_text = "Unknown error"
        try:
            error_text = response.json().get("error", response.text) 
        except:
            error_text = response.text
        logger.error(f"🚨 ОТКАЗ ЯДРА НА ДЕЙСТВИЕ ({response.status_code}): {error_text}")
        return {"error": f"java error {response.status_code}", "detail": error_text}

    logger.success(f"✅ Действие {action.type} успешно обработано Ядром")
    return response.json()
# -----------------------------------
@router.post("/table/{table_id}/rebuy")
async def rebuy_process(table_id: str, request: Request, amount: int = Form(...)):
    user = request.session.get("user")
    if not user: return {"error": "unauthorized", "redirect": "/login"}

    target_url = f"{settings.JAVA_URL}/{table_id}/rebuy" 
    payload = {"user_id": user.get("user_id"), "amount": amount}

    logger.info(f"🚀 ШЛЮ РЕБАЙ НА БЕКЕНД: {payload}")

    response = await java_request("POST", target_url, request, json_data=payload)

    if not response or response.status_code == 401:
        return {"redirect": "/login?error=session_expired"}

    if response.ok:
        data = response.json()
        user["wallet_balance"] = data.get("wallet_balance")
        user["chips"] = data.get("chips", user.get("chips", 0))
        request.session["user"] = user

        logger.success(f"✅ Ребай на {amount} прошел успешно для {user.get('name')}")
        return {"status": "success"}

    else:
        error_text = "Unknown error"
        try:
            error_text = response.json().get("error", response.text)
        except:
            error_text = response.text
        logger.error(f"❌ БЕКЕНД ОТКАЗАЛ В РЕБАЕ: {error_text}")
        return {"error": error_text}
# -----------------------------------
@router.post("/table/{table_id}/leave")
async def leave_table(request: Request, table_id: str, user_id: str = Form(None)):
    user = request.session.get("user")
    action_user_id = user.get("user_id") if user else user_id
    user_name = user.get('name') if user else "Spectator"

    if not action_user_id:
        return RedirectResponse(url="/login", status_code=303)   
    
    target_url= f"{settings.JAVA_URL}/{table_id}/leave"
    payload = {"user_id": action_user_id}

    logger.info(f"🏃 Игрок с ником {user_name} запрашивает выход из стола {table_id}")

    response = await java_request("POST", target_url, request, json_data=payload)

    if response and response.ok:
        logger.success(f"✅ Игрок с ником {user_name} успешно вышел со стола {table_id} в lobby")
    else:
        status = response.status_code if response else "No response"
        logger.error(f"🚫 БЕКЕНД НЕ ПОДТВЕРДИЛ ВЫХОД ИГРОКА С НИКОМ {user_name}. (Статус {status}), но игрок все равно был перемещен в lobby")

    return {"status": "success", "redirect": "/lobby"}