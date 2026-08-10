from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from .models import User, Favorite, History
from .spotify_client import spotify_client

DEFAULT_GENRES = ["pop", "hip-hop", "electronic", "indie", "r-n-b"]


async def generate_wave(user: User, db: AsyncSession) -> list:
    fav_result = await db.execute(
        select(Favorite)
        .where(Favorite.user_id == user.id)
        .order_by(desc(Favorite.added_at))
        .limit(5)
    )
    favorites = fav_result.scalars().all()
    seed_tracks = [f.track_id for f in favorites]
    seed_genres = DEFAULT_GENRES[:3] if not seed_tracks else []

    two_hours_ago = datetime.now(timezone.utc) - timedelta(hours=2)
    hist_result = await db.execute(
        select(History.track_id)
        .where(History.user_id == user.id)
        .where(History.played_at >= two_hours_ago)
    )
    recent_ids = set(hist_result.scalars().all())

    tracks = await spotify_client.get_recommendations(
        seed_tracks=seed_tracks, seed_genres=seed_genres, limit=30
    )
    return [t for t in tracks if t["id"] not in recent_ids][:20]
