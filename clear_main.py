import requests
from fastapi import FastAPI, Request, Form
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware


app = FastAPI()

app.add_middleware(SessionMiddleware, secret_key="alexei_pipunesco")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

JAVA_HOST = "backend"
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
    context = {
        "club_name": "PoluPoker",
        "creator_name": "Project-X",
    }
    return templates.TemplateResponse(
        request=request, name="clear_home.html", context=context
    )


@app.get("/lobby", response_class=HTMLResponse)
def page_lobby(request: Request, error: str = None):

    current_user = request.session.get("user")
    if not current_user:
        return RedirectResponse(url="/login", status_code=303)

    is_down = False
    tables_data = []

    try:
        response = requests.get(JAVA_URL, timeout=3)
        if response.status_code == 200:
            tables_data = response.json()
        else:
            is_down = True
    except Exception as e:
        print(f"Нет лобби: {e}")
        is_down = True

    print("Данные о столах в лобби:", tables_data)
    context = {"tables": tables_data, "is_server_down": is_down, "user": current_user, "error": error}
    return templates.TemplateResponse(
        request=request, name="clear_lobby.html", context=context
    )

# ребай
@app.post("/table/{table_id}/rebuy")
async def rebuy_process(table_id: str, request: Request, amount: int = Form(...)):
    user = request.session.get("user")
    if not user: return {"error": "unauthorized"}

    target_url = f"{JAVA_URL}/{table_id}/rebuy" # проверка правильности адреса
    headers = {"Authorization": f"Bearer {user.get('token')}"} # проврка не ждет ли владос json

    try:
        payload = {"user_id": user.get("user_id"), "amount": amount} # проверить какой тип данных он ждет
        print(f"🚀 ШЛЮ РЕБАЙ ВЛАДОСУ: {payload}")
        response = requests.post(target_url, json=payload, headers=headers, timeout=5) 
        print(f"📥 ОТВЕТ ВЛАДОСА: Статус {response.status_code}, Текст: {response.text}")

        if response.ok:
            print(f"Статус от Ядра: {response.status_code}, Текст: {response.text}")
            data = response.json() # что возвращает владос

            user["wallet_balance"] = data.get("wallet_balance")
            user["chips"] = data.get("chips", user.get("chips", 0))

            request.session["user"] = user
            print(f"Ребай на {amount} успешен для {user.get('name')}")
            return {"status": "success"} # лог js скрипту
        else:
            print("ХУЙ ТЕБЕ")
            return {"error": f"ядро отказало: {response.text}"}
    except Exception as e:
        print(f"ошибка ребая {e}")
        return {"error": "Connection lost"}

@app.get("/login", response_class=HTMLResponse)
def page_login(request: Request):
    return templates.TemplateResponse(request=request, name="login.html")


@app.post("/login")
def login_process(request: Request, login: str = Form(...), password: str = Form(...)): 
    print(f"Зашел логин:: {login}, пароль: [скрыто]")

    login_url = f"http://{JAVA_HOST}:8080/api/auth/login"

    try:
        response = requests.post(login_url, json={"login": login, "password": password}, timeout=3) 

        if response.status_code == 200:
            
            user_data = response.json()
            token = user_data.get("token")

            print("Данные от сервера: ", user_data)
            
            request.session["user"] = {
                "user_id": str(user_data.get("user_id")),
                "name": user_data.get("nickname"),
                "wallet_balance": user_data.get("wallet_balance"),
                "chips": 3000,
                "token": token
            }

            return RedirectResponse(url="/lobby", status_code=303)
        else: 

            error_message = "Неверный логин или пароль"
            return templates.TemplateResponse(request=request, name="login.html", context={"error": error_message})    
    except Exception as e:

        print(f"Ошибка соединения с ядром: {e}")
        return templates.TemplateResponse(request=request, name="login.html")


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
            token = user_data.get("token")
            print("Регистрация прошла успешно", user_data)

            request.session["user"] = {
                "user_id": str(user_data.get("user_id")),
                "name": user_data.get("nickname"),
                "wallet_balance": user_data.get("wallet_balance"),
                "chips": 3000,
                "token": token
            }

            return RedirectResponse(url="/lobby", status_code=303)
        else:

            error_message = f"Ошибка регистрации {response.text}"
            return templates.TemplateResponse(request=request, name="registration.html", context={"error": error_message})

    except Exception as e:

        print(f"Ошибка соединения с ядром: {e}" )
        return templates.TemplateResponse(request=request, name="registration.html", context={"error": "Ошибка сервера при регистрации"})


@app.post("/table/{table_id}/leave")
async def leave_table(request: Request, table_id: str):

    user = request.session.get("user")
    if not user:
        return RedirectResponse(url="/login", status_code=303)
        
    
    target_url= f"{JAVA_URL}/{table_id}/leave"

    try:
        headers = {"Authorization": f"Bearer {user.get('token')}"}        
        leave_response = requests.post(target_url, json={"user_id": user.get("user_id")}, headers=headers, timeout=2)
        print(f"Игрок {user.get('name')} встал из-за стола {table_id}") # заменить table_id на table_name
        if leave_response.status_code == 200:
            print("Успешно вышли")
        else:
            print(f"Непонятная ошибка, status_code {leave_response.status_code}")        
    except Exception as e:
        print(f"Ошибка при выходе из-за стола {e}")

    return {"status": "success", "redirect": "/lobby"}


@app.get("/logout")
async def logout(request: Request):

    user = request.session.get("user")
    if user:
        try:
            headers = {"Authorization": f"Bearer {user.get('token')}"}
            logout_response = requests.post(f"http://{JAVA_HOST}:8080/api/auth/logout", json={"user_id": user.get('user_id')}, headers=headers, timeout=2)
            if logout_response.status_code == 200:
                print("Успешно вышли")
            else:
                print(f"Непонятная ошибка, status_code {logout_response.status_code}")
        except Exception as e:
            print(f"Невозможность выхода {e}")

    request.session.clear()
    print("Игрок вышел из игры")
    return RedirectResponse(url="/login", status_code=303)


# --------------------------------------------------------------------


@app.get("/table/{table_id}", response_class=HTMLResponse)
def page_table(request: Request, table_id: str, buy_in: int = 0):

    MY_USER = request.session.get("user")
    if not MY_USER:
        return RedirectResponse(url="/login", status_code=303)

    base_table_url = f"{JAVA_URL}/{table_id}"
    try:
        response = requests.get(base_table_url, timeout=3)
        if response.status_code != 200:
            return RedirectResponse(url="/lobby", status_code=303)

        game_state = response.json()
            
        my_id = str(MY_USER.get("user_id"))    
        current_player_id = [str(p.get("user_id")) for p in game_state.get("players", [])]

        if my_id not in current_player_id:
            if buy_in > 0:
                print(f"Игрока {MY_USER.get('name')} нет за столом, садимся")
                print(f"игрок {MY_USER.get('name')} садится за стол с байином {buy_in}")
                final_buy_in = buy_in if buy_in > 0 else 2000                
                join_data = {
                    "user_id": my_id,
                    "chips": final_buy_in,
                    "token": MY_USER.get("token")
                }    
                print(f"📦 Содержимое MY_USER: {MY_USER}") 
        
                headers = {"Authorization": f"Bearer {MY_USER.get('token')}"}
                join_response = requests.post(f"{base_table_url}/join", json=join_data, headers=headers, timeout=2)

                if join_response.status_code == 200:
                    print("Успешная посадка")
                    game_state = requests.get(base_table_url, timeout=3).json()
                    return RedirectResponse(url=f"/table/{table_id}", status_code=303)
                else:
                    print(f"Владос не дал сесть: {join_response.code}")
                    return RedirectResponse(url="/lobby?error=join_failed", status_code=303)
            else:
                print(f"Игрок {MY_USER.get('name')} бомж или не захотел байин")
                
                try:
                    leave_url = f"{JAVA_URL}/{table_id}/leave"
                    headers = {"Authorization": f"Bearer {MY_USER.get('token')}"}
                    requests.post(leave_url, json={"user_id": my_id}, headers=headers, timeout=2)
                except Exception as e:
                    print(f"Не удалось дивнуть пидора {e}")

                return RedirectResponse(url="/lobby?error=session_ended", status_code=303)
        
        players_info = game_state.get("players", [])
        print("игроки инфа", players_info)

    except Exception as e:
        print(f"Ошибка: {e}")
        return RedirectResponse(url=f"/lobby/{table_id}", status_code=303)

    # инициализация из game_state dealer_id и current_turn_seat

    dealer_idx = game_state.get("dealer_seat", -1)
    active_idx = game_state.get("current_turn_seat", -1)

    my_cards = []
    others = []
    my_player = None
    community_cards = game_state.get("community_cards", []) 
    table_name = game_state.get("table_name")
    for i, p in enumerate(game_state.get("players", [])):
        p["is_dealer"] = (i == dealer_idx)
        p["is_active_turn"] = (i == active_idx)
        p["round_contribution"] = p.get("round_contribution", 0)
        real_cards = extract_cards(p)
        if str(p.get("user_id")) == str(MY_USER.get("user_id")):
            my_player = p
            my_cards = real_cards
        else:   
            state = game_state.get("state")
            if state == "WAITING_FOR_PLAYERS":
                p["cards"] = []
            elif state == "SHOWDOWN":             
                p["cards"] = real_cards
            else:
                p["cards"] = ["card_back", "card_back"]
            others.append(p)
    
    print("Информация по игре:", game_state)

    context = {
        "my_player": my_player,
        "others": others,   
        "game": game_state,
        "table_id": table_id,
        "table_name": table_name,
        "user": MY_USER,
        "my_cards": my_cards,
        "community_cards": community_cards,
    }
    return templates.TemplateResponse(name="clear_index.html", context=context, request=request)


@app.post("/table/{table_id}/action")
async def handle_action_(table_id: str, action: ActionRequest, request: Request):

    MY_USER = request.session.get("user")
    if not MY_USER:
        return {"error": "unauthorized", "redirect": "/login"} 

    target_url = f"{JAVA_URL}/{table_id}/action"
    try:
        print(f"Шлем java по адрессу: {target_url}")

        headers = {"Authorization": f"Bearer {MY_USER.get('token')}"}        
        response = requests.post(target_url, json=action.model_dump(), headers=headers, timeout=5)
        if response.status_code != 200:
            print(f"Ошибка java: {response.status_code}, {response.text}")
            return {
                "error": f"java error {response.status_code}",
                "detail": response.text,
            }
        print("Ставка успешно принята Джавой!")
        return response.json()
    except Exception as e:
        print(f"Обрыв связи при ставке: {e}")
        return {"error": "Connection lost", "detail": str(e)}


# новый функционал
