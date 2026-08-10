import asyncio
import base64
import time
from typing import Optional
import httpx
from .config import settings

DEFAULT_GENRES = ["pop", "hip-hop", "electronic"]


class SpotifyClient:
    BASE_URL = "https://api.spotify.com/v1"
    AUTH_URL = "https://accounts.spotify.com/api/token"

    def __init__(self):
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0
        self._client = httpx.AsyncClient(timeout=15.0)

    async def _ensure_token(self):
        if time.time() < self._token_expires_at - 60:
            return
        credentials = base64.b64encode(
            f"{settings.SPOTIFY_CLIENT_ID}:{settings.SPOTIFY_CLIENT_SECRET}".encode()
        ).decode()
        response = await self._client.post(
            self.AUTH_URL,
            headers={"Authorization": f"Basic {credentials}"},
            data={"grant_type": "client_credentials"},
        )
        response.raise_for_status()
        data = response.json()
        self._access_token = data["access_token"]
        self._token_expires_at = time.time() + data["expires_in"]

    async def _get(self, endpoint: str, params: dict = None) -> dict:
        await self._ensure_token()
        response = await self._client.get(
            f"{self.BASE_URL}{endpoint}",
            headers={"Authorization": f"Bearer {self._access_token}"},
            params=params or {},
        )
        response.raise_for_status()
        return response.json()

    def _format_track(self, track: dict) -> dict:
        return {
            "id": track["id"],
            "title": track["name"],
            "artist": ", ".join(a["name"] for a in track["artists"]),
            "artist_id": track["artists"][0]["id"] if track["artists"] else None,
            "album": track.get("album", {}).get("name", ""),
            "cover_url": (
                track["album"]["images"][0]["url"]
                if track.get("album", {}).get("images")
                else None
            ),
            "duration_ms": track["duration_ms"],
            "preview_url": track.get("preview_url"),
            "popularity": track.get("popularity", 0),
        }

    async def search(self, query: str, search_type: str = "track,artist,album", limit: int = 20) -> dict:
        data = await self._get("/search", {"q": query, "type": search_type, "limit": limit})
        result = {}
        if "tracks" in data:
            result["tracks"] = [self._format_track(t) for t in data["tracks"]["items"] if t]
        if "artists" in data:
            result["artists"] = [
                {
                    "id": a["id"],
                    "name": a["name"],
                    "genres": a.get("genres", []),
                    "popularity": a.get("popularity", 0),
                    "image_url": a["images"][0]["url"] if a.get("images") else None,
                    "followers": a.get("followers", {}).get("total", 0),
                }
                for a in data["artists"]["items"]
            ]
        if "albums" in data:
            result["albums"] = [
                {
                    "id": a["id"],
                    "title": a["name"],
                    "artist": ", ".join(ar["name"] for ar in a["artists"]),
                    "cover_url": a["images"][0]["url"] if a.get("images") else None,
                    "release_date": a.get("release_date"),
                    "total_tracks": a.get("total_tracks", 0),
                }
                for a in data["albums"]["items"]
            ]
        return result

    async def get_artist_details(self, artist_id: str) -> dict:
        artist_data, top_tracks_data, albums_data = await asyncio.gather(
            self._get(f"/artists/{artist_id}"),
            self._get(f"/artists/{artist_id}/top-tracks", {"market": "US"}),
            self._get(f"/artists/{artist_id}/albums", {"limit": 10, "include_groups": "album,single"}),
        )
        return {
            "id": artist_data["id"],
            "name": artist_data["name"],
            "genres": artist_data.get("genres", []),
            "popularity": artist_data.get("popularity", 0),
            "followers": artist_data.get("followers", {}).get("total", 0),
            "image_url": artist_data["images"][0]["url"] if artist_data.get("images") else None,
            "top_tracks": [self._format_track(t) for t in top_tracks_data.get("tracks", [])[:10]],
            "albums": [
                {
                    "id": a["id"],
                    "title": a["name"],
                    "cover_url": a["images"][0]["url"] if a.get("images") else None,
                    "release_date": a.get("release_date"),
                    "total_tracks": a.get("total_tracks", 0),
                }
                for a in albums_data.get("items", [])
            ],
        }

    async def get_recommendations(
        self, seed_tracks: list = None, seed_genres: list = None, limit: int = 20
    ) -> list:
        """
        /recommendations deprecated for new Spotify apps (Nov 2024).
        Uses search-based approach instead.
        """
        queries = []
        if seed_genres:
            for g in seed_genres[:2]:
                queries.append(f"genre:{g} top hits")
        if not queries:
            queries = ["top hits 2025", "best songs 2025"]

        all_tracks = []
        for q in queries:
            try:
                data = await self._get("/search", {"q": q, "type": "track", "limit": limit})
                tracks = [self._format_track(t) for t in data.get("tracks", {}).get("items", []) if t]
                all_tracks.extend(tracks)
                if len(all_tracks) >= limit:
                    break
            except Exception:
                continue

        if not all_tracks:
            # Hard fallback
            try:
                data = await self._get("/search", {"q": "top songs", "type": "track", "limit": limit})
                all_tracks = [self._format_track(t) for t in data.get("tracks", {}).get("items", []) if t]
            except Exception:
                pass

        # Deduplicate
        seen = set()
        result = []
        for t in all_tracks:
            if t["id"] not in seen:
                seen.add(t["id"])
                result.append(t)
        return result[:limit]

    async def parse_playlist(self, playlist_id: str) -> list:
        tracks = []
        offset = 0
        while True:
            data = await self._get(
                f"/playlists/{playlist_id}/tracks", {"limit": 100, "offset": offset}
            )
            for item in data.get("items", []):
                track = item.get("track")
                if track and track.get("id"):
                    tracks.append(self._format_track(track))
            if not data.get("next"):
                break
            offset += 100
        return tracks

    async def get_new_releases(self, limit: int = 20) -> list:
        """
        /browse/new-releases deprecated for new Spotify apps (Nov 2024).
        Uses multiple search queries to find recent albums.
        """
        queries = [
            "new album 2025",
            "new music 2025",
            "latest album 2025",
        ]
        all_albums = []
        seen_ids = set()

        for q in queries:
            try:
                data = await self._get("/search", {
                    "q": q,
                    "type": "album",
                    "limit": limit,
                })
                for a in data.get("albums", {}).get("items", []):
                    if a and a["id"] not in seen_ids:
                        seen_ids.add(a["id"])
                        all_albums.append({
                            "id": a["id"],
                            "title": a["name"],
                            "artist": ", ".join(ar["name"] for ar in a["artists"]),
                            "cover_url": a["images"][0]["url"] if a.get("images") else None,
                            "release_date": a.get("release_date"),
                        })
                if len(all_albums) >= limit:
                    break
            except Exception:
                continue

        # Sort by release date descending (most recent first)
        all_albums.sort(key=lambda x: x.get("release_date") or "", reverse=True)
        return all_albums[:limit]

    async def get_featured_playlists(self, limit: int = 10) -> list:
        """
        /browse/featured-playlists deprecated for new Spotify apps (Nov 2024).
        Uses search for popular playlists.
        """
        queries = ["top hits 2025", "best playlist 2025"]
        all_playlists = []
        seen_ids = set()

        for q in queries:
            try:
                data = await self._get("/search", {
                    "q": q,
                    "type": "playlist",
                    "limit": limit,
                })
                for p in data.get("playlists", {}).get("items", []):
                    if p and p["id"] not in seen_ids:
                        seen_ids.add(p["id"])
                        all_playlists.append({
                            "id": p["id"],
                            "title": p["name"],
                            "description": p.get("description", ""),
                            "cover_url": p["images"][0]["url"] if p.get("images") else None,
                            "tracks_total": p.get("tracks", {}).get("total", 0),
                        })
                if len(all_playlists) >= limit:
                    break
            except Exception:
                continue

        return all_playlists[:limit]


spotify_client = SpotifyClient()
