from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, String, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime, timezone
from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str] = mapped_column(String(255), nullable=True)
    photo_url: Mapped[str] = mapped_column(String(1024), nullable=True)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    favorites: Mapped[list["Favorite"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    playlists: Mapped[list["Playlist"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    history: Mapped[list["History"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class SpotifyToken(Base):
    """Stores Spotify OAuth tokens per Telegram user."""
    __tablename__ = "spotify_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    access_token: Mapped[str] = mapped_column(String(2048), nullable=False)
    refresh_token: Mapped[str] = mapped_column(String(2048), nullable=False)
    expires_at: Mapped[float] = mapped_column(Float, nullable=False)  # Unix timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class Favorite(Base):
    __tablename__ = "favorites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    track_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    artist: Mapped[str] = mapped_column(String(512), nullable=False)
    cover_url: Mapped[str] = mapped_column(String(1024), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    user: Mapped["User"] = relationship(back_populates="favorites")


class Playlist(Base):
    __tablename__ = "playlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    cover_url: Mapped[str] = mapped_column(String(1024), nullable=True)
    tracks: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    user: Mapped["User"] = relationship(back_populates="playlists")


class History(Base):
    __tablename__ = "history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    track_id: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=True)
    artist: Mapped[str] = mapped_column(String(512), nullable=True)
    played_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    user: Mapped["User"] = relationship(back_populates="history")
