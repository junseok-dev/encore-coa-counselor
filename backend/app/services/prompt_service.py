from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import PromptConfig, PromptVersion
from app.utils.crypto import decrypt_if_needed


PROMPT_DEFAULTS = {
    "counseling_prompt": ("상담 prompt", "default_counseling_prompt"),
    "response_improvement_prompt": ("답변 개선 운영 지침", "default_response_improvement_prompt"),
    "cancel_prompt": ("취소 prompt", "default_cancel_prompt"),
    "fallback_prompt": ("fallback prompt", "default_fallback_prompt"),
    "handoff_prompt": ("문의 유도 prompt", "default_handoff_prompt"),
}

RESPONSE_IMPROVEMENT_PROMPT_KEY = "response_improvement_prompt"
_response_prompt_override: ContextVar[str | None] = ContextVar(
    "response_prompt_override",
    default=None,
)


def _next_prompt_version(db: Session, prompt_key: str) -> int:
    latest = db.query(func.max(PromptVersion.version)).filter(
        PromptVersion.prompt_key == prompt_key
    ).scalar()
    return int(latest or 0) + 1


def _ensure_published_version(db: Session, prompt: PromptConfig) -> PromptVersion:
    current = db.query(PromptVersion).filter(
        PromptVersion.prompt_key == prompt.prompt_key,
        PromptVersion.status == "published",
    ).order_by(PromptVersion.version.desc()).first()
    if current and current.content == prompt.content:
        return current
    if current:
        current.status = "archived"
    version = PromptVersion(
        prompt_key=prompt.prompt_key,
        version=_next_prompt_version(db, prompt.prompt_key),
        content=prompt.content,
        status="published",
        change_reason="기존 운영 프롬프트 버전 등록",
        created_by="system",
        published_at=datetime.now(timezone.utc),
    )
    db.add(version)
    db.flush()
    return version


def seed_prompt_configs(db: Session) -> None:
    settings = get_settings()
    for prompt_key, (label, attr_name) in PROMPT_DEFAULTS.items():
        existing = db.query(PromptConfig).filter(PromptConfig.prompt_key == prompt_key).first()
        if existing:
            continue
        db.add(
            PromptConfig(
                prompt_key=prompt_key,
                label=label,
                content=getattr(settings, attr_name),
            )
        )
    db.flush()
    for prompt in db.query(PromptConfig).filter(PromptConfig.prompt_key.in_(PROMPT_DEFAULTS)).all():
        _ensure_published_version(db, prompt)
    db.commit()


def update_counseling_prompt(db: Session) -> None:
    settings = get_settings()
    record = db.query(PromptConfig).filter(PromptConfig.prompt_key == "counseling_prompt").first()
    if record:
        record.content = settings.default_counseling_prompt
    else:
        db.add(
            PromptConfig(
                prompt_key="counseling_prompt",
                label=PROMPT_DEFAULTS["counseling_prompt"][0],
                content=settings.default_counseling_prompt,
            )
        )
    db.commit()


def update_handoff_prompts(db: Session) -> None:
    """채널톡 연결 워딩(상담 운영시간 포함)을 강제로 default로 동기화."""
    settings = get_settings()
    for key, default_value in (
        ("cancel_prompt", settings.default_cancel_prompt),
        ("handoff_prompt", settings.default_handoff_prompt),
    ):
        record = db.query(PromptConfig).filter(PromptConfig.prompt_key == key).first()
        if record:
            record.content = default_value
        else:
            db.add(
                PromptConfig(
                    prompt_key=key,
                    label=PROMPT_DEFAULTS[key][0],
                    content=default_value,
                )
            )
    db.commit()


def _get_prompt_value(db: Session, prompt_key: str) -> str:
    prompt = db.query(PromptConfig).filter(PromptConfig.prompt_key == prompt_key).first()
    if prompt:
        return decrypt_if_needed(prompt.content) or ""
    default = PROMPT_DEFAULTS.get(prompt_key)
    return getattr(get_settings(), default[1]) if default else ""


def get_prompt_value(prompt_key: str) -> str:
    db = SessionLocal()
    try:
        return _get_prompt_value(db, prompt_key)
    finally:
        db.close()


def get_response_improvement_prompt() -> str:
    override = _response_prompt_override.get()
    if override is not None:
        return override
    return get_prompt_value(RESPONSE_IMPROVEMENT_PROMPT_KEY)


@contextmanager
def use_response_prompt_override(content: str):
    token = _response_prompt_override.set(content)
    try:
        yield
    finally:
        _response_prompt_override.reset(token)


def publish_prompt(
    db: Session,
    prompt_key: str,
    content: str,
    actor: str,
    change_reason: str | None = None,
) -> tuple[PromptConfig, PromptVersion]:
    normalized = content.strip()
    if not normalized:
        raise ValueError("프롬프트 내용은 비워둘 수 없습니다.")
    prompt = db.query(PromptConfig).filter(PromptConfig.prompt_key == prompt_key).first()
    if not prompt:
        raise ValueError("프롬프트를 찾을 수 없습니다.")
    db.query(PromptVersion).filter(
        PromptVersion.prompt_key == prompt_key,
        PromptVersion.status == "published",
    ).update({PromptVersion.status: "archived"}, synchronize_session=False)
    prompt.content = normalized
    version = PromptVersion(
        prompt_key=prompt_key,
        version=_next_prompt_version(db, prompt_key),
        content=normalized,
        status="published",
        change_reason=(change_reason or "운영 프롬프트 수정").strip(),
        created_by=actor,
        published_at=datetime.now(timezone.utc),
    )
    db.add(version)
    db.commit()
    db.refresh(prompt)
    db.refresh(version)
    return prompt, version


def list_prompt_versions(db: Session, prompt_key: str, limit: int = 10) -> list[PromptVersion]:
    return db.query(PromptVersion).filter(
        PromptVersion.prompt_key == prompt_key
    ).order_by(PromptVersion.version.desc()).limit(limit).all()


def serialize_prompt_version(version: PromptVersion) -> dict:
    return {
        "id": version.id,
        "prompt_key": version.prompt_key,
        "version": version.version,
        "content": version.content,
        "status": version.status,
        "change_reason": version.change_reason,
        "created_by": version.created_by,
        "created_at": version.created_at,
        "published_at": version.published_at,
    }


def serialize_prompt(prompt: PromptConfig) -> dict:
    return {
        "prompt_key": prompt.prompt_key,
        "label": prompt.label,
        "content": decrypt_if_needed(prompt.content) or "",
        "updated_at": prompt.updated_at,
    }
