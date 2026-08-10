import os
import re
import time
import base64
import asyncio
from contextlib import asynccontextmanager
from urllib.parse import urlencode
from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, desc
from datetime import datetime, timezone
import httpx

from .config import settings
from .database import get_db, init_db
from .models import User, Favorite, Playlist, History, SpotifyToken
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
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Telegram-Init-Data", "Authorization"],
)


# -----------------------------------------------
# Health
# -----------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/spotify-debug")
async def spotify_debug():
    try:
        await spotify_client._ensure_token()
        data = await spotify_client._search_single_type("test", "track", 1)
        return {
            "status": "ok",
            "token_ok": True,
            "search_ok": bool(data.get("tracks")),
            "client_id_prefix": settings.SPOTIFY_CLIENT_ID[:6] + "...",
        }
    except Exception as e:
        return {"status": "error", "error": str(e), "type": type(e).__name__}


# -----------------------------------------------
# Spotify OAuth (Web Playback SDK)
# -----------------------------------------------

@app.get("/api/spotify/login")
async def spotify_login(user: User = Depends(verify_telegram_data)):
    """Return Spotify OAuth URL. Frontend opens it via tg.openLink()."""
    params = urlencode({
        "client_id": settings.SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.SPOTIFY_REDIRECT_URI,
        "scope": "streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state",
        "state": str(user.telegram_id),
    })
    auth_url = "https://accounts.spotify.com/authorize?" + params
    return {"auth_url": auth_url}


@app.get("/api/spotify/callback")
async def spotify_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Public: Spotify redirects here after user authorises."""
    if error or not code or not state:
        return HTMLResponse(
            "<html><body style='background:#121212;color:white;font-family:sans-serif;"
            "text-align:center;padding:50px'>"
            "<h2>\u274c \u041e\u0448\u0438\u0431\u043a\u0430 \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u0438.</h2>"
            "<p>\u0412\u0435\u0440\u043d\u0438\u0441\u044c \u0432 Telegram.</p>"
            "</body></html>"
        )
    try:
        telegram_id = int(state)
    except ValueError:
        return HTMLResponse("<h2>Bad state</h2>")

    creds = base64.b64encode(
        f"{settings.SPOTIFY_CLIENT_ID}:{settings.SPOTIFY_CLIENT_SECRET}".encode()
    ).decode()
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://accounts.spotify.com/api/token",
            headers={"Authorization": f"Basic {creds}"},
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.SPOTIFY_REDIRECT_URI,
            },
        )
    if resp.status_code != 200:
        return HTMLResponse(
            "<html><body style='background:#121212;color:white;font-family:sans-serif;"
            "text-align:center;padding:50px'>"
            "<h2>\u274c \u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u043e\u043b\u0443\u0447\u0435\u043d\u0438\u044f \u0442\u043e\u043a\u0435\u043d\u0430: "
            + str(resp.status_code) + "</h2>"
            "</body></html>"
        )

    token_data = resp.json()
    expires_at = time.time() + token_data["expires_in"]

    existing = await db.execute(
        select(SpotifyToken).where(SpotifyToken.telegram_id == telegram_id)
    )
    record = existing.scalar_one_or_none()
    if record:
        record.access_token = token_data["access_token"]
        if "refresh_token" in token_data:
            record.refresh_token = token_data["refresh_token"]
        record.expires_at = expires_at
    else:
        db.add(SpotifyToken(
            telegram_id=telegram_id,
            access_token=token_data["access_token"],
            refresh_token=token_data["refresh_token"],
            expires_at=expires_at,
        ))
    await db.commit()

    return HTMLResponse(
        "<html><body style='background:#121212;color:white;font-family:sans-serif;"
        "text-align:center;padding:60px 20px'>"
        "<div style='font-size:60px'>\u2705</div>"
        "<h2 style='color:#1DB954;margin-top:16px'>Spotify \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d!</h2>"
        "<p style='color:#aaa'>\u0412\u0435\u0440\u043d\u0438\u0441\u044c \u0432 Telegram \u0438 \u043d\u0430\u0436\u043c\u0438 \u043f\u043b\u0435\u0439.</p>"
        "<script>setTimeout(()=>window.close(),3000);</script>"
        "</body></html>"
    )


@app.get("/api/spotify/token")
async def get_spotify_token(
    user: User = Depends(verify_telegram_data),
    db: AsyncSession = Depends(get_db),
):
    """Return user's Spotify access token, refreshing if needed."""
    result = await db.execute(
        select(SpotifyToken).where(SpotifyToken.telegram_id == user.telegram_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        return {"connected": False}

    if time.time() > record.expires_at - 300:
        creds = base64.b64encode(
            f"{settings.SPOTIFY_CLIENT_ID}:{settings.SPOTIFY_CLIENT_SECRET}".encode()
        ).decode()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://accounts.spotify.com/api/token",
                headers={"Authorization": f"Basic {creds}"},
                data={"grant_type": "refresh_token", "refresh_token": record.refresh_token},
            )
        if resp.status_code == 200:
            data = resp.json()
            record.access_token = data["access_token"]
            record.expires_at = time.time() + data["expires_in"]
            if "refresh_token" in data:
                record.refresh_token = data["refresh_token"]
            await db.commit()

    return {
        "connected": True,
        "access_token": record.access_token,
        "expires_at": record.expires_at,
    }


# -----------------------------------------------
# User
# -----------------------------------------------

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
    results = await asyncio.gather(
        spotify_client.get_new_releases(20),
        spotify_client.get_featured_playlists(10),
        return_exceptions=True,
    )
    new_releases = results[0] if isinstance(results[0], list) else []
    featured = results[1] if isinstance(results[1], list) else []
    return {"new_releases": new_releases, "featured_playlists": featured}


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=1),
    type: str = Query("track,artist,album"),
    user: User = Depends(verify_telegram_data),
):
    try:
        return await spotify_client.search(q, type)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Spotify error: {str(e)}")


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
    try:
        tracks = await generate_wave(user, db)
        return {"tracks": tracks}
    except Exception:
        return {"tracks": []}


@app.get("/api/artist/{artist_id}")
async def get_artist(artist_id: str, user: User = Depends(verify_telegram_data)):
    return await spotify_client.get_artist_details(artist_id)


# -----------------------------------------------
# Favorites
# -----------------------------------------------

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


# -----------------------------------------------
# Playlists
# -----------------------------------------------

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
            spotify_client._get_one(f"/playlists/{playlist_id}", {}),
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
    return {"id": playlist.id, "title": playlist.title,
            "cover_url": playlist.cover_url, "tracks": tracks}


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


# Serve frontend — must be LAST
if os.path.isdir("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")
