import asyncio
from typing import Optional
import yt_dlp


async def extract_stream_url(artist: str, title: str) -> Optional[dict]:
    query = f"ytsearch1:{artist} - {title} audio"
    ydl_opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "noplaylist": True,
    }

    def _extract():
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(query, download=False)
                if info and "entries" in info:
                    info = info["entries"][0] if info["entries"] else None
                if not info:
                    return None
                stream_url = info.get("url")
                if not stream_url:
                    for fmt in info.get("formats", []):
                        if fmt.get("acodec") != "none" and fmt.get("url"):
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

    return await asyncio.to_thread(_extract)
