import re
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc
from datetime import datetime, timezone

from .config import settings
from .database import get_db, init_db
from .models import User, Favorite, Playlist, History
from .security import verify_telegram_data
from .spotify_client import spotify_client
from .stream_extractor import extract_stream_url
from .wave_generator import generate_wave
from .lyrics_client import get_lyrics


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Spotiffy TMA API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/me")
async def get_me(user: User = Depends(verify_telegram_data)):
    return {
        "telegram_id": user.telegram_id,
        "username": user.username,
        "first_name": user.first_name,
        "photo_url": user.photo_url,
        "is_premium": user.is_premium,
        "created_at": user.created_at.isoformat(),
    }


@app.get("/api/home")
async def get_home(user: User = Depends(verify_telegram_data)):
    new_releases, featured = await asyncio.gather(
        spotify_client.get_new_releases(20),
        spotify_client.get_featured_playlists(10),
    )
    return {"new_releases": new_releases, "featured_playlists": featured}


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=1),
    type: str = Query("track,artist,album"),
    user: User = Depends(verify_telegram_data),
):
    return await spotify_client.search(q, type)


@app.get("/api/stream")
async def stream(
    track_id: str = Query(...),
    artist: str = Query(...),
    title: str = Query(...),
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    result = await extract_stream_url(artist, title)
    if not result:
        raise HTTPException(status_code=404, detail="Audio stream not found")
    db.add(History(user_id=user.id, track_id=track_id, title=title, artist=artist))
    await db.commit()
    return result


@app.get("/api/lyrics")
async def lyrics(
    track_name: str = Query(...),
    artist_name: str = Query(...),
    album_name: str = Query(""),
    duration: int = Query(0),
    user: User = Depends(verify_telegram_data),
):
    return await get_lyrics(track_name, artist_name, album_name, duration)


@app.get("/api/my-wave")
async def my_wave(
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    return {"tracks": await generate_wave(user, db)}


@app.get("/api/artist/{artist_id}")
async def get_artist(artist_id: str, user: User = Depends(verify_telegram_data)):
    return await spotify_client.get_artist_details(artist_id)


@app.get("/api/favorites")
async def get_favorites(
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Favorite).where(Favorite.user_id == user.id).order_by(desc(Favorite.added_at))
    )
    return [
        {"id": f.id, "track_id": f.track_id, "title": f.title,
         "artist": f.artist, "cover_url": f.cover_url, "added_at": f.added_at.isoformat()}
        for f in result.scalars().all()
    ]


@app.post("/api/favorites")
async def add_favorite(
    body: dict = Body(...),
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(Favorite).where(
            Favorite.user_id == user.id, Favorite.track_id == body["track_id"]
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already in favorites")
    db.add(Favorite(
        user_id=user.id, track_id=body["track_id"],
        title=body["title"], artist=body["artist"], cover_url=body.get("cover_url"),
    ))
    await db.commit()
    return {"status": "added"}


@app.delete("/api/favorites/{track_id}")
async def remove_favorite(
    track_id: str,
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(Favorite).where(Favorite.user_id == user.id, Favorite.track_id == track_id)
    )
    await db.commit()
    return {"status": "removed"}


@app.get("/api/playlists")
async def get_playlists(
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Playlist).where(Playlist.user_id == user.id).order_by(desc(Playlist.created_at))
    )
    return [
        {"id": p.id, "title": p.title, "cover_url": p.cover_url,
         "tracks_count": len(p.tracks) if p.tracks else 0}
        for p in result.scalars().all()
    ]


@app.post("/api/playlists/import")
async def import_playlist(
    body: dict = Body(...),
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    url = body.get("url", "")
    match = re.search(r"playlist/([a-zA-Z0-9]+)", url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid Spotify playlist URL")
    playlist_id = match.group(1)
    try:
        pl_data, tracks = await asyncio.gather(
            spotify_client._get(f"/playlists/{playlist_id}"),
            spotify_client.parse_playlist(playlist_id),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    cover_url = pl_data.get("images", [{}])[0].get("url") if pl_data.get("images") else None
    playlist = Playlist(
        user_id=user.id, title=pl_data.get("name", "Imported Playlist"),
        cover_url=cover_url, tracks=tracks,
    )
    db.add(playlist)
    await db.commit()
    await db.refresh(playlist)
    return {"id": playlist.id, "title": playlist.title, "cover_url": playlist.cover_url, "tracks": tracks}


@app.get("/api/playlists/{playlist_id}")
async def get_playlist(
    playlist_id: int,
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Playlist).where(Playlist.id == playlist_id, Playlist.user_id == user.id)
    )
    playlist = result.scalar_one_or_none()
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"id": playlist.id, "title": playlist.title,
            "cover_url": playlist.cover_url, "tracks": playlist.tracks}
