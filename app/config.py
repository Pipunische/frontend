import os
import time
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):

    JAVA_HOST: str 

    SESSION_KEY: str 

    FRONTEND_JAVA_HOST: str

    JAVA_PROTOCOL: str = "http"

    APP_VERSION: int = int(time.time())

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