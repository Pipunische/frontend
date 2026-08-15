# PoluPoker SPA migration

Отдельная рабочая копия для переписывания UI на React, **без риска для прода**.

## Две папки

| Папка | Ветка | Назначение |
|---|---|---|
| `c:\Dev\Polupoker` | `test` | Прод и хотфиксы. Не трогать при SPA-работе. |
| `c:\Dev\Polupoker-spa` | `rewrite/spa` | Новый React-клиент + тот же FastAPI BFF. |

Обе папки — **один git-репозиторий** (worktree). История общая.

### Полезные команды

```powershell
# Список worktree
git -C c:\Dev\Polupoker worktree list

# Подтянуть хотфиксы из test в SPA-ветку
cd c:\Dev\Polupoker-spa
git fetch company test
git merge company/test

# Удалить worktree (когда SPA влита в test)
git -C c:\Dev\Polupoker worktree remove c:\Dev\Polupoker-spa
```

## Локальная разработка

Терминал 1 — BFF (скопируйте `.env` из prod-папки или свой dev):

```powershell
cd c:\Dev\Polupoker-spa
$env:SPA_DEV = "1"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Терминал 2 — React dev server:

```powershell
cd c:\Dev\Polupoker-spa\web
npm run dev
```

- SPA: http://127.0.0.1:5173  
- Legacy UI (Jinja): http://127.0.0.1:8000  

Vite проксирует `/api`, `/static`, `/logout` на BFF `:8000`.

## Структура

```
app/          FastAPI BFF (почти без изменений)
templates/    Legacy Jinja — не удалять до cutover
static/       Карты, CSS, Lottie
web/          Новый Vite + React + TypeScript
```

## Порядок миграции экранов

1. Login + session (`/api/auth/google`, `/api/session/token`)
2. Lobby + create table + WS
3. Table (STOMP/SockJS)
4. Profile + emote shop
5. Home

## Cutover на сервере

1. Собрать SPA: `cd web && npm run build`
2. Поднять **отдельный** контейнер `polupoker-bff-spa` на порту `8001`
3. Прогнать чеклист паритета со старым UI
4. Переключить nginx с `8000` на новый контейнер
5. PR `rewrite/spa` → `test`, только после проверки

**Не деплоить** эту ветку в текущий `polupoker-bff` на проде до cutover.
