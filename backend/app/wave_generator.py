from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from .models import User, Favorite, History
from .spotify_client import spotify_client
import asyncio

DEFAULT_GENRES = ["pop", "hip-hop", "electronic", "indie", "r&b"]


async def generate_wave(user: User, db: AsyncSession) -> list:
    # Get recent history to exclude
    two_hours_ago = datetime.now(timezone.utc) - timedelta(hours=2)
    hist_result = await db.execute(
        select(History.track_id)
        .where(History.user_id == user.id)
        .where(History.played_at >= two_hours_ago)
    )
    recent_ids = set(hist_result.scalars().all())

    # Get favorites for personalization
    fav_result = await db.execute(
        select(Favorite)
        .where(Favorite.user_id == user.id)
        .order_by(desc(Favorite.added_at))
        .limit(5)
    )
    favorites = fav_result.scalars().all()

    tracks = []

    if favorites:
        # Search by favorite artists — reliable approach
        artists = list(dict.fromkeys(f.artist.split(",")[0].strip() for f in favorites))[:3]
        searches = [spotify_client.search(artist, "track", limit=15) for artist in artists]
        results = await asyncio.gather(*searches, return_exceptions=True)
        for result in results:
            if isinstance(result, dict) and result.get("tracks"):
                tracks.extend(result["tracks"])
        # Deduplicate
        seen = set()
        unique = []
        for t in tracks:
            if t["id"] not in seen:
                seen.add(t["id"])
                unique.append(t)
        tracks = unique

    # Fallback or supplement with genre searches if not enough tracks
    if len(tracks) < 10:
        genre_searches = [
            spotify_client.search(f"genre:{g} top hits", "track", limit=10)
            for g in DEFAULT_GENRES[:3]
        ]
        genre_results = await asyncio.gather(*genre_searches, return_exceptions=True)
        seen_ids = {t["id"] for t in tracks}
        for result in genre_results:
            if isinstance(result, dict) and result.get("tracks"):
                for t in result["tracks"]:
                    if t["id"] not in seen_ids:
                        seen_ids.add(t["id"])
                        tracks.append(t)

    # Final fallback
    if not tracks:
        result = await spotify_client.search("top hits 2025", "track", limit=30)
        tracks = result.get("tracks", [])

    # Exclude recently played
    filtered = [t for t in tracks if t["id"] not in recent_ids]
    return filtered[:20] if filtered else tracks[:20]
