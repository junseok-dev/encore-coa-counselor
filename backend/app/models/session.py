from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SessionSummary(BaseModel):
    id: str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    message_count: int
    user_name: Optional[str] = None  # 복호화된 이름 (관리자용)

    class Config:
        from_attributes = True


class MessageDetail(BaseModel):
    id: int
    session_id: str
    role: str
    content: str
    source: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class SessionDetail(BaseModel):
    session: SessionSummary
    messages: list[MessageDetail]
