from pydantic import BaseModel, field_validator

from app.table_layouts import TABLE_SIZES_CUSTOM

class CreateTableRequest(BaseModel):
    name: str
    passcode: str | None = None
    chips: int
    min_players_num: int
    max_players_num: int
    small_blind: int
    big_blind: int

    @field_validator("max_players_num")
    @classmethod
    def validate_max_players_num(cls, value: int) -> int:
        if value not in TABLE_SIZES_CUSTOM:
            allowed = ", ".join(str(n) for n in TABLE_SIZES_CUSTOM)
            raise ValueError(f"max_players_num must be one of: {allowed}")
        return value

class NicknameRequest(BaseModel):
    new_nickname: str

class ActionRequest(BaseModel):
    user_id: str
    name: str
    type: str
    amount: int

class GoogleAuthRequest(BaseModel):
    token: str


class EmotePurchaseRequest(BaseModel):
    emote_id: str