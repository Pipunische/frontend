"""Shared session / auth / wallet helpers for BFF routers."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.config import settings
from app.services import core_unreachable_json, enrich_user_wallet_display, is_core_unreachable, java_request

SESSION_EXPIRED_REDIRECT = "/login?error=session_expired"
DEFAULT_LOGIN_URL = "/login"
DEFAULT_CORE_DOWN_URL = "/lobby?error=server_down"


def unauthorized_json(redirect: str = SESSION_EXPIRED_REDIRECT, **extra: Any) -> JSONResponse:
    content: dict[str, Any] = {"redirect": redirect}
    if extra:
        content.update(extra)
    return JSONResponse(status_code=401, content=content)


def require_user(request: Request) -> dict | None:
    user = request.session.get("user")
    return user if user else None


def is_dev_mock_user(user: dict | None) -> bool:
    return bool(user and user.get("token") == "fake_token")


def sync_user_wallet(request: Request, wallet_balance: int) -> None:
    user = request.session.get("user")
    if not user:
        return
    user["wallet_balance"] = int(wallet_balance)
    enrich_user_wallet_display(user)
    request.session["user"] = user


async def refresh_wallet_from_java(request: Request, user: dict) -> int:
    balance_url = f"{settings.JAVA_AUTH_URL}/{user['user_id']}/balance"
    balance_res = await java_request("GET", balance_url, request)

    if balance_res and balance_res.status_code == 200:
        wallet_balance = balance_res.json().get("wallet_balance")
        if wallet_balance is not None:
            sync_user_wallet(request, int(wallet_balance))
            return int(wallet_balance)

    return int(user.get("wallet_balance") or 0)


def respond_page_or_json(
    result: dict | None,
    *,
    json_mode: bool,
    on_success: Callable[[dict], Any],
    unauth_page_url: str = DEFAULT_LOGIN_URL,
    core_down_page_url: str = DEFAULT_CORE_DOWN_URL,
) -> Any:
    """Shared None / core_unreachable / redirect handling for lobby + table loaders."""
    if result is None:
        if json_mode:
            return unauthorized_json()
        return RedirectResponse(url=unauth_page_url, status_code=303)

    if result.get("error") == "core_unreachable":
        if json_mode:
            return core_unreachable_json()
        return RedirectResponse(url=core_down_page_url, status_code=303)

    redirect = result.get("redirect")
    if redirect:
        if json_mode:
            status_code = 401 if "login" in redirect else 403
            payload: dict[str, Any] = {"redirect": redirect}
            if result.get("error"):
                payload["error"] = result["error"]
            return JSONResponse(status_code=status_code, content=payload)
        return RedirectResponse(url=redirect, status_code=303)

    return on_success(result)
