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
    {
        "emote_id": "piggy",
        "emoji": "🐷",
        "name": "Копилка",
        # BFF display price until Java catalog price is confirmed.
        "price": 15_000,
        "is_default": False,
        "style_class": "emote-lottie emote-exclusive--piggy",
        "lottie": "piggy.json",
    },
]

CATALOG_BY_ID: dict[str, dict[str, Any]] = {
    item["emote_id"]: item for item in EMOTE_CATALOG
}

SESSION_OWNED_KEY = "owned_emote_ids"
LOTTIE_STATIC_PREFIX = "/static/lottie"

# Hardcoded VIP accounts that get all premium emotes without purchase.
VIP_USER_IDS = {"17"}


def lottie_static_url(filename: str) -> str:
    name = (filename or "").lstrip("/")
    return f"{LOTTIE_STATIC_PREFIX}/{name}"


def enrich_emote_entry(item: dict[str, Any]) -> dict[str, Any]:
    entry = dict(item)
    if item.get("lottie"):
        entry["lottie_url"] = lottie_static_url(item["lottie"])
    return entry


def visible_catalog(*, include_mock: bool = False) -> list[dict[str, Any]]:
    return [
        enrich_emote_entry(item)
        for item in EMOTE_CATALOG
        if include_mock or not item.get("mock_only")
    ]


def default_owned_emote_ids(*, include_mock: bool = False) -> list[str]:
    return [
        item["emote_id"]
        for item in EMOTE_CATALOG
        if item.get("is_default") and (include_mock or not item.get("mock_only"))
    ]


def premium_emote_ids(*, include_mock: bool = False) -> list[str]:
    return [
        item["emote_id"]
        for item in EMOTE_CATALOG
        if not item.get("is_default") and (include_mock or not item.get("mock_only"))
    ]


def is_vip_user(user_id: Any) -> bool:
    return str(user_id or "") in VIP_USER_IDS


def owned_ids_for_user(
    user_id: Any,
    owned_ids: list[str] | None = None,
    *,
    include_mock: bool = False,
) -> list[str]:
    """Defaults + purchased, plus all premium for VIP accounts."""
    if is_vip_user(user_id):
        return merge_owned_ids(
            owned_ids,
            premium_emote_ids(include_mock=include_mock),
            include_mock=include_mock,
        )
    return merge_owned_ids(owned_ids, include_mock=include_mock)


def emote_catalog_json(*, include_mock: bool = False) -> str:
    return json.dumps(visible_catalog(include_mock=include_mock), ensure_ascii=False)


def emotes_dict(*, include_mock: bool = False) -> dict[str, str]:
    """Full id → emoji map so every client can render any emote over seats."""
    return {
        item["emote_id"]: item["emoji"]
        for item in EMOTE_CATALOG
        if include_mock or not item.get("mock_only")
    }


def emotes_lottie_dict(*, include_mock: bool = False) -> dict[str, str]:
    """emote_id → /static/lottie/*.json for animated assets."""
    return {
        item["emote_id"]: lottie_static_url(item["lottie"])
        for item in EMOTE_CATALOG
        if item.get("lottie") and (include_mock or not item.get("mock_only"))
    }


def emotes_dict_json(*, include_mock: bool = False) -> str:
    return json.dumps(emotes_dict(include_mock=include_mock), ensure_ascii=False)


def panel_emotes_for_owned(
    owned_ids: list[str] | None = None,
    *,
    include_mock: bool = False,
) -> list[dict[str, Any]]:
    """Emotes shown in the table picker: defaults + purchased premium."""
    owned = set(owned_ids or default_owned_emote_ids(include_mock=include_mock))
    panel: list[dict[str, Any]] = []
    for item in EMOTE_CATALOG:
        if item.get("mock_only") and not include_mock:
            continue
        if item.get("is_default") or item["emote_id"] in owned:
            panel.append(enrich_emote_entry(item))
    return panel


def get_catalog_item(emote_id: str) -> dict[str, Any] | None:
    return CATALOG_BY_ID.get(emote_id)


def merge_owned_ids(*id_lists: list[str] | None, include_mock: bool = False) -> list[str]:
    merged = list(default_owned_emote_ids(include_mock=include_mock))
    for ids in id_lists:
        if not ids:
            continue
        for emote_id in ids:
            if not emote_id or emote_id in merged:
                continue
            item = CATALOG_BY_ID.get(emote_id)
            if item and item.get("mock_only") and not include_mock:
                continue
            merged.append(emote_id)
    return merged


def get_session_owned_ids(session: dict, *, include_mock: bool = False) -> list[str]:
    owned = session.get(SESSION_OWNED_KEY)
    if isinstance(owned, list) and owned:
        return merge_owned_ids(owned, include_mock=include_mock)
    return default_owned_emote_ids(include_mock=include_mock)


def set_session_owned_ids(session: dict, owned_ids: list[str]) -> None:
    session[SESSION_OWNED_KEY] = list(owned_ids)


def build_client_catalog(owned_ids: list[str], *, include_mock: bool = False) -> list[dict[str, Any]]:
    owned_set = set(owned_ids)
    catalog: list[dict[str, Any]] = []

    for item in visible_catalog(include_mock=include_mock):
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
    include_mock: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": "success",
        "wallet_balance": int(wallet_balance),
        "owned_emote_ids": list(owned_ids),
        "catalog": build_client_catalog(owned_ids, include_mock=include_mock),
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


def enrich_java_shop_payload(
    java_data: dict[str, Any],
    *,
    user_id: Any = None,
) -> dict[str, Any]:
    wallet_balance = int(_pick_field(java_data, "wallet_balance", "walletBalance") or 0)
    owned_raw = _pick_field(java_data, "owned_emote_ids", "ownedEmoteIds")
    base_owned = owned_raw if isinstance(owned_raw, list) else default_owned_emote_ids()
    owned_ids = owned_ids_for_user(user_id, base_owned)
    owned_set = set(owned_ids)

    java_catalog = java_data.get("catalog")
    if isinstance(java_catalog, list) and java_catalog:
        catalog: list[dict[str, Any]] = []
        for row in java_catalog:
            emote_id = _pick_field(row, "emote_id", "emoteId")
            if not emote_id:
                continue
            front = CATALOG_BY_ID.get(emote_id) or {}
            if front.get("mock_only"):
                continue
            merged = enrich_emote_entry({**front, **row, "emote_id": emote_id})
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
            include_mock=True,
        ),
        None,
    )


def java_emotes_unavailable(response) -> bool:
    if response is None:
        return True
    return response.status_code in (404, 501, 502, 503, 504)
