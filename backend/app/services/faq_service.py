import json
import re
from difflib import SequenceMatcher
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.database import SessionLocal
from app.db.models import FaqRecord
from app.services.storage_service import build_s3_key, read_text_from_storage, upload_text_to_s3
from app.utils.crypto import decrypt_if_needed, maybe_encrypt

FAQ_PATH = Path(__file__).parent.parent.parent.parent / "data" / "faq" / "faq.json"
FAQ_STORAGE_KEY = build_s3_key("faq", "faq.json")
STOPWORDS = {
    "안내",
    "가능",
    "관련",
    "문의",
    "무엇",
    "뭐",
    "설명",
    "정보",
    "이용",
}


def _normalize(text: str) -> str:
    lowered = (text or "").lower()
    cleaned = re.sub(r"[^0-9a-zA-Z가-힣\s]", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def _compact(text: str) -> str:
    return _normalize(text).replace(" ", "")


def _tokenize(text: str) -> set[str]:
    return {
        token
        for token in _normalize(text).split()
        if len(token) >= 2 and token not in STOPWORDS
    }


def _load_faq_json() -> dict:
    # 로컬 파일 우선 (git 배포 시 최신 데이터 반영)
    if FAQ_PATH.exists():
        return json.loads(FAQ_PATH.read_text(encoding="utf-8"))
    if get_settings().aws_s3_bucket:
        try:
            remote = read_text_from_storage(f"s3://{get_settings().aws_s3_bucket}/{FAQ_STORAGE_KEY}")
            if remote:
                return json.loads(remote)
        except Exception:
            pass
    return {"faqs": [], "suggested_questions": [], "categories": []}


def _serialize_faq(record: FaqRecord) -> dict:
    return {
        "id": record.faq_key,
        "category": decrypt_if_needed(record.category) or "",
        "question": decrypt_if_needed(record.question) or "",
        "answer": decrypt_if_needed(record.answer) or "",
        "keywords": json.loads(decrypt_if_needed(record.keywords_json) or "[]"),
        "aliases": json.loads(decrypt_if_needed(record.aliases_json) or "[]"),
        "search_hints": json.loads(decrypt_if_needed(record.search_hints_json) or "[]"),
        "source_files": json.loads(decrypt_if_needed(record.source_files_json) or "[]"),
        "direct_answer": record.direct_answer,
        "top_k": record.top_k,
    }


def seed_faqs(db: Session) -> None:
    payload = _load_faq_json()
    json_keys = {faq.get("id") for faq in payload.get("faqs", []) if faq.get("id")}

    # 현재 JSON에 없는 DB 레코드 삭제
    db.query(FaqRecord).filter(FaqRecord.faq_key.notin_(json_keys)).delete(synchronize_session=False)

    for faq in payload.get("faqs", []):
        faq_key = faq.get("id")
        if not faq_key:
            continue
        existing = db.query(FaqRecord).filter(FaqRecord.faq_key == faq_key).first()
        if existing:
            existing.category = maybe_encrypt(faq.get("category", ""))
            existing.question = maybe_encrypt(faq.get("question", ""))
            existing.answer = maybe_encrypt(faq.get("answer", ""))
            existing.keywords_json = maybe_encrypt(json.dumps(faq.get("keywords", []), ensure_ascii=False))
            existing.aliases_json = maybe_encrypt(json.dumps(faq.get("aliases", []), ensure_ascii=False))
            existing.search_hints_json = maybe_encrypt(json.dumps(faq.get("search_hints", []), ensure_ascii=False))
            existing.source_files_json = maybe_encrypt(json.dumps(faq.get("source_files", []), ensure_ascii=False))
            existing.direct_answer = bool(faq.get("direct_answer", False))
            existing.top_k = int(faq.get("top_k", 4) or 4)
            existing.is_active = True
        else:
            db.add(
                FaqRecord(
                    faq_key=faq_key,
                    category=maybe_encrypt(faq.get("category", "")),
                    question=maybe_encrypt(faq.get("question", "")),
                    answer=maybe_encrypt(faq.get("answer", "")),
                    keywords_json=maybe_encrypt(json.dumps(faq.get("keywords", []), ensure_ascii=False)),
                    aliases_json=maybe_encrypt(json.dumps(faq.get("aliases", []), ensure_ascii=False)),
                    search_hints_json=maybe_encrypt(json.dumps(faq.get("search_hints", []), ensure_ascii=False)),
                    source_files_json=maybe_encrypt(json.dumps(faq.get("source_files", []), ensure_ascii=False)),
                    direct_answer=bool(faq.get("direct_answer", False)),
                    top_k=int(faq.get("top_k", 4) or 4),
                    is_active=True,
                )
            )
    db.commit()


def sync_faqs_to_file(db: Session) -> None:
    # DB(현재 상태) → 파일 방향으로만 기록한다.
    # 이전에는 맨 앞에서 seed_faqs(db)를 호출했는데, seed_faqs는 "옛 파일 → DB" 방향이라
    # 방금 추가/수정한 FAQ를 파일 기록 전에 삭제·롤백시키는 버그가 있었다. (create/update/FAQ-MD 승인 유실)
    payload = _load_faq_json()
    payload["faqs"] = [_serialize_faq(row) for row in db.query(FaqRecord).filter(FaqRecord.is_active.is_(True)).order_by(FaqRecord.id.asc()).all()]
    FAQ_PATH.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    FAQ_PATH.write_text(content, encoding="utf-8")
    uploaded = upload_text_to_s3(content, FAQ_STORAGE_KEY, content_type="application/json; charset=utf-8")
    if uploaded and FAQ_PATH.exists():
        FAQ_PATH.unlink()


_faq_seeded = False
_faq_file_mtime: float | None = None


def _get_faq_file_mtime() -> float | None:
    try:
        if FAQ_PATH.exists():
            return FAQ_PATH.stat().st_mtime
    except OSError:
        return None
    return None


def _get_faq_data() -> dict:
    global _faq_seeded, _faq_file_mtime
    db = SessionLocal()
    try:
        current_mtime = _get_faq_file_mtime()
        needs_seed = (not _faq_seeded) or (current_mtime is not None and current_mtime != _faq_file_mtime)

        if needs_seed:
            seed_faqs(db)
            _faq_seeded = True
            _faq_file_mtime = current_mtime
        rows = db.query(FaqRecord).filter(FaqRecord.is_active.is_(True)).order_by(FaqRecord.id.asc()).all()
        payload = _load_faq_json()
        payload["faqs"] = [_serialize_faq(row) for row in rows]
        return payload
    finally:
        db.close()


def _iter_match_texts(faq: dict) -> list[str]:
    texts = [faq.get("question", "")]
    texts.extend(faq.get("keywords", []))
    texts.extend(faq.get("aliases", []))
    texts.extend(faq.get("search_hints", []))
    if faq.get("category"):
        texts.append(faq["category"])
    return [text for text in texts if text]


def _score_faq(query: str, faq: dict) -> float:
    normalized_query = _normalize(query)
    compact_query = _compact(query)
    if not normalized_query:
        return 0.0

    query_tokens = _tokenize(query)
    score = 0.0

    question = faq.get("question", "")
    compact_question = _compact(question)
    question_tokens = _tokenize(question)

    if compact_query == compact_question:
        score += 14.0
    elif compact_query and compact_question and (
        compact_query in compact_question or compact_question in compact_query
    ):
        score += 9.0
    else:
        ratio = SequenceMatcher(None, compact_query, compact_question).ratio()
        if ratio >= 0.68:
            score += ratio * 7.0

    score += len(query_tokens & question_tokens) * 2.8

    for text in _iter_match_texts(faq):
        compact_text = _compact(text)
        text_tokens = _tokenize(text)

        if compact_text and compact_text in compact_query:
            score += max(2.5, min(len(compact_text) * 0.45, 6.0))
            continue

        overlap = len(query_tokens & text_tokens)
        if overlap:
            score += overlap * 1.8
            continue

        ratio = SequenceMatcher(None, compact_query, compact_text).ratio()
        if ratio >= 0.72:
            score += ratio * 3.5

    return score


def match_faq(query: str) -> tuple[float, dict] | None:
    data = _get_faq_data()
    best_faq = None
    best_score = 0.0
    for faq in data.get("faqs", []):
        score = _score_faq(query, faq)
        if score > best_score:
            best_score = score
            best_faq = faq

    if not best_faq:
        return None
    return best_score, best_faq


# 다중 도메인 의도 감지 — 한 질문에 서로 다른 카테고리 키워드가 2개 이상이면 FAQ 매칭 건너뛰고 RAG로 보냄.
# 너무 일반적인 키워드("캠퍼스", "과정")는 "엔코아 AI 캠퍼스 ~ 과정 ~" 같은 정상 질문에서도 매칭되어
# 단일 FAQ 답변을 부당하게 차단하므로 제외함.
_DOMAIN_GROUPS: dict[str, list[str]] = {
    "location": ["위치", "주소", "어디", "g밸리", "g벨리", "가산", "동작역", "오프라인"],
    "device": ["노트북", "사양", "장비", "기기", "컴퓨터", "맥북"],
    "cost": ["비용", "수강료", "본인부담", "훈련비", "얼마"],
    "benefit": ["훈련장려금", "지원금", "혜택", "장려금", "내일배움카드"],
    "time": ["운영시간", "수업시간", "몇 시", "몇시", "시간표"],
    "rule": ["출결", "결석", "보강", "지각", "출석률", "수료 조건"],
    "interview": ["인터뷰", "면접"],
    "curriculum": ["커리큘럼", "수업 내용", "프리코스", "사전학습"],
    "career": ["취업", "진로", "직무", "채용"],
    "schedule": ["개강일", "모집 일정", "기수 일정"],
}


def is_multi_intent(query: str) -> bool:
    """질문에 서로 다른 도메인 키워드가 2개 이상 등장하면 True (FAQ 단일 매칭 부적합)."""
    normalized = _normalize(query)
    hits = 0
    for kws in _DOMAIN_GROUPS.values():
        if any(kw in normalized for kw in kws):
            hits += 1
            if hits >= 2:
                return True
    return False


def is_guide_query(query: str) -> bool:
    normalized = _normalize(query)
    guide_signals = [
        "어떤 질문",
        "질문 추천",
        "무슨 질문",
        "뭐 물어봐",
        "카테고리",
        "처음인데",
        "무엇을 물어",
        "어떤 걸 물어",   # "법 관련해서는 어떤 걸 물어보면 돼?"
        "어떤 거 물어",   # 맞춤법 변형
        "뭘 물어",         # "엔코아 ai 캠퍼스 정보 쪽에서는 뭘 물어보면 돼?"
        "물어볼 수 있",   # "어떤 걸 물어볼 수 있어?"
        "질문할 수 있",
        "어떤 내용",
        "무슨 내용",
    ]
    return any(signal in normalized for signal in guide_signals)


_SCHEDULE_WHEN = ("언제", "며칠", "날짜", "몇월", "몇일")


def is_schedule_query(query: str) -> bool:
    """개강/모집 '시점'을 묻는 명백한 질문만 좁게 판별한다 (개강 전/후/준비 등은 제외 → false positive 최소).
    여기서 못 잡는 변형 표현은 temperature=0으로 결정적이 된 의도 분류기가 의미로 처리한다."""
    c = _compact(query)
    if not c:
        return False
    if "개강일" in c:
        return True
    if any(x in c for x in ("언제개강", "개강언제", "모집일정", "모집언제")):
        return True
    if "다음기수" in c and any(w in c for w in ("언제", "개강", "시작")):
        return True
    if "개강" in c and (any(w in c for w in _SCHEDULE_WHEN) or re.search(r"\d+월", c)):
        return True
    if "모집" in c and any(w in c for w in ("언제", "일정")):
        return True
    return False


def get_schedule_faq_answer() -> str | None:
    """모집 일정 FAQ의 직접 답변(현재 개강 일정 포함)을 반환한다."""
    for faq in _get_faq_data().get("faqs", []):
        if faq.get("category") == "모집 일정" and faq.get("direct_answer") and faq.get("answer"):
            return faq.get("answer")
    return None


def get_faq_answer_by_id(faq_id: str | None) -> str | None:
    """FAQ id로 직접 답변을 반환한다(하이브리드 라우터가 고른 faq_id 처리용)."""
    if not faq_id:
        return None
    for faq in _get_faq_data().get("faqs", []):
        if faq.get("id") == faq_id:
            return faq.get("answer") or None
    return None


def search_faq(query: str) -> str | None:
    if not is_guide_query(query):
        return None

    matched = match_faq(query)
    if not matched:
        return None

    best_score, faq = matched
    if not faq.get("direct_answer", False):
        return None
    if best_score < 6.0:
        return None
    return faq.get("answer")


def _is_guide_faq(faq: dict) -> bool:
    """'무엇을 물어볼 수 있는지' 안내하는 메뉴/카테고리형 FAQ인지 판별."""
    keywords = faq.get("keywords", [])
    return (
        faq.get("category") == "카테고리 안내"
        or any("질문 추천" in k for k in keywords)
        or any(p in faq.get("question", "") for p in ("물어보면", "물어볼 수 있", "어떤 질문", "뭘 물어", "뭐 물어"))
    )


def match_button_faq(query: str) -> str | None:
    """버튼 클릭처럼 쿼리가 FAQ 질문과 정확히 일치할 때 direct_answer 반환.

    score >= 10.0 은 question/alias 정확 일치 수준의 강한 매칭이므로 의도가 명확함 →
    multi-intent 체크를 우회한다. 약한 매칭만 multi-intent 차단 대상.
    """
    matched = match_faq(query)
    if not matched:
        return None
    score, faq = matched
    if not (faq.get("direct_answer") and score >= 10.0):
        return None
    # 메뉴/카테고리 안내형 FAQ는 강한 매칭이어도 '뭘 물어볼 수 있어?' 류일 때만 노출
    if _is_guide_faq(faq) and not is_guide_query(query):
        return None
    return faq.get("answer")


def match_faq_general(query: str, threshold: float = 7.5) -> str | None:
    """일반 대화에서 direct_answer FAQ와 충분히 매칭될 때 답변 반환.

    카테고리 안내성 FAQ(`category == '카테고리 안내'` 또는 keywords에 `질문 추천` 포함)는
    is_guide_query 통과해야만 매칭되도록 차단 → 일반 질문이 가이드 답변으로 잘못 빠지는 사고 방지.
    score < 10.0 인 약한 매칭은 다중 도메인 의도(예: '위치+노트북')일 때 RAG로 보낸다.
    """
    matched = match_faq(query)
    if not matched:
        return None
    score, faq = matched
    if not faq.get("direct_answer") or score < threshold:
        return None
    # 메뉴/카테고리 안내형 FAQ는 사용자가 '뭘 물어볼 수 있는지' 물을 때만(is_guide_query) 노출.
    # (예: "~쪽에서는 뭘 물어보면 돼?" 류가 일반 질문에 잘못 매칭돼 메뉴가 튀어나오는 것 방지)
    if _is_guide_faq(faq) and not is_guide_query(query):
        return None
    # 강한 매칭(score >= 10)은 명확한 의도 — multi-intent 우회. 약한 매칭만 차단.
    if score < 10.0 and is_multi_intent(query):
        return None
    return faq.get("answer")


def get_suggested_questions() -> list[dict]:
    return _load_faq_json().get("suggested_questions", [])
