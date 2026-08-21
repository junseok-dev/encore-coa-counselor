"""관리자 화면에서 추가·수정·삭제 가능한 과정별 완성형 추적 URL을 관리한다."""

import json
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import AppSetting

LINK_TRACKING_URLS_KEY = "course_tracking_urls"
DEFAULT_TRACKING_LINKS = [
    {
        "label": "코스 허브페이지",
        "url": "https://encorecampus.ai/course?utm_source=chatbot&utm_medium=referral&utm_campaign=course",
    },
    {
        "label": "오케스트레이션",
        "url": "https://encorecampus.ai/orchestration?utm_source=chatbot&utm_medium=referral&utm_campaign=orchestration",
    },
    {
        "label": "머신러닝 엔지니어",
        "url": "https://encorecampus.ai/ml?utm_source=chatbot&utm_medium=referral&utm_campaign=ml",
    },
    {
        "label": "MLOps 엔지니어",
        "url": "https://encorecampus.ai/mlops?utm_source=chatbot&utm_medium=referral&utm_campaign=mlops",
    },
]


def _validate_tracking_link(item: dict[str, str]) -> dict[str, str]:
    label = str(item.get("label") or "").strip()
    url = str(item.get("url") or "").strip()
    if not label:
        raise ValueError("과정 이름을 입력해 주세요.")
    if len(label) > 100:
        raise ValueError("과정 이름은 100자 이하여야 합니다.")
    if not url or len(url) > 2000 or any(character.isspace() for character in url):
        raise ValueError(f"{label} 추적 링크 형식을 확인해 주세요.")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or (parsed.hostname or "").lower() != "encorecampus.ai":
        raise ValueError("encorecampus.ai의 https 추적 링크만 등록할 수 있습니다.")
    if not parsed.path.strip("/"):
        raise ValueError(f"{label} 추적 링크에는 과정 경로가 필요합니다.")
    return {"label": label, "url": url}


def validate_tracking_links(values: list[dict[str, str]]) -> list[dict[str, str]]:
    if len(values) > 100:
        raise ValueError("추적 링크는 최대 100개까지 등록할 수 있습니다.")
    links = [_validate_tracking_link(item) for item in values]
    paths = [urlsplit(item["url"]).path.rstrip("/") for item in links]
    if len(paths) != len(set(paths)):
        raise ValueError("같은 과정 경로의 추적 링크를 중복 등록할 수 없습니다.")
    return links


def _deserialize_links(value: str | None) -> list[dict[str, str]] | None:
    try:
        parsed = json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, list):
        return None
    try:
        return validate_tracking_links(parsed)
    except (TypeError, ValueError):
        return None


def get_link_tracking_urls(db: Session | None = None) -> list[dict[str, str]]:
    """DB 목록을 우선 사용하고, 설정 전에는 전달받은 현재 4개 링크를 반환한다."""
    owns_session = db is None
    active_db = db or SessionLocal()
    try:
        row = active_db.get(AppSetting, LINK_TRACKING_URLS_KEY)
        links = _deserialize_links(row.value) if row is not None else None
        return links if links is not None else [dict(item) for item in DEFAULT_TRACKING_LINKS]
    finally:
        if owns_session:
            active_db.close()


def set_link_tracking_urls(db: Session, values: list[dict[str, str]]) -> list[dict[str, str]]:
    links = validate_tracking_links(values)
    serialized = json.dumps(links, ensure_ascii=False)
    row = db.get(AppSetting, LINK_TRACKING_URLS_KEY)
    if row is None:
        db.add(AppSetting(key=LINK_TRACKING_URLS_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()
    return links
