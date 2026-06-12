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


def build_retrieval_plan(query: str) -> RetrievalPlan:
    lowered = query.lower()

    if any(token in lowered for token in ["어떤 질문", "질문 추천", "무슨 질문", "뭐 물어봐"]):
        return RetrievalPlan(strategy="keyword", top_k=3)

    if any(token in lowered for token in ["비교", "차이", "다른 점", "모두"]):
        return RetrievalPlan(strategy="mmr", top_k=6, files=_merge_files(COURSE_FILES, PLAYDATA_FILES))

    if any(token in lowered for token in ["교육비", "수강료", "훈련장려금", "본인부담금", "지원금", "얼마", "기간", "출결"]):
        return RetrievalPlan(
            strategy="hybrid",
            top_k=6,
            files=_merge_files(REGULATION_FILES, PLAYDATA_FILES, COURSE_FILES),
        )

    if any(token in lowered for token in ["개인정보", "광고", "허위", "과장", "보관 기간", "파기"]):
        return RetrievalPlan(strategy="keyword", top_k=5, files=LAW_FILES)

    if any(token in lowered for token in ["프로그램", "커리큘럼", "수업", "교육 과정"]):
        return RetrievalPlan(strategy="mmr", top_k=8, files=_merge_files(COURSE_FILES, PLAYDATA_FILES))

    if any(token in lowered for token in ["비전공자", "어떤 사람", "추천", "취업", "직무", "과정"]):
        return RetrievalPlan(strategy="hybrid", top_k=6, files=_merge_files(COURSE_FILES, PLAYDATA_FILES))

    if any(token in lowered for token in ["캠퍼스", "운영시간", "수업시간", "노트북", "교재", "플레이데이터"]):
        return RetrievalPlan(strategy="hybrid", top_k=5, files=PLAYDATA_FILES)

    return RetrievalPlan(strategy="hybrid", top_k=4)


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
