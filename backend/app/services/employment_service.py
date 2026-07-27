import re


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

_EMPLOYMENT_SIGNALS = ("취업", "입사", "채용", "합격")
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


def is_specific_employer_outcome_query(message: str) -> bool:
    """특정 기업의 취업·합격 가능성을 묻는 질문을 보수적으로 판별한다."""
    text = (message or "").lower()
    compact = re.sub(r"\s+", "", text)
    if not any(signal in compact for signal in _EMPLOYMENT_SIGNALS):
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
