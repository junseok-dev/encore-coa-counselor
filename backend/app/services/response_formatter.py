import re
from urllib.parse import urlsplit, urlunsplit

from app.services.link_tracking_settings import get_link_tracking_urls

MAX_BUBBLES = 8

# 답변 내 encorecampus.ai 링크(마크다운/일반 모두) — 트래킹 파라미터 부착 대상
_TRACK_URL_RE = re.compile(r"https?://[^\s)\]]*encorecampus\.ai[^\s)\]]*")

def apply_link_tracking(text: str, tracking_urls: list[dict[str, str]] | None = None) -> str:
    """답변의 과정 URL을 관리자 페이지에 저장된 완성형 추적 URL로 교체한다."""
    if not text:
        return text
    active_urls = get_link_tracking_urls() if tracking_urls is None else tracking_urls
    configured_by_path = {
        urlsplit(item["url"]).path.rstrip("/"): item["url"]
        for item in active_urls
        if item.get("url")
    }

    def _rewrite(match: re.Match) -> str:
        original = urlsplit(match.group(0))
        normalized_path = original.path.rstrip("/")
        configured_url = configured_by_path.get(normalized_path)
        if not configured_url:
            return match.group(0)
        configured = urlsplit(configured_url)
        return urlunsplit(
            (
                configured.scheme,
                configured.netloc,
                configured.path,
                configured.query,
                original.fragment or configured.fragment,
            )
        )

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


# 시스템 프롬프트가 금지한 '자료 확인 한계' 메타표현 — 답변 서두에 반복 노출되어 후처리로 제거한다.
# 프레이밍("제가 가진 안내 내용에서는")만 떼고 뒤의 실제 내용은 보존한다(문장 통째 삭제 X).
_META_DISCLAIMER = [
    # 제가 [지금] (가진|확인한…) (자료|안내 내용|범위|정보) … (로는|에서는|만으로는)
    re.compile(
        r"(?m)^[ \t]*(?:다만|그런데|사실|우선|아직|또)?[ \t]*(?:지금|현재)?[ \t]*제가[ \t]*(?:지금|현재)?[ \t]*"
        r"(?:가진|가지고[ \t]*있는|확인한|확인[ \t]*가능한)[ \t]*(?:자료|안내[ \t]*내용|범위|정보)"
        r"[^,\n]*?(?:로는|으로는|만으로는|에서는|에는|에선)[, \t]*"
    ),
    # (지금|현재) (가진|가지고 있는) (자료|안내 내용|정보) … (로는|에서는) — '제가' 없는 변형
    re.compile(
        r"(?m)^[ \t]*(?:다만|그런데|사실|우선|아직|또)?[ \t]*(?:지금|현재)[ \t]*"
        r"(?:가진|가지고[ \t]*있는)[ \t]*(?:자료|안내[ \t]*내용|정보)"
        r"[^,\n]*?(?:로는|으로는|만으로는|에서는)[, \t]*"
    ),
    # 주의: "…는 여기서 바로 확인하기 어려워서요"처럼 문장 '뒤'에 붙는 서술절은 지우면
    # 주어만 남아 문장이 깨지므로(854건 재생검증에서 1건 확인) 필터에서 제외한다.
    # 이 표현은 프롬프트 금지 규칙으로만 억제한다.
]


def _strip_meta_disclaimer(text: str) -> str:
    """금지된 '자료 확인 한계' 프레이밍을 제거하고, 남은 문장 첫 글자는 자연스럽게 유지한다."""
    for pat in _META_DISCLAIMER:
        text = pat.sub("", text)
    return text


def _clean_text(text: str) -> str:
    cleaned = _strip_meta_disclaimer((text or "").replace("\r\n", "\n").replace("\r", "\n"))
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
    # 줄 전체가 **강조**인 헤더 뒤에만 빈 줄을 강제한다.
    # `- **목록 항목**`까지 헤더로 오인하면 항목마다 별도 말풍선으로 쪼개지므로 줄 시작을 고정한다.
    cleaned = re.sub(r"(?m)^(\*\*[^\n]+\*\*[ \t]*)\n(?!\n)", r"\1\n\n", cleaned)
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


def format_chat_response(
    text: str,
    max_bubbles: int = MAX_BUBBLES,
    tracking_urls: list[dict[str, str]] | None = None,
) -> str:
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

    return apply_link_tracking("\n\n".join(bubbles), tracking_urls)
