"""Emote shop catalog and BFF helpers (Phase A/B)."""

from __future__ import annotations

import json
from typing import Any

EMOTE_CATALOG: list[dict[str, Any]] = [
    {
        "emote_id": "fire",
        "emoji": "🔥",
        "name": "Огонь",
        "price": 0,
        "is_default": True,
        "style_class": "",
    },
    {
        "emote_id": "cry",
        "emoji": "😭",
        "name": "Слёзы",
        "price": 0,
        "is_default": True,
        "style_class": "",
    },
    {
        "emote_id": "angry",
        "emoji": "🤬",
        "name": "Злость",
        "price": 0,
        "is_default": True,
        "style_class": "",
    },
    {
        "emote_id": "poop",
        "emoji": "💩",
        "name": "Какашка",
        "price": 0,
        "is_default": True,
        "style_class": "",
    },
    {
        "emote_id": "beer",
        "emoji": "🍻",
        "name": "Пивко",
        "price": 0,
        "is_default": True,
        "style_class": "",
    },
    {
        "emote_id": "clown",
        "emoji": "🤡",
        "name": "Клоун",
        "price": 0,
        "is_default": True,
        "style_class": "",
    },
    {
        "emote_id": "royal_crown",
        "emoji": "👑",
        "name": "Королевская корона",
        "price": 5_000,
        "is_default": False,
        "style_class": "emote-exclusive--crown",
    },
    {
        "emote_id": "diamond_hand",
        "emoji": "💎",
        "name": "Алмаз",
        "price": 10_000,
        "is_default": False,
        "style_class": "emote-exclusive--diamond",
    },
    {
        "emote_id": "goat_king",
        "emoji": "🐐",
        "name": "GOAT",
        "price": 25_000,
        "is_default": False,
        "style_class": "emote-exclusive--goat",
    },
]

CATALOG_BY_ID: dict[str, dict[str, Any]] = {
    item["emote_id"]: item for item in EMOTE_CATALOG
}

SESSION_OWNED_KEY = "owned_emote_ids"


def default_owned_emote_ids() -> list[str]:
    return [item["emote_id"] for item in EMOTE_CATALOG if item.get("is_default")]


def premium_emote_ids() -> list[str]:
    return [item["emote_id"] for item in EMOTE_CATALOG if not item.get("is_default")]


def emote_catalog_json() -> str:
    return json.dumps(EMOTE_CATALOG, ensure_ascii=False)


def emotes_dict() -> dict[str, str]:
    """Full id → emoji map so every client can render any emote over seats."""
    return {item["emote_id"]: item["emoji"] for item in EMOTE_CATALOG}


def emotes_dict_json() -> str:
    return json.dumps(emotes_dict(), ensure_ascii=False)


def panel_emotes_for_owned(owned_ids: list[str] | None = None) -> list[dict[str, Any]]:
    """Emotes shown in the table picker: defaults + purchased premium."""
    owned = set(owned_ids or default_owned_emote_ids())
    panel: list[dict[str, Any]] = []
    for item in EMOTE_CATALOG:
        if item.get("is_default") or item["emote_id"] in owned:
            panel.append(dict(item))
    return panel


def get_catalog_item(emote_id: str) -> dict[str, Any] | None:
    return CATALOG_BY_ID.get(emote_id)


def merge_owned_ids(*id_lists: list[str] | None) -> list[str]:
    merged = list(default_owned_emote_ids())
    for ids in id_lists:
        if not ids:
            continue
        for emote_id in ids:
            if emote_id and emote_id not in merged:
                merged.append(emote_id)
    return merged


def get_session_owned_ids(session: dict) -> list[str]:
    owned = session.get(SESSION_OWNED_KEY)
    if isinstance(owned, list) and owned:
        merged = list(default_owned_emote_ids())
        for emote_id in owned:
            if emote_id not in merged:
                merged.append(emote_id)
        return merged
    return default_owned_emote_ids()


def set_session_owned_ids(session: dict, owned_ids: list[str]) -> None:
    session[SESSION_OWNED_KEY] = list(owned_ids)


def build_client_catalog(owned_ids: list[str]) -> list[dict[str, Any]]:
    owned_set = set(owned_ids)
    catalog: list[dict[str, Any]] = []

    for item in EMOTE_CATALOG:
        entry = dict(item)
        entry["owned"] = item["emote_id"] in owned_set
        catalog.append(entry)

    return catalog


def build_shop_response(
    wallet_balance: int,
    owned_ids: list[str],
    *,
    source: str = "mock",
    price_paid: int | None = None,
    purchased_emote_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "success",
        "wallet_balance": int(wallet_balance),
        "owned_emote_ids": list(owned_ids),
        "catalog": build_client_catalog(owned_ids),
        "source": source,
    }
    if price_paid is not None:
        payload["price_paid"] = price_paid
    if purchased_emote_id is not None:
        payload["emote_id"] = purchased_emote_id
    return payload


def _pick_field(data: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return default


def enrich_java_shop_payload(java_data: dict[str, Any]) -> dict[str, Any]:
    wallet_balance = int(_pick_field(java_data, "wallet_balance", "walletBalance") or 0)
    owned_raw = _pick_field(java_data, "owned_emote_ids", "ownedEmoteIds")
    owned_ids = owned_raw if isinstance(owned_raw, list) else default_owned_emote_ids()
    owned_set = set(owned_ids)

    java_catalog = java_data.get("catalog")
    if isinstance(java_catalog, list) and java_catalog:
        catalog: list[dict[str, Any]] = []
        for row in java_catalog:
            emote_id = _pick_field(row, "emote_id", "emoteId")
            if not emote_id:
                continue
            front = dict(CATALOG_BY_ID.get(emote_id, {}))
            merged = {**front, **row, "emote_id": emote_id}
            merged["owned"] = bool(_pick_field(row, "owned")) or emote_id in owned_set
            catalog.append(merged)
    else:
        catalog = build_client_catalog(owned_ids)

    return build_shop_response(wallet_balance, owned_ids, source="java") | {
        "catalog": catalog,
    }


def mock_purchase(user: dict, owned_ids: list[str], emote_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    item = get_catalog_item(emote_id)
    if not item:
        return None, {
            "error": True,
            "errorType": "EmoteNotFound",
            "message": "Эмодзи не найден",
        }

    if item.get("is_default"):
        return None, {
            "error": True,
            "errorType": "EmoteNotPurchasable",
            "message": "Это базовое эмодзи, покупка не требуется",
        }

    if emote_id in owned_ids:
        return None, {
            "error": True,
            "errorType": "AlreadyOwned",
            "message": "Эмодзи уже куплен",
        }

    wallet_balance = int(user.get("wallet_balance") or 0)
    price = int(item.get("price") or 0)

    if wallet_balance < price:
        return None, {
            "error": True,
            "errorType": "InsufficientFunds",
            "message": "Недостаточно фишек для покупки",
        }

    new_wallet = wallet_balance - price
    new_owned = list(owned_ids)
    new_owned.append(emote_id)

    return (
        build_shop_response(
            new_wallet,
            new_owned,
            source="mock",
            price_paid=price,
            purchased_emote_id=emote_id,
        ),
        None,
    )


def java_emotes_unavailable(response) -> bool:
    if response is None:
        return True
    return response.status_code in (404, 501, 502, 503, 504)
