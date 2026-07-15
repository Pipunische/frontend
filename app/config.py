import time
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):

    JAVA_HOST: str 

    SESSION_KEY: str 

    APP_VERSION: int = int(time.time())

    @property
    def JAVA_URL(self) -> str:
        return f"https://{self.JAVA_HOST}/api/tables"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()