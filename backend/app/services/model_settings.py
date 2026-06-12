"""활성 LLM 모델명을 DB(app_settings)에 저장/조회한다.

기존에는 모델 변경을 .env 파일에 기록했는데, 다음 이유로 변경이 유지되지 않았다:
  1. 배포(deploy.yml)가 .env를 통째로 재생성하며 모델명을 덮어씀
  2. pydantic-settings가 .env 파일보다 OS 환경변수를 우선해서, 환경변수가 있으면 .env 수정이 무시됨
  3. 멀티 워커 환경에서 get_settings.cache_clear()가 PUT을 처리한 워커만 갱신함
DB를 단일 진실 소스로 두면 위 세 문제를 모두 피한다.
"""

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import AppSetting

ACTIVE_MODEL_KEY = "active_model_name"


def get_active_model() -> str:
    """현재 활성 채팅 모델명. DB 값 우선, 없으면 .env/기본값으로 폴백."""
    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == ACTIVE_MODEL_KEY).first()
        if row and row.value:
            return row.value
    finally:
        db.close()
    return get_settings().model_name


def set_active_model(db: Session, model_name: str) -> None:
    row = db.query(AppSetting).filter(AppSetting.key == ACTIVE_MODEL_KEY).first()
    if row:
        row.value = model_name
    else:
        db.add(AppSetting(key=ACTIVE_MODEL_KEY, value=model_name))
    db.commit()
