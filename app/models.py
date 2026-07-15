from pydantic import BaseModel

class CreateTableRequest(BaseModel):
    name: str
    passcode: str | None = None
    chips: int
    min_players_num: int
    max_players_num: int
    small_blind: int
    big_blind: int

class PasswordRequest(BaseModel):
    old_password: str
    new_password: str

class NicknameRequest(BaseModel):
    new_nickname: str

class ActionRequest(BaseModel):
    user_id: str
    name: str
    type: str
    amount: int

class GoogleAuthRequest(BaseModel):
    token: str