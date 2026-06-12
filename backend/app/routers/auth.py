from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import get_db
from app.db.models import AdminUser

router = APIRouter()


class GoogleTokenRequest(BaseModel):
    credential: str


def create_access_token(email: str) -> str:
    payload = {
        "sub": email,
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=8),
    }
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


def is_authorized_email(email: str, db: Session) -> bool:
    settings = get_settings()
    if settings.admin_email and email == settings.admin_email:
        return True
    return db.query(AdminUser).filter(AdminUser.email == email).first() is not None


@router.post("/verify")
def verify_google_token(body: GoogleTokenRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(status_code=500, detail="Google OAuth 설정이 되어 있지 않습니다.")

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        idinfo = id_token.verify_oauth2_token(
            body.credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Google 인증에 실패했습니다.")

    email: str = idinfo.get("email", "")
    if not email or not idinfo.get("email_verified", False):
        raise HTTPException(status_code=401, detail="이메일 인증이 되지 않은 계정입니다.")

    if not is_authorized_email(email, db):
        raise HTTPException(status_code=403, detail="접근 권한이 없는 계정입니다. 관리자에게 문의하세요.")

    token = create_access_token(email)
    return {"token": token, "email": email}
