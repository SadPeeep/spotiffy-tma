from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    BOT_TOKEN: str
    SPOTIFY_CLIENT_ID: str
    SPOTIFY_CLIENT_SECRET: str
    SPOTIFY_REDIRECT_URI: str = "https://spotiffy-tma-production.up.railway.app/api/spotify/callback"
    DATABASE_URL: str = "sqlite+aiosqlite:///./spotify_tma.db"
    CORS_ORIGINS: List[str] = ["*"]
    # Твой личный Spotify Premium refresh token — все юзеры используют его для воспроизведения
    SPOTIFY_SERVER_REFRESH_TOKEN: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
