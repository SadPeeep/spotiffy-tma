import httpx

LRCLIB_URL = "https://lrclib.net/api/get"


async def get_lyrics(
    track_name: str, artist_name: str, album_name: str = "", duration: int = 0
) -> dict:
    params = {"track_name": track_name, "artist_name": artist_name}
    if album_name:
        params["album_name"] = album_name
    if duration:
        params["duration"] = duration

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(LRCLIB_URL, params=params)
            if response.status_code == 404:
                return {"synced": None, "plain": None, "has_synced": False}
            response.raise_for_status()
            data = response.json()
            return {
                "synced": data.get("syncedLyrics"),
                "plain": data.get("plainLyrics"),
                "has_synced": bool(data.get("syncedLyrics")),
            }
        except Exception:
            return {"synced": None, "plain": None, "has_synced": False}
