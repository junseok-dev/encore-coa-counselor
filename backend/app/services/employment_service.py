import re

from app.services.consultation_service import consultation_mode_for


SPECIFIC_EMPLOYER_OUTCOME_ANSWER = (
    "특정 기업 취업은 이 과정 수강만으로 가능 여부나 취업 규모를 판단할 수 없어요.\n\n"
    "대신 엔코아 AI 캠퍼스에서는 다음과 같은 취업 지원을 제공하고 있어요.\n"
    "- **엔코아 단독 채용 전형**\n"
    "- **파트너사 채용 추천**\n"
    "- **기업 초청 채용설명회**\n"
    "- **이력서·포트폴리오 1:1 피드백**\n"
    "- **실전 기술면접 컨설팅**\n\n"
    "기수마다 우수 수료생 2명을 선발해 수료 후 6개월간 우선 채용 추천 대상자로 포함해요. "
    "다만 이러한 지원은 말씀하신 특정 기업과의 채용 연계나 합격을 보장한다는 뜻은 아닙니다.\n\n"
    "실제 지원 가능 여부와 채용 결과는 개인의 경력·프로젝트·전형 준비도, "
    "해당 시점의 채용 공고와 기업 심사 결과에 따라 달라집니다."
)

EMPLOYMENT_RESPONSIBILITY_ANSWER = (
    "대기업에 취업하지 못했다고 해서 수강생이나 교육기관 어느 한쪽의 책임이라고 "
    "단정할 수는 없어요.\n\n"
    "엔코아 AI 캠퍼스는 안내한 교육과 취업지원 프로그램을 제공할 책임이 있고, "
    "실제 채용 여부는 지원자의 준비 상황, 당시 채용 공고와 기업의 심사 결과에 따라 결정됩니다.\n\n"
    "즉, 취업 준비는 지원하지만 특정 기업 취업을 보장하거나 채용 결과를 책임지는 구조는 아니에요."
)

_EMPLOYMENT_SIGNALS = ("취업", "입사", "채용", "합격")
_EMPLOYMENT_CONTEXT_SIGNALS = _EMPLOYMENT_SIGNALS + (
    "대기업",
    "중견기업",
    "중소기업",
    "회사",
    "직장",
)
_RESPONSIBILITY_SIGNALS = (
    "누구책임",
    "누가책임",
    "책임져",
    "책임이야",
    "책임인가",
    "책임입니까",
    "책임인가요",
)
_RESPONSIBILITY_ANSWER_MARKERS = (
    "교육과 취업지원 프로그램을 제공할 책임",
    "채용 결과를 책임지는 구조는 아니에요",
)
_FOLLOWUP_COMPLAINT_SIGNALS = (
    "불만",
    "납득안",
    "납득이안",
    "말이돼",
    "말이되",
    "장난",
    "이상하",
    "황당",
    "어이없",
    "책임회피",
    "책임안",
    "책임을안",
    "결국책임",
    "말바꾸",
    "못믿",
    "신뢰가안",
    "속인",
    "사기",
    "과장",
    "기만",
    "피해",
    "항의",
    "따질",
    "고소",
    "신고",
    "최악",
    "화나",
    "짜증",
)
_KNOWN_EXTERNAL_EMPLOYERS = (
    "하이닉스",
    "sk하이닉스",
    "삼성",
    "삼성전자",
    "lg",
    "lg전자",
    "네이버",
    "카카오",
    "쿠팡",
    "현대",
    "현대자동차",
    "기아",
    "라인",
    "토스",
    "배달의민족",
    "우아한형제들",
)
_EMPLOYER_BEFORE_OUTCOME = re.compile(
    r"(?P<employer>[0-9A-Za-z가-힣&·.-]{2,30})\s*"
    r"(?:으?로|에|에서)\s*(?:도\s*)?(?:취업|입사|채용|합격)"
)
_GENERIC_TARGETS = {
    "어디",
    "회사",
    "기업",
    "대기업",
    "중견기업",
    "중소기업",
    "스타트업",
    "수료후어디",
}


def is_employment_responsibility_query(message: str) -> bool:
    """취업 결과의 책임 소재를 묻는 정보성 질문을 사람 연결 요청과 구분한다."""
    compact = re.sub(r"\s+", "", (message or "").lower())
    return (
        any(signal in compact for signal in _EMPLOYMENT_CONTEXT_SIGNALS)
        and any(signal in compact for signal in _RESPONSIBILITY_SIGNALS)
    )


def should_handoff_after_employment_responsibility(
    message: str,
    history: list[dict] | None,
) -> bool:
    """책임 안내 직후 이어진 불만·항의는 추가 생성 대신 상담 매니저에게 연결한다."""
    if not history:
        return False

    # 이미 한두 차례 생성 답변이 끼어든 기존 대화도 즉시 멈출 수 있도록 최근 이력 안에서
    # 최초 책임 안내를 찾는다. 이 마커가 없는 다른 주제의 불만에는 적용하지 않는다.
    recent_assistant_answers = [
        item.get("content") or ""
        for item in history[-10:]
        if (item.get("role") or "") == "assistant"
    ]
    if not any(
        marker in answer
        for answer in recent_assistant_answers
        for marker in _RESPONSIBILITY_ANSWER_MARKERS
    ):
        return False

    compact = re.sub(r"\s+", "", (message or "").lower())
    # 책임을 다시 따지는 순간부터는 민감한 책임 공방으로 보고 더 생성하지 않는다.
    return "책임" in compact or any(
        signal in compact for signal in _FOLLOWUP_COMPLAINT_SIGNALS
    )


def is_specific_employer_outcome_query(message: str) -> bool:
    """특정 기업의 취업·합격 가능성을 묻는 질문을 보수적으로 판별한다."""
    text = (message or "").lower()
    compact = re.sub(r"\s+", "", text)
    if not any(signal in compact for signal in _EMPLOYMENT_SIGNALS):
        return False

    # 취업을 목표로 자신에게 맞는 교육 과정을 묻는 질문은 기업 합격 가능성 문의가 아니다.
    # 특정 기업명이 함께 있더라도 과정 추천 RAG에서 직무·커리큘럼 적합성을 설명하게 한다.
    if consultation_mode_for(message) == "recommendation":
        return False

    # 엔코아 단독 채용 전형은 별도의 검증된 FAQ가 있으므로 일반 취업지원 경로에서 답한다.
    if "엔코아" in compact:
        return False
    if any(employer in compact for employer in _KNOWN_EXTERNAL_EMPLOYERS):
        return True

    match = _EMPLOYER_BEFORE_OUTCOME.search(text)
    if not match:
        return False
    employer = re.sub(r"\s+", "", match.group("employer"))
    return employer not in _GENERIC_TARGETS
