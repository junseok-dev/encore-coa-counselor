"""관리자 화면에서 변경 가능한 채널톡 상담 연결 URL을 관리한다."""

from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import AppSetting

CHANNEL_TALK_URL_KEY = "channel_talk_url"
INITIAL_CHANNEL_TALK_URL = "https://encoreaicampus.channel.io/home"


def normalize_channel_talk_url(value: str | None) -> str:
    """빈 값은 기능 비활성화로 허용하고, 입력된 값은 HTTPS URL인지 검증한다."""
    normalized = (value or "").strip()
    if not normalized:
        return ""
    if len(normalized) > 2000:
        raise ValueError("상담 연결 URL은 2,000자 이하여야 합니다.")
    if any(character.isspace() for character in normalized):
        raise ValueError("상담 연결 URL에는 공백을 사용할 수 없습니다.")
    parsed = urlparse(normalized)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("https://로 시작하는 올바른 상담 연결 URL을 입력해 주세요.")
    return normalized


def get_channel_talk_url(db: Session) -> str:
    """DB 설정이 있으면 빈 값까지 그대로 적용하고, 없을 때만 환경변수를 사용한다."""
    row = db.get(AppSetting, CHANNEL_TALK_URL_KEY)
    if row is not None:
        return (row.value or "").strip()
    return (get_settings().channel_talk_url or "").strip()


def set_channel_talk_url(db: Session, value: str | None) -> str:
    normalized = normalize_channel_talk_url(value)
    row = db.get(AppSetting, CHANNEL_TALK_URL_KEY)
    if row is None:
        db.add(AppSetting(key=CHANNEL_TALK_URL_KEY, value=normalized))
    else:
        row.value = normalized
    db.commit()
    return normalized


def seed_initial_channel_talk_url(db: Session) -> bool:
    """최초 배포에만 현재 운영 URL을 저장하며 관리자 변경값은 덮어쓰지 않는다."""
    if db.get(AppSetting, CHANNEL_TALK_URL_KEY) is not None:
        return False
    db.add(AppSetting(key=CHANNEL_TALK_URL_KEY, value=INITIAL_CHANNEL_TALK_URL))
    db.commit()
    return True
