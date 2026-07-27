"""엔코아 AI 캠퍼스 홈페이지의 최신 과정 정보를 하루 단위로 동기화한다.

페이지 원본을 매 요청마다 읽지 않는다. 검증을 통과한 스냅샷만 DB(AppSetting)에
원자적으로 저장하고, 채팅 요청은 그 스냅샷을 읽는다. 수집 실패 시 마지막 정상
스냅샷을 유지해 홈페이지 장애가 챗봇 장애로 번지지 않게 한다.
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any
from urllib.request import Request, urlopen

logger = logging.getLogger("app.website_course_sync")

SNAPSHOT_SETTING_KEY = "website_course_snapshot"
SYNC_STATUS_SETTING_KEY = "website_course_sync_status"
INTRO_URL = "https://encorecampus.ai/introduce"
SNAPSHOT_SCHEMA_VERSION = 1
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
MAX_CONTENT_BLOCKS = 900
MAX_CONTENT_CHARS = 90_000


@dataclass(frozen=True)
class CourseSpec:
    key: str
    name: str
    detail_url: str
    registration_url: str
    aliases: tuple[str, ...]


COURSES = (
    CourseSpec(
        key="orchestration",
        name="멀티 에이전트 AI 오케스트레이션 캠프",
        detail_url="https://encorecampus.ai/orchestration",
        registration_url="https://encorecampus.ai/registration_orchestration",
        aliases=("오케스트레이션", "오케스트레이", "멀티 에이전트", "멀티에이전트"),
    ),
    CourseSpec(
        key="ml",
        name="데이터 분석 & AI 머신러닝 캠프",
        detail_url="https://encorecampus.ai/ml",
        registration_url="https://encorecampus.ai/registration_ml",
        aliases=("머신러닝", "머신 러닝", "데이터 분석", "graphrag", "지식그래프"),
    ),
    CourseSpec(
        key="mlops",
        name="AI Ready 데이터 엔지니어링 캠프",
        detail_url="https://encorecampus.ai/mlops",
        registration_url="https://encorecampus.ai/registration_mlops",
        aliases=("ai ready", "데이터 엔지니어링", "데이터엔지니어링", "mlops", "엠엘옵스"),
    ),
)

_COURSE_BY_KEY = {course.key: course for course in COURSES}
_LIVE_FACT_SIGNALS = (
    "교육일정",
    "교육 일정",
    "개강",
    "기수",
    "몇 기",
    "몇기",
    "교육시간",
    "교육 시간",
    "수업시간",
    "수업 시간",
    "교육장소",
    "교육 장소",
    "교육비",
    "수강료",
    "훈련지원금",
    "훈련 지원금",
)
_COURSE_DETAIL_SIGNALS = (
    "커리큘럼",
    "상세",
    "배우",
    "학습",
    "프로젝트",
    "기술",
    "과정 소개",
    "과정 비교",
    "과정 차이",
    "세 과정",
    "세과정",
)
_BLOCK_TAGS = {
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "p",
    "section",
    "table",
    "td",
    "th",
    "tr",
    "ul",
}
_SKIP_TAGS = {"script", "style", "noscript", "svg"}
_TOKEN_RE = re.compile(r"[0-9A-Za-z가-힣]{2,}")
_QUERY_STOPWORDS = {
    "과정",
    "세과정",
    "차이",
    "비교",
    "비교해줘",
    "알려줘",
    "소개",
    "설명",
}

_cache_lock = threading.RLock()
_refresh_lock = threading.Lock()
_cached_snapshot: dict[str, Any] | None = None
_cache_loaded_at = 0.0


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        if lowered in _SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth == 0 and lowered in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth == 0 and lowered in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data:
            self._parts.append(data)

    def blocks(self) -> list[str]:
        text = html.unescape("".join(self._parts))
        blocks: list[str] = []
        seen: set[str] = set()
        total_chars = 0
        for raw in text.splitlines():
            cleaned = re.sub(r"\s+", " ", raw).strip()
            if len(cleaned) < 2 or cleaned in seen:
                continue
            if cleaned in {"MENU", "Image", "알림", "지금 합류하기", "자세히 보기"}:
                continue
            if "더블클릭하여 내용 수정" in cleaned or "단락 구분(P 태그)" in cleaned:
                continue
            if "개인정보 보호책임자" in cleaned:
                break
            seen.add(cleaned)
            blocks.append(cleaned)
            total_chars += len(cleaned)
            if len(blocks) >= MAX_CONTENT_BLOCKS or total_chars >= MAX_CONTENT_CHARS:
                break
        return blocks


def html_to_blocks(source: str) -> list[str]:
    parser = _VisibleTextParser()
    parser.feed(source or "")
    parser.close()
    return parser.blocks()


def _collapsed(blocks: list[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(blocks)).strip()


def _normalize_date(value: str) -> str:
    parts = re.findall(r"\d+", value)
    if len(parts) != 3:
        raise ValueError(f"날짜 형식이 올바르지 않습니다: {value}")
    parsed = datetime(int(parts[0]), int(parts[1]), int(parts[2]))
    return parsed.strftime("%Y.%m.%d")


def _extract_required(pattern: str, text: str, field: str, flags: int = re.IGNORECASE) -> str:
    match = re.search(pattern, text, flags)
    if not match:
        raise ValueError(f"홈페이지에서 {field} 항목을 찾지 못했습니다.")
    return re.sub(r"\s+", " ", match.group(1)).strip()


def _extract_training_support(detail_text: str, intro_text: str) -> str:
    combined = f"{detail_text} {intro_text}"
    monthly = re.search(r"월\s*최대\s*([0-9,]+)\s*만\s*원", combined)
    # 비교표에는 일반 KDT(180만원)와 엔코아 과정(240만원)이 함께 나온다.
    # 반드시 엔코아 AI 캠퍼스 행을 먼저 찾고, 구조가 바뀐 경우에만 후보 중
    # 가장 큰 공개 금액을 폴백으로 사용한다.
    total = re.search(
        r"엔코아\s+AI\s+캠퍼스\s+교육비\s+0\s*원\s+"
        r"훈련지원금\s*(?:은\s*)?(?:총\s*)?([0-9,]+)\s*만\s*원",
        combined,
        re.IGNORECASE,
    )
    if not total:
        candidates = [
            int(value.replace(",", ""))
            for value in re.findall(
                r"훈련지원금.{0,30}?([0-9,]+)\s*만\s*원",
                combined,
            )
        ]
        if candidates:
            total_value = str(max(candidates))
            total = re.match(r"(.+)", total_value)
    if monthly and total:
        return (
            f"월 최대 {monthly.group(1)}만 원, 6개월 수강 기준 총 {total.group(1)}만 원"
            "(출석·지급 요건 충족 시)"
        )
    if total:
        return f"6개월 수강 기준 총 {total.group(1)}만 원(출석·지급 요건 충족 시)"
    raise ValueError("홈페이지에서 훈련지원금 항목을 찾지 못했습니다.")


def _extract_course(
    spec: CourseSpec,
    detail_html: str,
    registration_html: str,
    intro_text: str,
) -> dict[str, Any]:
    detail_blocks = html_to_blocks(detail_html)
    registration_blocks = html_to_blocks(registration_html)
    detail_text = _collapsed(detail_blocks)
    registration_text = _collapsed(registration_blocks)

    schedule_match = re.search(
        r"교육일정\s*(20\d{2}[./-]\d{1,2}[./-]\d{1,2})\s*~\s*"
        r"(20\d{2}[./-]\d{1,2}[./-]\d{1,2})",
        detail_text,
    )
    if not schedule_match:
        raise ValueError(f"{spec.name} 교육일정을 찾지 못했습니다.")
    start_date = _normalize_date(schedule_match.group(1))
    end_date = _normalize_date(schedule_match.group(2))
    if datetime.strptime(start_date, "%Y.%m.%d") >= datetime.strptime(end_date, "%Y.%m.%d"):
        raise ValueError(f"{spec.name} 교육 시작일과 종료일이 올바르지 않습니다.")

    education_time = _extract_required(
        r"교육시간\s*(.+?)\s*교육장소",
        detail_text,
        f"{spec.name} 교육시간",
    )
    location = _extract_required(
        r"교육장소\s*(.+?)\s*교육비",
        detail_text,
        f"{spec.name} 교육장소",
    )
    tuition = _extract_required(
        r"교육비\s*([0-9,]+\s*원\s*(?:→|->)\s*0\s*원|0\s*원)",
        detail_text,
        f"{spec.name} 교육비",
    )

    cohort_match = re.search(
        r"(\d+)\s*기\s*\(\s*(\d{1,2})월\s*(\d{1,2})일\s*/\s*([^)]+)\)",
        registration_text,
    )
    if not cohort_match:
        raise ValueError(f"{spec.name} 신청서에서 모집 기수를 찾지 못했습니다.")
    cohort = f"{cohort_match.group(1)}기"
    registration_month = int(cohort_match.group(2))
    registration_day = int(cohort_match.group(3))
    registration_location = cohort_match.group(4).strip()
    start_dt = datetime.strptime(start_date, "%Y.%m.%d")
    if (registration_month, registration_day) != (start_dt.month, start_dt.day):
        raise ValueError(
            f"{spec.name} 상세 페이지 일정과 신청서 기수 일정이 일치하지 않습니다: "
            f"{start_date} / {registration_month}월 {registration_day}일"
        )

    return {
        "key": spec.key,
        "name": spec.name,
        "cohort": cohort,
        "schedule_start": start_date,
        "schedule_end": end_date,
        "education_time": education_time,
        "location": location,
        "registration_location": registration_location,
        "tuition": tuition,
        "training_support": _extract_training_support(detail_text, intro_text),
        "detail_url": spec.detail_url,
        "registration_url": spec.registration_url,
        "content_blocks": detail_blocks,
    }


def build_snapshot_from_html(
    pages: dict[str, str],
    fetched_at: datetime | None = None,
) -> dict[str, Any]:
    fetched_at = fetched_at or datetime.now(timezone.utc)
    intro_html = pages.get(INTRO_URL)
    if not intro_html:
        raise ValueError("홈페이지 소개 페이지 응답이 없습니다.")
    intro_blocks = html_to_blocks(intro_html)
    intro_text = _collapsed(intro_blocks)

    courses: list[dict[str, Any]] = []
    for spec in COURSES:
        detail_html = pages.get(spec.detail_url)
        registration_html = pages.get(spec.registration_url)
        if not detail_html or not registration_html:
            raise ValueError(f"{spec.name} 페이지 또는 신청서 응답이 없습니다.")
        courses.append(_extract_course(spec, detail_html, registration_html, intro_text))

    canonical = json.dumps(courses, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "fetched_at": fetched_at.astimezone(timezone.utc).isoformat(),
        "content_hash": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "courses": courses,
        "overview_blocks": intro_blocks,
        "source_urls": [INTRO_URL]
        + [url for spec in COURSES for url in (spec.detail_url, spec.registration_url)],
    }


def _fetch_url(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; EncoreCampusCourseSync/1.0; "
                "+https://encorecampus.ai/)"
            ),
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
    )
    timeout = max(5, int(os.getenv("WEBSITE_FETCH_TIMEOUT_SECONDS", "30")))
    with urlopen(request, timeout=timeout) as response:
        status = getattr(response, "status", 200)
        if status != 200:
            raise RuntimeError(f"{url} 응답 코드가 {status}입니다.")
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise RuntimeError(f"{url} 응답이 허용 크기를 초과했습니다.")
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def fetch_all_pages() -> dict[str, str]:
    urls = [INTRO_URL] + [url for spec in COURSES for url in (spec.detail_url, spec.registration_url)]
    pages: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_to_url = {executor.submit(_fetch_url, url): url for url in urls}
        for future in as_completed(future_to_url):
            url = future_to_url[future]
            pages[url] = future.result()
    return pages


def _snapshot_age_seconds(snapshot: dict[str, Any] | None) -> float | None:
    if not snapshot or not snapshot.get("fetched_at"):
        return None
    try:
        fetched_at = datetime.fromisoformat(str(snapshot["fetched_at"]).replace("Z", "+00:00"))
        return max(0.0, (datetime.now(timezone.utc) - fetched_at.astimezone(timezone.utc)).total_seconds())
    except (TypeError, ValueError):
        return None


def _read_snapshot_from_db() -> dict[str, Any] | None:
    from app.db.database import SessionLocal
    from app.db.models import AppSetting

    db = SessionLocal()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == SNAPSHOT_SETTING_KEY).first()
        if not row or not row.value:
            return None
        payload = json.loads(row.value)
        if payload.get("schema_version") != SNAPSHOT_SCHEMA_VERSION:
            return None
        return payload
    finally:
        db.close()


def get_course_snapshot(cache_seconds: int = 300) -> dict[str, Any] | None:
    global _cached_snapshot, _cache_loaded_at
    now = time.monotonic()
    with _cache_lock:
        if _cached_snapshot is not None and now - _cache_loaded_at < cache_seconds:
            return _cached_snapshot
    try:
        snapshot = _read_snapshot_from_db()
    except Exception:
        logger.exception("홈페이지 과정 스냅샷 DB 조회 실패")
        with _cache_lock:
            return _cached_snapshot
    with _cache_lock:
        _cached_snapshot = snapshot
        _cache_loaded_at = now
    return snapshot


def _upsert_setting(db: Any, key: str, value: str) -> None:
    from app.db.models import AppSetting

    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def _save_snapshot(snapshot: dict[str, Any]) -> None:
    global _cached_snapshot, _cache_loaded_at
    from app.db.database import SessionLocal

    db = SessionLocal()
    try:
        _upsert_setting(db, SNAPSHOT_SETTING_KEY, json.dumps(snapshot, ensure_ascii=False))
        _upsert_setting(
            db,
            SYNC_STATUS_SETTING_KEY,
            json.dumps(
                {
                    "status": "success",
                    "fetched_at": snapshot["fetched_at"],
                    "content_hash": snapshot["content_hash"],
                },
                ensure_ascii=False,
            ),
        )
        db.commit()
    finally:
        db.close()
    with _cache_lock:
        _cached_snapshot = snapshot
        _cache_loaded_at = time.monotonic()


def _save_sync_error(exc: Exception) -> None:
    try:
        from app.db.database import SessionLocal

        db = SessionLocal()
        try:
            _upsert_setting(
                db,
                SYNC_STATUS_SETTING_KEY,
                json.dumps(
                    {
                        "status": "failed",
                        "attempted_at": datetime.now(timezone.utc).isoformat(),
                        "error": str(exc)[:1000],
                    },
                    ensure_ascii=False,
                ),
            )
            db.commit()
        finally:
            db.close()
    except Exception:
        logger.exception("홈페이지 동기화 실패 상태 저장 중 추가 오류")


def refresh_course_snapshot(force: bool = False) -> dict[str, Any] | None:
    """24시간이 지난 경우에만 새 스냅샷을 만든다. 실패하면 기존 스냅샷을 반환한다."""
    from app.config import get_settings

    settings = get_settings()
    if not settings.website_sync_enabled:
        return get_course_snapshot()
    with _refresh_lock:
        current = get_course_snapshot(cache_seconds=0)
        max_age = max(1, int(settings.website_sync_interval_hours)) * 3600
        age = _snapshot_age_seconds(current)
        if not force and age is not None and age < max_age:
            return current
        try:
            snapshot = build_snapshot_from_html(fetch_all_pages())
            _save_snapshot(snapshot)
            logger.info(
                "홈페이지 과정 스냅샷 갱신 완료: hash=%s",
                snapshot["content_hash"][:12],
            )
            return snapshot
        except Exception as exc:
            logger.exception("홈페이지 과정 스냅샷 갱신 실패 — 마지막 정상본 유지")
            _save_sync_error(exc)
            return current


async def website_sync_loop() -> None:
    """앱 기동 직후 확인하고 이후 매시간 만료 여부만 검사한다."""
    while True:
        try:
            await asyncio.to_thread(refresh_course_snapshot)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("홈페이지 과정 동기화 루프 오류")
        await asyncio.sleep(3600)


def course_keys_for_query(query: str) -> list[str]:
    lowered = (query or "").lower()
    return [
        spec.key
        for spec in COURSES
        if any(alias in lowered for alias in spec.aliases)
    ]


def is_live_course_fact_query(query: str) -> bool:
    lowered = (query or "").lower()
    return any(signal in lowered for signal in _LIVE_FACT_SIGNALS)


def should_use_website_context(query: str) -> bool:
    lowered = (query or "").lower()
    return bool(course_keys_for_query(lowered)) or any(
        signal in lowered for signal in _LIVE_FACT_SIGNALS + _COURSE_DETAIL_SIGNALS
    )


def _tokenize(value: str) -> set[str]:
    return {token.lower() for token in _TOKEN_RE.findall(value or "")}


def _select_relevant_blocks(blocks: list[str], query: str, limit: int = 10) -> list[str]:
    query_tokens = _tokenize(query) - _QUERY_STOPWORDS
    scored: list[tuple[float, int, str]] = []
    for index, block in enumerate(blocks):
        block_tokens = _tokenize(block)
        overlap = len(query_tokens & block_tokens)
        score = overlap * 3.0
        lowered = block.lower()
        if query.strip() and query.lower().replace(" ", "") in lowered.replace(" ", ""):
            score += 5.0
        if any(signal in lowered for signal in _LIVE_FACT_SIGNALS):
            score += 0.5
        if score > 0:
            scored.append((score, index, block))
    scored.sort(key=lambda item: (-item[0], item[1]))
    chosen: set[int] = set()
    for _, index, _ in scored[:limit]:
        # 제목과 본문이 별도 HTML 블록인 경우가 많으므로 앞뒤 블록을 함께 싣는다.
        for neighbor in (index - 1, index, index + 1):
            if 0 <= neighbor < len(blocks):
                chosen.add(neighbor)
    chosen_indices = sorted(chosen)
    if not chosen_indices:
        chosen_indices = list(range(min(5, len(blocks))))
    return [blocks[index] for index in chosen_indices]


def build_website_context_from_snapshot(
    snapshot: dict[str, Any],
    query: str,
) -> str:
    requested_keys = course_keys_for_query(query)
    include_all = not requested_keys and should_use_website_context(query)
    if not requested_keys and not include_all:
        return ""

    sections = [
        "[공식 홈페이지 최신 정보 — 아래 항목이 승인 문서와 충돌하면 이 정보를 우선 적용]"
    ]
    for course in snapshot.get("courses", []):
        if requested_keys and course.get("key") not in requested_keys:
            continue
        sections.append(
            "\n".join(
                [
                    f"과정명: {course.get('name', '')}",
                    f"현재 모집 기수: {course.get('cohort', '')}",
                    (
                        f"교육일정: {course.get('schedule_start', '')} "
                        f"~ {course.get('schedule_end', '')}"
                    ),
                    f"교육시간: {course.get('education_time', '')}",
                    f"교육장소: {course.get('location', '')}",
                    f"교육비: {course.get('tuition', '')}",
                    f"훈련지원금: {course.get('training_support', '')}",
                    f"과정 상세 URL: {course.get('detail_url', '')}",
                    f"신청서 URL: {course.get('registration_url', '')}",
                ]
            )
        )
        relevant = _select_relevant_blocks(course.get("content_blocks", []), query)
        if relevant:
            sections.append("[홈페이지 과정 상세 발췌]\n" + "\n".join(f"- {item}" for item in relevant))

    if include_all and any(token in (query or "") for token in ("비교", "차이", "세 과정", "세과정")):
        overview = _select_relevant_blocks(snapshot.get("overview_blocks", []), query, limit=8)
        if overview:
            sections.append("[홈페이지 공통 소개 발췌]\n" + "\n".join(f"- {item}" for item in overview))
    return "\n\n".join(section for section in sections if section.strip())


def get_website_course_context(query: str) -> str:
    snapshot = get_course_snapshot()
    if not snapshot:
        return ""
    return build_website_context_from_snapshot(snapshot, query)


def build_schedule_answer_from_snapshot(snapshot: dict[str, Any], query: str = "") -> str:
    requested_keys = course_keys_for_query(query)
    selected = [
        course
        for course in snapshot.get("courses", [])
        if not requested_keys or course.get("key") in requested_keys
    ]
    if not selected:
        return ""
    parts = ["현재 홈페이지에서 모집 중인 과정 일정을 안내해 드릴게요."]
    for course in selected:
        parts.append(
            "\n".join(
                [
                    f"**{course.get('name', '')} {course.get('cohort', '')}**",
                    (
                        f"- 교육일정: {course.get('schedule_start', '')} "
                        f"~ {course.get('schedule_end', '')}"
                    ),
                    f"- 교육시간: {course.get('education_time', '')}",
                    f"- 교육장소: {course.get('location', '')}",
                    f"- 교육비: {course.get('tuition', '')}",
                    f"- 훈련지원금: {course.get('training_support', '')}",
                    f"- [과정 자세히 보기]({course.get('detail_url', '')})",
                    f"- [지원서 확인하기]({course.get('registration_url', '')})",
                ]
            )
        )
    return "\n\n".join(parts)


def get_live_schedule_answer(query: str = "") -> str | None:
    snapshot = get_course_snapshot()
    if not snapshot:
        return None
    answer = build_schedule_answer_from_snapshot(snapshot, query)
    return answer or None
