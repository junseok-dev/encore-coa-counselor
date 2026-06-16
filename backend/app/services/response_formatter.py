import re

from app.config import get_settings

MAX_BUBBLES = 8

# 답변 내 encorecampus.ai 링크(마크다운/일반 모두) — 트래킹 파라미터 부착 대상
_TRACK_URL_RE = re.compile(r"https?://[^\s)\]]*encorecampus\.ai[^\s)\]]*")


def _campaign_for(url_without_query: str) -> str:
    """encorecampus.ai 링크의 마지막 경로 세그먼트를 utm_campaign 값으로 사용한다.
    예: .../course → course, .../orchestration → orchestration, .../ml → ml, .../mlops → mlops.
    루트(.../) 처럼 경로 세그먼트가 없으면 빈 문자열(캠페인 미부착). 과정 페이지별 유입 구분용."""
    after_host = url_without_query.split("encorecampus.ai", 1)[-1].strip("/")
    return after_host.split("/")[-1] if after_host else ""


def apply_link_tracking(text: str) -> str:
    """답변의 encorecampus.ai 링크에 트래킹 파라미터(LINK_TRACKING_PARAMS)를 자동 부착한다.
    설정이 비어 있으면 원문을 그대로 반환(no-op) — 규칙이 들어오면 설정만 채우면 즉시 적용된다.
    공통 파라미터(utm_source·utm_medium 등)는 LINK_TRACKING_PARAMS에서 오고, utm_campaign은
    링크의 마지막 경로 세그먼트(course/orchestration/ml/mlops…)로 자동 결정해 과정별 유입을 구분한다.
    경로·기존 쿼리·#fragment를 보존하며, 쿼리 유무에 따라 ? 또는 &로 이어붙인다.
    이미 utm_source가 붙은 링크는 다시 부착하지 않는다(idempotent — 중복 스트리밍/이중 포맷 방어).
    """
    if not text:
        return text
    base = (get_settings().link_tracking_params or "").strip().lstrip("?&")
    if not base:
        return text

    def _rewrite(match: re.Match) -> str:
        url = match.group(0)
        fragment = ""
        if "#" in url:
            url, frag = url.split("#", 1)
            fragment = "#" + frag
        if "utm_source=" in url:  # 이미 트래킹된 링크 → 중복 부착 방지
            return f"{url}{fragment}"
        params = base
        if "utm_campaign=" not in base:  # 공통 설정에 캠페인이 없으면 경로 기반으로 자동 부여
            seg = _campaign_for(url.split("?", 1)[0])
            if seg:
                params = f"{base}&utm_campaign={seg}"
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}{params}{fragment}"

    return _TRACK_URL_RE.sub(_rewrite, text)


# 과정명 → 상세페이지 slug (메시지에 특정 과정 하나가 명시되면 해당 상세링크를 덧붙임)
_COURSE_SLUGS = [
    (("오케스트레이션", "오케스트레이", "멀티 에이전트", "멀티에이전트"), "orchestration"),
    (("mlops", "엠엘옵스", "엠엘 옵스", "데이터 엔지니어링", "ai ready"), "mlops"),
    (("머신러닝", "머신 러닝", "데이터 분석"), "ml"),
]


def course_link_for(message: str, answer: str) -> str | None:
    """메시지가 특정 과정 '하나'를 가리키면 그 과정 상세페이지 '코스 자세히 보기' 링크 마크다운을 반환.
    과정이 0개/2개 이상이거나 이미 답변에 해당 링크가 있으면 None. (호출부에서 source=faq/document일 때만 사용)
    """
    if not message:
        return None
    m = message.lower()
    hits = []
    for keys, slug in _COURSE_SLUGS:
        if any(k in m for k in keys) and slug not in hits:
            hits.append(slug)
    if len(hits) != 1:
        return None
    slug = hits[0]
    if f"encorecampus.ai/{slug}" in (answer or ""):  # 답변에 이미 그 과정 링크가 있으면 중복 방지(정확 URL 기준)
        return None
    return f"📄 [코스 자세히 보기](https://encorecampus.ai/{slug})"

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?。！？])\s+")
# `** 단어 **`, `** 단어**`, `**단어 **` 등 별표와 단어 사이 공백을 정규화
_BOLD_WRAP = re.compile(r"\*\*\s*([^\*\n]+?)\s*\*\*")
# `**(ZOOM, 약 20분)**가` 처럼 닫는 별표 앞이 punctuation, 뒤가 한글/영문/숫자면
# CommonMark의 right-flanking 규칙 위반으로 볼드가 적용되지 않아 별표가 그대로 노출됨.
# 닫는 `**` 뒤에 NBSP(U+00A0, Unicode whitespace)를 삽입해 규칙을 만족시킴.
_BOLD_CLOSE_FIX = re.compile(r"(\*\*[^*\n]+?[^\w\s*])\*\*(?=[\w가-힣])")


def _clean_text(text: str) -> str:
    cleaned = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = cleaned.replace("```", "")
    cleaned = re.sub(r"(?m)^[ \t]{0,3}#{1,6}[ \t]*", "", cleaned)
    cleaned = re.sub(r"(?m)^[ \t]{0,3}>[ \t]*", "", cleaned)
    cleaned = re.sub(r"(?m)^[ \t]*[-*•][ \t]+", "- ", cleaned)
    # 연속된 목록 항목 사이의 빈 줄을 제거 → 한 ul로 묶이게 함
    cleaned = re.sub(r"(?m)(^- [^\n]+)\n+(?=- )", r"\1\n", cleaned)
    # m-dash 주변 공백만 정리 (보존). 줄바꿈은 건드리지 않음.
    cleaned = re.sub(r" +[–—] +", " — ", cleaned)
    # 인라인 hyphen만 마침표로 치환. \s가 줄바꿈을 매칭해 마크다운 목록을 깨뜨리던 버그 수정.
    cleaned = re.sub(r" +- +", ". ", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    # 별표 정규화: ReactMarkdown이 인식 못하는 `** 단어 **` 형태를 `**단어**`로 고침
    cleaned = _BOLD_WRAP.sub(lambda m: f"**{m.group(1).strip()}**", cleaned)
    # `**…)**한글` 처럼 punct 닫기 + 한글 이어붙음 → NBSP 삽입으로 볼드 적용 보장
    cleaned = _BOLD_CLOSE_FIX.sub(lambda m: f"{m.group(1)}** ", cleaned)
    # **강조** 헤더로 시작하는 줄 앞에 빈 줄을 강제 → 각 강조 헤더 단위로 paragraph(말풍선) 분리
    cleaned = re.sub(r"(?<!\n)\n(?=\*\*[^\n]+\*\*)", "\n\n", cleaned)
    # **강조** 헤더 줄 뒤에도 빈 줄 강제 → 다음에 오는 목록(- 또는 1.)이 별도 paragraph로 인식되어 ul/ol 변환됨
    cleaned = re.sub(r"(\*\*[^\n]+\*\*[ \t]*)\n(?!\n)", r"\1\n\n", cleaned)
    cleaned = re.sub(
        r"^\s*(좋아요|네|알겠습니다|확인했습니다|좋은 질문이에요)\s*[-–—:]\s*",
        r"\1. ",
        cleaned,
    )
    cleaned = re.sub(r"^\s*정보\s*정리\s*(해\s*드릴게요)?[.:]?\s*", "", cleaned)
    # 문장 끝(. ! ? ~) 뒤에 공백+다음 문장이 오면 줄바꿈으로 분리해 가독성 보강.
    # URL 내부 마침표(예: encorecampus.ai/)는 공백 없이 이어지므로 영향 없음.
    # `(?<!\d)` 추가: 번호 목록(`1. 본문`, `2. 본문`)의 마침표는 매칭 제외 — 마커와 본문이 끊기지 않게.
    cleaned = re.sub(r"(?<!\d)([.!?~]) +(?=[가-힣A-Za-z(\[•\-*])", r"\1\n", cleaned)
    return cleaned.strip()


def _split_paragraph(paragraph: str) -> list[str]:
    sentences = [part.strip() for part in _SENTENCE_SPLIT.split(paragraph) if part.strip()]
    return sentences or ([paragraph.strip()] if paragraph.strip() else [])


def format_chat_response(text: str, max_bubbles: int = MAX_BUBBLES) -> str:
    cleaned = _clean_text(text)
    if not cleaned:
        return ""

    # paragraph break(빈 줄, \n\n) 기준으로만 말풍선 분리.
    # 같은 paragraph 안 내용(마침표 줄바꿈 포함)은 절대 쪼개지 않고 한 말풍선에 통째로 유지.
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", cleaned) if part.strip()]
    if not paragraphs:
        return ""

    if len(paragraphs) > 1:
        bubbles = paragraphs[:max_bubbles]
    elif "\n" in paragraphs[0]:
        bubbles = [paragraphs[0]]
    else:
        bubbles = _split_paragraph(paragraphs[0])[:max_bubbles]

    return apply_link_tracking("\n\n".join(bubbles))