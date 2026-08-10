import hashlib
import hmac
import json
import urllib.parse
from fastapi import HTTPException, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from .config import settings
from .database import get_db
from .models import User


async def verify_telegram_data(
    x_telegram_init_data: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        parsed = dict(urllib.parse.parse_qsl(x_telegram_init_data, strict_parsing=True))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid init data format")

    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="Missing hash in init data")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", settings.BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise HTTPException(status_code=401, detail="Invalid Telegram signature")

    user_data = json.loads(parsed.get("user", "{}"))
    telegram_id = user_data.get("id")
    if not telegram_id:
        raise HTTPException(status_code=401, detail="Missing user data")

    result = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalar_one_or_none()

    if not user:
        user = User(
            telegram_id=telegram_id,
            username=user_data.get("username"),
            first_name=user_data.get("first_name"),
            photo_url=user_data.get("photo_url"),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return user
