from dataclasses import dataclass

from app.services.faq_service import is_guide_query, match_faq
from app.services.rag_service import get_rag_service


@dataclass
class RetrievalPlan:
    strategy: str = "hybrid"
    top_k: int = 4
    files: list[str] | None = None
    query: str | None = None


@dataclass
class SearchResult:
    context: str
    chunks: list[str]
    top_score: float = 0.0


COURSE_FILES = ["course_ai_orchestration", "course_ml_engineer", "course_mlops"]
PLAYDATA_FILES = ["playdata_intro", "campus_info", "homepage_intro"]
REGULATION_FILES = [
    "national_training_card_eligibility",
    "national_training_card_regulation",
    "vocational_training_regulation",
]
LAW_FILES = ["privacy_law", "fair_labeling_law"]

CATEGORY_TO_FILES = {
    "과정 상세": COURSE_FILES,
    "플레이데이터 정보": PLAYDATA_FILES,
    "운영규정": REGULATION_FILES,
    "법령": LAW_FILES,
    "카테고리 안내": COURSE_FILES + PLAYDATA_FILES + REGULATION_FILES + LAW_FILES,
}


def _merge_files(*groups: list[str] | None) -> list[str]:
    merged: list[str] = []
    for group in groups:
        for item in group or []:
            if item not in merged:
                merged.append(item)
    return merged


# 과정별 식별 키워드 — 질문이 '한 과정'만 가리키면 다른 과정 문서를 검색에서 제외해
# 컨텍스트 혼입(예: 오케스트레이션 질문에 MLOps의 K8s/CI·CD가 섞여 환각)을 막는다.
_COURSE_KEYWORDS = {
    "course_ai_orchestration": ("오케스트레이션", "오케스트레이", "멀티 에이전트", "멀티에이전트"),
    "course_mlops": ("mlops", "엠엘옵스", "엠엘 옵스", "데이터 엔지니어링", "데이터엔지니어링", "ai ready"),
    "course_ml_engineer": ("머신러닝", "머신 러닝", "데이터 분석"),
}

_COMPARISON_TOKENS = ("비교", "차이", "다른 점", "다른점", "모두", "세 과정", "세과정", "vs")


def _detect_single_course(lowered: str) -> str | None:
    """질문이 '정확히 한 과정'만 가리키면 해당 과정 문서명을 반환(아니면 None)."""
    hits = [f for f, kws in _COURSE_KEYWORDS.items() if any(k in lowered for k in kws)]
    return hits[0] if len(hits) == 1 else None


def build_retrieval_plan(query: str) -> RetrievalPlan:
    lowered = query.lower()

    if any(token in lowered for token in ["어떤 질문", "질문 추천", "무슨 질문", "뭐 물어봐"]):
        return RetrievalPlan(strategy="keyword", top_k=3)

    is_comparison = any(token in lowered for token in _COMPARISON_TOKENS)

    if is_comparison:
        plan = RetrievalPlan(strategy="mmr", top_k=6, files=_merge_files(COURSE_FILES, PLAYDATA_FILES))
    elif any(token in lowered for token in ["교육비", "수강료", "훈련장려금", "본인부담금", "지원금", "얼마", "기간", "출결"]):
        plan = RetrievalPlan(strategy="hybrid", top_k=6, files=_merge_files(REGULATION_FILES, PLAYDATA_FILES, COURSE_FILES))
    elif any(token in lowered for token in ["개인정보", "광고", "허위", "과장", "보관 기간", "파기"]):
        plan = RetrievalPlan(strategy="keyword", top_k=5, files=LAW_FILES)
    elif any(token in lowered for token in ["프로그램", "커리큘럼", "수업", "교육 과정"]):
        plan = RetrievalPlan(strategy="mmr", top_k=8, files=_merge_files(COURSE_FILES, PLAYDATA_FILES))
    elif any(token in lowered for token in ["비전공자", "어떤 사람", "추천", "취업", "직무", "과정"]):
        plan = RetrievalPlan(strategy="hybrid", top_k=6, files=_merge_files(COURSE_FILES, PLAYDATA_FILES))
    elif any(token in lowered for token in ["캠퍼스", "운영시간", "수업시간", "노트북", "교재", "플레이데이터"]):
        plan = RetrievalPlan(strategy="hybrid", top_k=5, files=PLAYDATA_FILES)
    else:
        plan = RetrievalPlan(strategy="hybrid", top_k=4)

    # 한 과정만 지목된(비교 아님) 질문이면 다른 과정 문서를 제외 → 과정 간 내용 혼입 차단.
    # 규정·플레이데이터 등 비-과정 문서는 그대로 두고, '다른 과정' 문서만 떨어낸다.
    single = None if is_comparison else _detect_single_course(lowered)
    if single:
        kept = [f for f in (plan.files or []) if f not in COURSE_FILES]
        plan.files = _merge_files([single], kept)

    return plan


def search_documents(query: str, top_k: int = 4) -> SearchResult:
    plan = build_retrieval_plan(query)
    search_query = query

    faq_match = match_faq(query)
    if faq_match and not is_guide_query(query):
        score, faq = faq_match
        if score >= 6.0:
            hinted_files = faq.get("source_files", [])
            category_files = CATEGORY_TO_FILES.get(faq.get("category", ""), [])
            plan.files = _merge_files(plan.files, hinted_files, category_files)

            expansion_parts = [
                query,
                faq.get("question", ""),
                " ".join(faq.get("keywords", [])),
                " ".join(faq.get("aliases", [])[:3]),
                " ".join(faq.get("search_hints", [])[:3]),
            ]
            search_query = " ".join(part for part in expansion_parts if part)
            plan.top_k = max(plan.top_k, min(faq.get("top_k", 6), 8))

    docs, top_score = get_rag_service().search_documents_scored(
        plan.query or search_query,
        top_k=plan.top_k or top_k,
        strategy=plan.strategy,
        files=plan.files,
    )
    chunks = [doc.page_content for doc in docs]
    return SearchResult(
        context="\n\n---\n\n".join(chunks),
        chunks=chunks,
        top_score=top_score,
    )
