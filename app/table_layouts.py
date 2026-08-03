"""Seat layout presets for variable table sizes (hero + opponents on pos-* slots)."""

TABLE_SIZES_CUSTOM = (2, 4, 6, 9, 10)
TABLE_SIZES_SYSTEM = (2, 6, 9, 10)
DEFAULT_MAX_PLAYERS = 10

# Opponent pos-* slot numbers per table size (hero is always pos-hero).
SEAT_LAYOUTS: dict[int, list[int]] = {
    2: [5],
    4: [3, 5, 7],
    6: [1, 3, 5, 7, 9],
    9: [1, 2, 3, 4, 6, 7, 8, 9],
    10: [1, 2, 3, 4, 5, 6, 7, 8, 9],
}


def normalize_max_players(value: int | None) -> int:
    if value is None:
        return DEFAULT_MAX_PLAYERS
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_MAX_PLAYERS
    if n in SEAT_LAYOUTS:
        return n
    return DEFAULT_MAX_PLAYERS


def get_opponent_pos_layout(max_players: int) -> list[int]:
    return SEAT_LAYOUTS.get(max_players, SEAT_LAYOUTS[DEFAULT_MAX_PLAYERS])


def pos_for_relative(relative_pos: int, max_players: int) -> int | None:
    layout = get_opponent_pos_layout(max_players)
    if 0 <= relative_pos < len(layout):
        return layout[relative_pos]
    return None


def build_opponent_seats_by_pos(ordered_others: list, max_players: int) -> dict[int, object | None]:
    layout = get_opponent_pos_layout(max_players)
    result: dict[int, object | None] = {}
    for rel_idx, pos_num in enumerate(layout):
        player = ordered_others[rel_idx] if rel_idx < len(ordered_others) else None
        result[pos_num] = player
    return result
