import time
import os
import uuid
import boto3
import requests
from fastapi import FastAPI, Request, Form, UploadFile, File
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware


S3_ENDPOINT = os.getenv("S3_ENDPOINT", "https://yourendpoint.r2.cloudflarestorage.com")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "your_access_key")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "your_secret_key")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "polupoker-avatars")

s3_client = boto3.client(
    's3',
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY
)

app = FastAPI()

APP_VERSION = int(time.time())

app.add_middleware(SessionMiddleware, secret_key="alexei_pipunesco", max_age=604800)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

JAVA_HOST = "192.168.0.68"
JAVA_URL = f"http://{JAVA_HOST}:8080/api/tables"


def extract_cards(player: dict) -> list:
    cards = player.get("cards")
    if isinstance(cards, list):
        return cards
    return []


class ActionRequest(BaseModel):
    user_id: str
    name: str
    type: str
    amount: int


@app.get("/", response_class=HTMLResponse)
def page_home(request: Request):
    current_user = request.session.get("user")

    context = {
        "club_name": "PoluPoker",
        "creator_name": "Pipunishche",
        "user": current_user
    }
    return templates.TemplateResponse(
        request=request, name="clear_home.html", context=context
    )
# -----------------------

@app.post("/api/upload-avatar")
async def upload_avatar(request: Request, avatar: UploadFile = File(...)):
    user = request.session.get("user")
    if not user:
        return RedirectResponse(url="/login", status_code=303)
    
    if not avatar.content_type.startswith("image/"):
        return RedirectResponse(url="/profile?error=invalid_file", status_code=303)

    user_id = user.get("user_id")
    file_ext = avatar.filename.split(".")[-1]

    new_filename = f"{user_id}_{uuid.uuid4().hex[:8]}.{file_ext}"

    try:
        s3_client.upload_fileobj(
            avatar.file,
            S3_BUCKET_NAME,
            new_filename,
            ExtraArgs={'ContentType': avatar.content_type, 'ACL': 'public-read'}
        )
        print(f"☁️ Аватар загружен в облако: {new_filename}", flush=True)
    except Exception as e:
        print(f"💥 Ошибка загрузки в S3: {e}", flush=True)
        return RedirectResponse(url="/profile?error=s3_failed", status_code=303)

    public_url = f"{S3_ENDPOINT}/{S3_BUCKET_NAME}/{new_filename}"

    update_url = f"http://{JAVA_HOST}:8080/api/auth/update-avatar"
    payload = {"user_id": user_id, "avatar_url": public_url}

    java_res = java_request("POST", update_url, request, json_data=payload)

    if not java_res or java_res.status_code == 401:
        return RedirectResponse(url="/login?error=session_expired", status_code=303)

    if java_res.ok:
        user["avatar_url"] = public_url
        request.session["user"] = user
        print(f"✅ Java принял ссылку на аватар!")
    else:
        print(f"❌ Ядро не обновило аватар: {java_res.text}", flush=True)

    return RedirectResponse(url="/profile", status_code=303)
# -----------------------

@app.get("/lobby", response_class=HTMLResponse)
def page_lobby(request: Request, error: str = None):

    current_user = request.session.get("user")
    if not current_user:
        return RedirectResponse(url="/login", status_code=303)

    balance_url = f"http://{JAVA_HOST}:8080/api/auth/{current_user['user_id']}/balance"
    balance_res = java_request("GET", balance_url, request)

    if not balance_res or balance_res.status_code == 401:
        print("🚨 При обновлении сессии возникли ошибки. Отправляю в login...")
        request.session.clear()
        return RedirectResponse(url="/login?error=session_expired", status_code=303)

    if balance_res.status_code == 200:
        new_balance = balance_res.json().get("wallet_balance")
        if new_balance is not None:
            current_user["wallet_balance"] = new_balance
            request.session["user"] = current_user
            print(f"💰 Баланс успешно получен: {new_balance}", flush=True)
    
    is_down = False
    tables_data = []

    tables_res = java_request("GET", JAVA_URL, request)

    if tables_res and tables_res.status_code == 200:
        tables_data = tables_res.json()
    else:
        print(f"🛑 При получении столов произошла ошибка: {tables_res.status_code if tables_res else 'No response'}")
        is_down = True

    context = {
        "tables": tables_data,
        "is_server_down": is_down,
        "user": current_user,
        "user_token": current_user.get("token") or "",
        "error": error,
        "java_host": JAVA_HOST,
        "v": APP_VERSION
    }

    return templates.TemplateResponse(request=request, name="clear_lobby.html", context=context)
 # -----------------------   

# ребай
@app.post("/table/{table_id}/rebuy")
def rebuy_process(table_id: str, request: Request, amount: int = Form(...)):
    user = request.session.get("user")
    if not user: return {"error": "unauthorized", "redirect": "/login"}

    target_url = f"{JAVA_URL}/{table_id}/rebuy" 
    payload = {"user_id": user.get("user_id"), "amount": amount}

    print(f"🚀 ШЛЮ РЕБАЙ НА БЕКЕНД: {payload}", flush=True)

    response = java_request("POST", target_url, request, json_data=payload)

    if not response or response.status_code == 401:
        return {"redirect": "/login?error=session_expired"}

    if response.ok:
        data = response.json()
        user["wallet_balance"] = data.get("wallet_balance")
        user["chips"] = data.get("chips", user.get("chips", 0))
        request.session["user"] = user

        print(f"✅ Ребай на {amount} прошел успешно для {user.get('name')}", flush=True)
        return {"status": "success"}

    else:
        error_text = "Unknown error"
        try:
            error_text = response.json().get("error", response.text)
        except:
            error_text = response.text
        print(f"❌ БЕКЕНД ОТКАЗАЛ В РЕБАЕ: {error_text}", flush=True)
        return {"error": error_text}
# -----------------------

@app.get("/login", response_class=HTMLResponse)
def page_login(request: Request):
    return templates.TemplateResponse(request=request, name="login.html")

@app.post("/login")
def login_process(request: Request, login: str = Form(...), password: str = Form(...)): 
    print(f"🔑 Игрок с логином {login} пытается зайти", flush=True)
    login_url = f"http://{JAVA_HOST}:8080/api/auth/login"

    try:
        response = requests.post(login_url, json={"login": login, "password": password}, timeout=3) 

        if response.status_code == 200:         
            user_data = response.json()
            
            request.session["user"] = {
                "user_id": str(user_data.get("user_id")),
                "name": user_data.get("nickname"),
                "wallet_balance": user_data.get("wallet_balance"),
                "token": user_data.get("access_token"),
                "refresh_token": user_data.get("refresh_token")
            }

            print(f"🥷 Игрок {user_data.get('nickname')} успешно залогинился. Данные игрока:", user_data)
            return RedirectResponse(url="/lobby", status_code=303)

        else: 
            error_message = "Неверный логин или пароль"
            return templates.TemplateResponse(request=request, name="login.html", context={"error": error_message})  

    except Exception as e:
        print(f"🤣 БЕКЕНД УПАЛ ПРИ ЛОГИНЕ: {e}")
        return templates.TemplateResponse(request=request, name="login.html")
# -----------------------

@app.get("/register", response_class=HTMLResponse)
def page_registration(request: Request):
    return templates.TemplateResponse(request=request, name="registration.html")

@app.post("/register")
def registration_process(request: Request, nickname: str = Form(...), login: str = Form(...), password: str = Form(...)):
    print(f"Попытка регистрации с ником: {nickname} и логином {login}") 
    register_url = f"http://{JAVA_HOST}:8080/api/auth/register"

    try:
        payload = {"nickname": nickname, "login": login, "password": password} 
        response = requests.post(register_url, json=payload, timeout=3)

        if response.status_code == 200:
            user_data = response.json()

            request.session["user"] = {
                "user_id": str(user_data.get("user_id")),
                "name": user_data.get("nickname"),
                "wallet_balance": user_data.get("wallet_balance", 0),
                "token": user_data.get("access_token"),
                "refresh_token": user_data.get("refresh_token")
            }
            
            print(f"🥷 Игрок {user_data.get('nickname')} успешно прошел регистрацию. Данные игрока:", user_data)
            return RedirectResponse(url="/lobby", status_code=303)

        else:
            error_text = "Ошибка регистрации"
            try: error_text = response.json().get("error", response.text)
            except: error_text = response.text
            return templates.TemplateResponse(request=request, name="registration.html", context={"error": error_text})

    except Exception as e:
        print(f"🤣 БЕКЕНД УПАЛ ПРИ РЕГИСТРАЦИИ: {e}" )
        return templates.TemplateResponse(request=request, name="registration.html", context={"error": "Бек-сервер недоступен"})    
# -----------------------

def java_request(method, url, request: Request, json_data=None, params=None):
    user = request.session.get("user")
    if not user:
        return None
    
    headers = {"Authorization": f"Bearer {user.get('token')}"}

    res = requests.request(method, url, json=json_data, params=params, headers=headers, timeout=5)

    if res.status_code == 401 and user.get("refresh_token"):
        print(f"🔄 Access Token для {user['name']} истек. Попытка динамического обновления...")
        refresh_url = f"http://{JAVA_HOST}:8080/api/auth/refresh"
        refresh_payload = {"refresh_token": user.get("refresh_token")}

        refresh_res = requests.post(refresh_url, json=refresh_payload, timeout=3)

        if refresh_res.status_code == 200:
            new_tokens = refresh_res.json()

            user["token"] = new_tokens.get("access_token")

            if new_tokens.get("refresh_token"):
                user["refresh_token"] = new_tokens.get("refresh_token")

            request.session["user"] = user
            print("✅ Токен успешно обновлен. Пробую повторить запрос...")

            headers["Authorization"] = f"Bearer {user['token']}"
            return requests.request(method, url, json=json_data, params=params, headers=headers, timeout=5)
        
        else:
            
            print(f"🚨 ВЛАДОС ОТКАЗАЛ В РЕФРЕШЕ! Статус: {refresh_res.status_code}")
            print(f"📦 ТЕЛО ОТВЕТА ЯДРА: {refresh_res.text}")            
            print("🚨 Refresh Token истек - сессия закончена.", flush=True)
            print("🚨 Refresh Token истек - сессия закончена.")
            request.session.clear()
            return refresh_res

    return res
# -----------------------    


@app.post("/table/{table_id}/leave")
def leave_table(request: Request, table_id: str, user_id: str = Form(None)):
    user = request.session.get("user")
    action_user_id = user.get("user_id") if user else user_id
    user_name = user.get('name') if user else "Spectator"

    if not action_user_id:
        return RedirectResponse(url="/login", status_code=303)   
    
    target_url= f"{JAVA_URL}/{table_id}/leave"
    payload = {"user_id": action_user_id}

    print(f"🏃 Игрок с ником {user_name} запрашивает выход из стола {table_id}", flush=True)

    response = java_request("POST", target_url, request, json_data=payload)

    if response and response.ok:
        print(f"✅ Игрок с ником {user_name} успешно вышел со стола {table_id} в lobby", flush=True)
    else:
        status = response.status_code if response else "No response"
        print(f"🚫 БЕКЕНД НЕ ПОДТВЕРДИЛ ВЫХОД ИГРОКА С НИКОМ {user_name}. (Статус {status}), но игрок все равно был перемещен в lobby", flush=True)

    return {"status": "success", "redirect": "/lobby"}
# -----------------------

@app.get("/logout")
def logout(request: Request):
    user = request.session.get("user")

    if user:
        user_name = user.get('name', 'Unknown')
        print(f"🚪 Игрок с ником {user_name} пытается закончить сессию...", flush=True)

        logout_url = f"http://{JAVA_HOST}:8080/api/auth/logout"

        try:
            logout_response = java_request("POST", logout_url, request, json_data={"user_id": user.get('user_id')})
            if logout_response and logout_response.status_code == 200:
                print(f"🥷 Игрок с ником {user_name} успешно закончил сессию.")
            else:
                status = logout_response.status_code if logout_response else "No Response"
                print(f"По неизвестной причине игрок с ником {user_name} не смог закончить сессию, status_code {status}")
        except Exception as e:
            print(f"🚫 БЕК-СЕРВЕР НЕ В СОСТОЯНИИ ОБРАБАТЫВАТЬ ЗАПРОСЫ {e}")

    request.session.clear()
    print("👌 BFF сессия была очищена, а также был произведен редирект на login", flush=True)
    return RedirectResponse(url="/login", status_code=303)
# --------------------------------------------------------------------


@app.get("/table/{table_id}", response_class=HTMLResponse)
def page_table(request: Request, table_id: str, buy_in: int = 0):

    MY_USER = request.session.get("user")
    if not MY_USER:
        return RedirectResponse(url="/login", status_code=303)

    base_table_url = f"{JAVA_URL}/{table_id}"

    try:
        response = java_request("GET", base_table_url, request)

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
                min_required = game_state.get("min_buy_in", 0)
                wallet = int(MY_USER.get("wallet_balance", 0))

                if wallet >= min_required:

                    print(f"🚀 Игрок {MY_USER['name']} пытается сесть за стол с buy_in: {buy_in}")

                    final_buy_in = buy_in if buy_in >= min_required else min_required
                    join_data = {"user_id": my_id, "chips": final_buy_in, "token": MY_USER.get("token")}
                    join_res = java_request("POST", f"{base_table_url}/join", request, json_data=join_data)

                    if join_res and join_res.status_code == 200:
                        print("✅ Успешная посадка")
                        game_state = java_request("GET", base_table_url, request).json()
                    else:
                        return RedirectResponse(url="/lobby?error=join_failed", status_code=303)

                else:
                    print(f"⚠️ У игрока {MY_USER['name']} недостаточно средств для данного стола.")
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
            "java_host": JAVA_HOST,
            "v": APP_VERSION
        }

        if request.headers.get("accept") == "application/json":
            json_data = {k: v for k, v in context.items() if k != "request"}
            return JSONResponse(content=json_data)

        return templates.TemplateResponse(name="clear_index.html", context=context, request=request)

    except Exception as e:  
        print(f"💥 Стол упал: {e}", flush=True)
        return RedirectResponse(url="/lobby", status_code=303)
 # -----------------------

@app.post("/table/{table_id}/action")
def handle_action_(table_id: str, action: ActionRequest, request: Request):

    MY_USER = request.session.get("user")
    if not MY_USER:
        return {"error": "unauthorized", "redirect": "/login"} 

    target_url = f"{JAVA_URL}/{table_id}/action"
    payload = action.model_dump()
    print(f"📡 ВХОДЯЩИЙ ЭКШЕН: {action.type} от {MY_USER['name']}", flush=True)

    response = java_request("POST", target_url, request, json_data=payload)
    
    status = getattr(response, 'status_code', None)
    print(f"🎯 Итоговый статус в контроллере: {status}", flush=True)

    if response is None or status == 401:
        return {"redirect": "/login?error=session_expired"}

    if response.status_code != 200:
        error_text = "Unknown error"
        try:
            error_text = response.json().get("error", response.text) 
        except:
            error_text = response.text
        print(f"🚨 ОТКАЗ ЯДРА НА ДЕЙСТВИЕ ({response.status_code}): {error_text}", flush=True)
        return {"error": f"java error {response.status_code}", "detail": error_text}

    print(f"✅ Действие {action.type} успешно обработано Ядром", flush=True)
    return response.json()
# -----------------------

@app.get("/profile", response_class=HTMLResponse)
def page_profile(request: Request):
    current_user = request.session.get("user")
    if not current_user:
        return RedirectResponse(url="/login", status_code=303)
    
    context = {
        "user": current_user,
        "v": APP_VERSION
    }

    return templates.TemplateResponse(request=request, name="profile.html", context=context)


