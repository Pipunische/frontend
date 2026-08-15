import os
import time
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_app_version() -> str:
    """Cache-bust token for static assets (?v=). Prefer deploy env over process start time."""
    for key in ("APP_VERSION", "GIT_SHA", "GITHUB_SHA", "COMMIT_SHA"):
        value = os.getenv(key)
        if value and str(value).strip():
            return str(value).strip()
    return str(int(time.time()))


class Settings(BaseSettings):

    JAVA_HOST: str 

    SESSION_KEY: str 

    FRONTEND_JAVA_HOST: str

    JAVA_PROTOCOL: str = "http"

    SPA_DEV: bool = False
    SPA_DEV_ORIGIN: str = "http://127.0.0.1:5173"

    APP_VERSION: str = Field(default_factory=_resolve_app_version)

    @property
    def BASE_JAVA_URL(self) -> str:
        """Базовый URL до API (например: http://app:8080/api)"""
        return f"{self.JAVA_PROTOCOL}://{self.JAVA_HOST}/api"

    @property
    def JAVA_TABLES_URL(self) -> str:
        """URL для столов (например: http://app:8080/api/tables)"""
        return f"{self.BASE_JAVA_URL}/tables"

    @property
    def JAVA_AUTH_URL(self) -> str:
        """URL для авторизации (например: http://app:8080/api/auth)"""
        return f"{self.BASE_JAVA_URL}/auth"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()