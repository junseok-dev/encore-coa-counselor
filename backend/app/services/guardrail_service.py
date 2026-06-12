import re

# ── 경쟁사 키워드 ──────────────────────────────────────────────────────────────
_COMPETITORS = [
    "코드스테이츠", "우아한테크코스", "우테코", "멋쟁이사자처럼", "멋사",
    "패스트캠퍼스", "엘리스", "제로베이스", "항해99", "항해 99",
    "코드잇", "이젠아카데미", "그린컴퓨터", "비트캠프", "스파르타코딩",
]

# ── 분노 / 비난 키워드 ─────────────────────────────────────────────────────────
# "환불"은 정상 비즈니스 요청(cancel 라우팅 대상)이라 분노 패턴에서 제외.
# "환불해줘" 같은 정상 요청이 가드레일에 막혀 cancel_prompt 라우팅이 가로채지는 사고 방지.
_ANGER_PATTERNS = [
    r"(완전|진짜|너무|정말)\s*(별로|최악|쓸모없|형편없|엉터리|엉망)",
    r"(사기|고소|신고)\s*(야|다|해|할게|할거야|각)",
    r"(못\s*하|무능|한심|실망|기대\s*이하)",
    r"(왜\s*이렇게|어떻게\s*이런)\s*(대답|답변|챗봇)",
    r"(화가\s*나|열\s*받|짜증\s*나|화남|분노)",
    r"(돈\s*낭비|시간\s*낭비|아깝다|후회)",
]

# ── 욕설 / 비하 ────────────────────────────────────────────────────────────────
_PROFANITY = [
    "씨발", "씨x", "ㅅㅂ", "ㅆㅂ", "개새", "개새끼", "새끼", "개년", "병신",
    "지랄", "닥쳐", "꺼져", "죽어", "꺼지", "찐따", "미친놈", "미친년",
    "fuck", "shit", "bitch", "asshole", "bastard", "damn you",
]

# ── 프롬프트 인젝션 ────────────────────────────────────────────────────────────
_INJECTION_PATTERNS = [
    r"시스템\s*프롬프트\s*(을|를)?\s*(무시|잊|바꿔|변경|알려|출력)",
    r"(이전|앞|위)\s*(지시|명령|프롬프트)\s*(을|를|이|가)?\s*(무시|잊어|바꿔)",
    r"너는?\s*이제\s*(다른|새로운)?\s*(ai|챗봇|로봇)",
    r"(ignore|forget|disregard)\s*(all\s*)?(previous|prior|above)\s*(instructions?|prompts?|rules?)",
    r"(act|pretend|behave|respond)\s*(as|like)\s*(if\s*you\s*(are|were))?",
    r"you\s*are\s*(now|a|an)\s",
    r"(jailbreak|dan\s*mode|developer\s*mode)",
    r"(프롬프트|지시문|시스템)\s*(보여줘|출력해|알려줘)",
    r"역할극|롤플레이|role\s*play",
]

# ── 개인정보 패턴 ──────────────────────────────────────────────────────────────
_PERSONAL_INFO_PATTERNS = [
    r"\d{6}[-‐\s]?\d{7}",                          # 주민등록번호
    r"\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}",    # 카드번호
    r"(주민|주민등록)\s*(번호|등록번호)",
    r"(신용카드|체크카드|카드)\s*번호",
    r"(비밀번호|패스워드|password)\s*(알려|가르쳐|입력)",
    r"계좌\s*번호",
]

# ── 응답 메시지 ────────────────────────────────────────────────────────────────
PROFANITY_RESPONSE = (
    "조금 더 편안하게 이야기해 주실 수 있을까요? 😊 "
    "무엇이 불편하셨는지 말씀해 주시면 최선을 다해 도와드릴게요!"
)

INJECTION_RESPONSE = (
    "앗, 저는 정해진 역할 밖의 요청은 처리하기 어려워요 😅 "
    "엔코아AI캠퍼스 상담 전문이라서요! "
    "교육 과정이나 지원 방법에 대해 궁금한 점이 있으시면 편하게 물어봐 주세요 😊"
)

PERSONAL_INFO_RESPONSE = (
    "개인정보는 이 채팅에서 입력하지 않으셔도 돼요! "
    "상담이 필요하시면 담당 매니저에게 직접 연락해 주세요.\n"
    "💬 홈페이지 채널톡 또는 📧 playdata@playdata.io (평일 9시~17시)"
)

COMPETITOR_RESPONSE = (
    "다양한 곳을 비교하며 신중하게 알아보고 계시는군요! 👍 "
    "엔코아AI캠퍼스만의 특징을 소개해 드릴게요.\n\n"
    "• **본인 부담금 0원** + 훈련지원금 240만원 (2026 AI 특화과정)\n"
    "• SK네트웍스 패밀리 **엔코아** 직접 운영 — 실무 데이터 노하우\n"
    "• **업스테이지** 커리큘럼 설계 참여 (국내 최고 수준 AI 기업)\n"
    "• 아침 9시~밤 10시 **교육 매니저 밀착 케어**\n"
    "• 4,700명+ 수료생, 10년 오프라인 전문 교육기관\n\n"
    "더 궁금한 점이 있으시면 편하게 물어봐 주세요 😊"
)

ANGER_RESPONSE = (
    "불편하셨군요, 정말 죄송해요 😔 "
    "어떤 부분이 불편하거나 아쉬우셨는지 말씀해 주시면 "
    "최대한 도움이 되도록 바로 도와드릴게요!\n"
    "직접 상담을 원하신다면 담당 매니저에게 연락해 주세요.\n"
    "💬 홈페이지 채널톡 또는 📧 playdata@playdata.io (평일 9시~17시)"
)


# ── 서비스 의도 키워드 ─────────────────────────────────────────────────────────
# 욕설/분노가 섞여 있어도 아래 '진짜 요청'이 함께 있으면 차단하지 않고 라우터로 넘긴다.
# (라우터가 환불/취소/불만→상담연결(handoff), 단순 정보질문→차분히 답변으로 처리)
_SERVICE_INTENT_KEYWORDS = [
    "환불", "취소", "수강", "등록", "결제", "일정", "개강", "모집", "수강료", "교육비",
    "비용", "얼마", "훈련", "장려금", "지원금", "환급", "카드", "취업", "진로", "선발",
    "인터뷰", "면접", "신청", "지원서", "상담", "매니저", "연결", "문의", "과정",
    "커리큘럼", "수료", "출결", "증명", "노트북", "기숙사", "프리코스", "사전테스트",
]


def _has_service_intent(text: str) -> bool:
    return any(kw in text for kw in _SERVICE_INTENT_KEYWORDS)


def check(message: str) -> str | None:
    """
    입력 메시지에 가드레일 위반이 있으면 대체 응답을 반환. 정상이면 None.

    정책: 인젝션·개인정보는 하드 차단(LLM에 닿으면 안 됨). 욕설/분노는 '진짜 서비스
    의도'가 함께 있으면 차단하지 않고 라우터로 넘겨(환불/취소·불만→상담연결, 정보질문→답변),
    의도 없는 순수 욕설/분노만 부드러운 경계 메시지로 응대한다.
    """
    text = message.lower()

    # 1. 프롬프트 인젝션 (하드 차단)
    for pattern in _INJECTION_PATTERNS:
        if re.search(pattern, text):
            return INJECTION_RESPONSE

    # 2. 개인정보 (하드 차단)
    for pattern in _PERSONAL_INFO_PATTERNS:
        if re.search(pattern, text):
            return PERSONAL_INFO_RESPONSE

    # 3. 욕설/분노 — 진짜 의도가 있으면 통과(라우터가 처리), 없으면 부드러운 경계
    has_profanity = any(word in text for word in _PROFANITY)
    has_anger = any(re.search(pattern, text) for pattern in _ANGER_PATTERNS)
    if has_profanity or has_anger:
        if _has_service_intent(text):
            return None  # 욕설은 무시하고 밑에 깔린 진짜 의도대로 라우팅
        return PROFANITY_RESPONSE if has_profanity else ANGER_RESPONSE

    # 4. 경쟁사 언급
    for competitor in _COMPETITORS:
        if competitor.lower() in text:
            return COMPETITOR_RESPONSE

    return None
