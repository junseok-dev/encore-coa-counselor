from typing import Literal, Optional

from pydantic import BaseModel


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    session_id: str
    message: str
    history: list[HistoryMessage] = []


class ChatResponse(BaseModel):
    answer: str
    source: Literal["faq", "document", "ai", "fallback", "guardrail", "handoff"]
    session_id: str
    handoff_url: Optional[str] = None


class SuggestedQuestion(BaseModel):
    id: str
    label: str
    query: str
    url: Optional[str] = None


class SuggestedQuestionsResponse(BaseModel):
    questions: list[SuggestedQuestion]
