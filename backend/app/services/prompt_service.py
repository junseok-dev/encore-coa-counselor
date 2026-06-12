from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import PromptConfig
from app.utils.crypto import decrypt_if_needed, maybe_encrypt


PROMPT_DEFAULTS = {
    "counseling_prompt": ("상담 prompt", "default_counseling_prompt"),
    "cancel_prompt": ("취소 prompt", "default_cancel_prompt"),
    "fallback_prompt": ("fallback prompt", "default_fallback_prompt"),
    "handoff_prompt": ("문의 유도 prompt", "default_handoff_prompt"),
}


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
                content=maybe_encrypt(getattr(settings, attr_name)),
            )
        )
    db.commit()


def update_counseling_prompt(db: Session) -> None:
    settings = get_settings()
    record = db.query(PromptConfig).filter(PromptConfig.prompt_key == "counseling_prompt").first()
    if record:
        record.content = maybe_encrypt(settings.default_counseling_prompt)
    else:
        db.add(
            PromptConfig(
                prompt_key="counseling_prompt",
                label=PROMPT_DEFAULTS["counseling_prompt"][0],
                content=maybe_encrypt(settings.default_counseling_prompt),
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
            record.content = maybe_encrypt(default_value)
        else:
            db.add(
                PromptConfig(
                    prompt_key=key,
                    label=PROMPT_DEFAULTS[key][0],
                    content=maybe_encrypt(default_value),
                )
            )
    db.commit()


def _get_prompt_value(db: Session, prompt_key: str) -> str:
    seed_prompt_configs(db)
    prompt = db.query(PromptConfig).filter(PromptConfig.prompt_key == prompt_key).first()
    return decrypt_if_needed(prompt.content) if prompt else ""


def get_prompt_value(prompt_key: str) -> str:
    db = SessionLocal()
    try:
        return _get_prompt_value(db, prompt_key)
    finally:
        db.close()


def serialize_prompt(prompt: PromptConfig) -> dict:
    return {
        "prompt_key": prompt.prompt_key,
        "label": prompt.label,
        "content": decrypt_if_needed(prompt.content) or "",
        "updated_at": prompt.updated_at,
    }
