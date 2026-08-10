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
        self._client = httpx.AsyncClient(timeout=10.0)

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
        /recommendations is deprecated for new Spotify apps (Nov 2024).
        Replaced with search-based approach.
        """
        if seed_genres:
            genre = seed_genres[0]
            q = f"genre:{genre}"
        else:
            q = "year:2024-2025 tag:hipster"
        try:
            data = await self._get("/search", {"q": q, "type": "track", "limit": limit})
            tracks = [self._format_track(t) for t in data.get("tracks", {}).get("items", []) if t]
            if tracks:
                return tracks
        except Exception:
            pass
        data = await self._get("/search", {"q": "top hits 2025", "type": "track", "limit": limit})
        return [self._format_track(t) for t in data.get("tracks", {}).get("items", []) if t]

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
        /browse/new-releases is deprecated for new Spotify apps (Nov 2024).
        Replaced with search for recent albums.
        """
        try:
            data = await self._get("/search", {
                "q": "year:2025",
                "type": "album",
                "limit": limit,
            })
            return [
                {
                    "id": a["id"],
                    "title": a["name"],
                    "artist": ", ".join(ar["name"] for ar in a["artists"]),
                    "cover_url": a["images"][0]["url"] if a.get("images") else None,
                    "release_date": a.get("release_date"),
                }
                for a in data.get("albums", {}).get("items", []) if a
            ]
        except Exception:
            # Fallback: popular albums
            data = await self._get("/search", {
                "q": "top albums 2025",
                "type": "album",
                "limit": limit,
            })
            return [
                {
                    "id": a["id"],
                    "title": a["name"],
                    "artist": ", ".join(ar["name"] for ar in a["artists"]),
                    "cover_url": a["images"][0]["url"] if a.get("images") else None,
                    "release_date": a.get("release_date"),
                }
                for a in data.get("albums", {}).get("items", []) if a
            ]

    async def get_featured_playlists(self, limit: int = 10) -> list:
        """
        /browse/featured-playlists is deprecated for new Spotify apps (Nov 2024).
        Replaced with search for popular playlists.
        """
        data = await self._get("/search", {
            "q": "top hits 2025",
            "type": "playlist",
            "limit": limit,
        })
        return [
            {
                "id": p["id"],
                "title": p["name"],
                "description": p.get("description", ""),
                "cover_url": p["images"][0]["url"] if p.get("images") else None,
                "tracks_total": p.get("tracks", {}).get("total", 0),
            }
            for p in data.get("playlists", {}).get("items", []) if p
        ]


spotify_client = SpotifyClient()
