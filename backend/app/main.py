import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.db import models
from app.db.database import SessionLocal, engine
from app.db.migrations import migrate_database
from app.routers import admin, auth, chat
from app.services.faq_service import seed_faqs
from app.services.prompt_service import seed_prompt_configs
from app.services.rag_service import get_rag_service
from app.services.storage_service import ensure_storage_dirs

models.Base.metadata.create_all(bind=engine)
migrate_database(engine)


logger = logging.getLogger("app.startup")


def _warn_insecure_defaults() -> None:
    settings = get_settings()
    if settings.jwt_secret == "change-this-secret-in-production":
        logger.warning(
            "JWT_SECRET이 기본값입니다 — 누구나 관리자 토큰을 위조할 수 있어 매우 위험합니다. "
            ".env에 강력한 JWT_SECRET을 반드시 설정하세요."
        )
    if not settings.encryption_key:
        logger.warning("ENCRYPTION_KEY가 비어 있습니다 — 암호화/복호화가 정상 동작하지 않습니다.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_storage_dirs()
    _warn_insecure_defaults()
    db = SessionLocal()
    try:
        seed_faqs(db)
        seed_prompt_configs(db)
        # 과거 여기서 update_counseling_prompt/update_handoff_prompts로 매 재시작마다 프롬프트를
        # 코드 기본값으로 강제 덮어써 관리자 편집분이 사라지는 버그가 있어 제거함.
        # 기본값은 seed_prompt_configs가 레코드가 없을 때만 시드한다.
        get_rag_service().index_all(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="엔코아AI캠퍼스 상담 챗봇 API",
    description="FAQ와 문서 기반 교육 상담 API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://chatbot.encorecampus.ai",
        "https://chatbot.encorecampus.ai",
        "http://chatbot.encorecampus.ai.playdata.io",
        "https://chatbot.encorecampus.ai.playdata.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])
app.include_router(auth.router, prefix="/api/admin/auth", tags=["Auth"])


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "healthy"}


STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(
            str(STATIC_DIR / "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
