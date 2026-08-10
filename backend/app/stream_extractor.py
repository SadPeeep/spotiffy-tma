import asyncio
from typing import Optional
import yt_dlp


YDL_OPTS = {
    "format": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "extract_flat": False,
    "noplaylist": True,
    "socket_timeout": 20,
    "retries": 3,
    "http_headers": {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
    },
    # Skip age-gate / sign-in checks
    "age_limit": 99,
    "nocheckcertificate": True,
}


def _extract_sync(query: str) -> Optional[dict]:
    with yt_dlp.YoutubeDL(YDL_OPTS) as ydl:
        try:
            info = ydl.extract_info(query, download=False)
            if info and "entries" in info:
                entries = info.get("entries") or []
                info = entries[0] if entries else None
            if not info:
                return None

            stream_url = info.get("url")
            if not stream_url:
                # Try formats list
                for fmt in sorted(
                    info.get("formats", []),
                    key=lambda f: f.get("abr") or 0,
                    reverse=True,
                ):
                    if fmt.get("acodec") not in (None, "none") and fmt.get("url"):
                        stream_url = fmt["url"]
                        break

            if not stream_url:
                return None

            return {
                "stream_url": stream_url,
                "duration": info.get("duration"),
                "format": info.get("ext", "webm"),
                "title": info.get("title"),
                "youtube_id": info.get("id"),
            }
        except Exception:
            return None


async def extract_stream_url(artist: str, title: str) -> Optional[dict]:
    # Try several search query variants for best hit rate
    queries = [
        f"ytsearch1:{artist} - {title} official audio",
        f"ytsearch1:{artist} {title} audio",
        f"ytsearch1:{artist} {title}",
    ]
    for query in queries:
        result = await asyncio.to_thread(_extract_sync, query)
        if result and result.get("stream_url"):
            return result
    return None
