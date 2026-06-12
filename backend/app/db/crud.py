from sqlalchemy.orm import Session
from app.db.models import ChatSession, ChatMessage
from app.utils.crypto import encrypt, decrypt
from datetime import datetime


def create_session(db: Session, session_id: str, encrypted_user_name: str = None) -> ChatSession:
    """새 상담 세션 생성"""
    session = ChatSession(
        id=session_id,
        encrypted_user_name=encrypted_user_name,
        message_count=0,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_or_create_session(
    db: Session, session_id: str, encrypted_user_name: str = None
) -> ChatSession:
    """세션이 없으면 생성, 있으면 조회"""
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        session = create_session(db, session_id, encrypted_user_name)
    return session


def save_message(
    db: Session,
    session_id: str,
    role: str,
    content: str,
    source: str = "document",
) -> ChatMessage:
    """메시지 저장 + 세션 메시지 카운트 업데이트"""
    message = ChatMessage(
        session_id=session_id,
        role=role,
        content=encrypt(content),
        source=source,
    )
    db.add(message)

    # 세션 메시지 카운트 증가
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session:
        session.message_count = (session.message_count or 0) + 1
        session.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(message)
    return message


def get_all_sessions(db: Session, skip: int = 0, limit: int = 50) -> list[ChatSession]:
    """모든 세션 목록 조회 (관리자용)"""
    return (
        db.query(ChatSession)
        .order_by(ChatSession.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_session_messages(db: Session, session_id: str) -> list[ChatMessage]:
    """특정 세션의 전체 메시지 조회 (관리자용)"""
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
