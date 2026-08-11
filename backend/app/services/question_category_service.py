import hashlib
import json
import re
from dataclasses import dataclass

from openai import AsyncOpenAI

from app.config import get_settings


CATEGORY_CATALOG: dict[str, str] = {
    "cancel": "취소·환불",
    "schedule": "개강·모집 일정",
    "cost": "수강료·지원금",
    "employment": "취업·진로",
    "recommendation": "과정 추천·비교",
    "class_format": "수업 방식·난이도",
    "instructor": "강사진·멘토링",
    "benefits": "교육 혜택·지원",
    "certificate": "자격증·인증",
    "counseling": "상담·문의 연결",
    "admission": "지원 자격·선발",
    "curriculum": "과정·커리큘럼",
    "attendance": "출결·수료 기준",
    "campus": "캠퍼스·시설",
    "privacy": "개인정보·정책",
    "chatbot": "챗봇 사용·오류",
    "greeting": "인사·일상 대화",
    "organization": "기관·교육 일반",
    "out_of_scope": "교육 외 질문",
    "general": "일반 문의",
}

CATEGORY_RULES = (
    ("cancel", ("취소", "환불", "중도포기", "일정변경", "철회")),
    ("schedule", ("개강", "일정", "기수", "모집기간", "모집일", "교육기간", "시간표", "몇시", "언제", "주말", "평일")),
    ("cost", ("수강료", "교육비", "비용", "지원금", "장려금", "훈련비", "내일배움", "국비", "무료", "자부담", "결제")),
    ("employment", ("취업", "채용", "진로", "포트폴리오", "기업연계", "협약기업", "취업처", "이력서", "수료후", "연봉")),
    ("recommendation", ("추천", "비교", "차이", "어떤과정", "무슨과정", "뭐가좋", "적합", "맞는과정", "선택")),
    ("class_format", ("온라인", "오프라인", "비대면", "대면", "수업방식", "진행방식", "난이도", "초보", "입문", "코딩몰라", "따라갈", "실습")),
    ("instructor", ("강사", "강사진", "멘토", "멘토링", "튜터", "코칭", "질문답변", "피드백")),
    ("benefits", ("노트북", "교재", "장비", "점심", "식사", "식비", "혜택", "제공", "지원사항")),
    ("certificate", ("자격증", "인증서", "수료증", "학점", "자격취득")),
    ("counseling", ("상담원", "상담", "매니저", "전화", "연락", "담당자", "사람과")),
    ("admission", ("지원", "신청", "자격", "비전공", "전공자", "면접", "인터뷰", "코딩테스트", "선발", "합격", "나이", "연령", "재직자", "구직자", "대학생", "졸업자")),
    ("curriculum", ("과정", "커리큘럼", "교육내용", "배우", "수업", "프로젝트", "학습", "기술", "머신러닝", "mlops", "데이터", "ai", "인공지능", "개발자")),
    ("attendance", ("출석", "출결", "결석", "지각", "조퇴", "수료", "휴가", "병가")),
    ("campus", ("캠퍼스", "위치", "주소", "어디서", "동작", "서초", "가산", "g밸리", "시설", "주차", "교통", "지하철")),
    ("privacy", ("개인정보", "정보보호", "보관기간", "삭제요청", "동의", "약관", "정책", "법률", "법적")),
    ("chatbot", ("챗봇", "답변오류", "오류", "에러", "안돼", "안되", "응답없", "사용법", "봇")),
    ("greeting", ("안녕", "반가워", "고마워", "감사", "잘가", "누구야", "뭐해", "도와줘")),
    ("organization", ("엔코아", "플레이데이터", "ai캠퍼스", "교육기관", "부트캠프", "국가기간", "k디지털")),
)


@dataclass(frozen=True)
class QuestionCategory:
    key: str
    label: str
    source: str


def categorize_question_rule(question: str) -> QuestionCategory:
    normalized = "".join((question or "").lower().split())
    for key, keywords in CATEGORY_RULES:
        if any(keyword in normalized for keyword in keywords):
            return QuestionCategory(key, CATEGORY_CATALOG[key], "rule")
    return QuestionCategory("general", CATEGORY_CATALOG["general"], "pending")


def _safe_custom_category(label: str) -> tuple[str, str]:
    cleaned = re.sub(r"[\r\n\t]", " ", str(label or "")).strip()[:30]
    if not cleaned or cleaned in {"기타", "일반", "일반 문의", "미분류"}:
        cleaned = "맥락형 후속 질문"
    digest = hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:10]
    return f"custom_{digest}", cleaned


async def classify_questions_batch(items: list[dict]) -> dict[int, QuestionCategory]:
    if not items or not get_settings().openai_api_key:
        return {}
    catalog = "\n".join(f"- {key}: {label}" for key, label in CATEGORY_CATALOG.items() if key != "general")
    prompt = f"""당신은 교육 상담 대화 분석가입니다.
각 실제 사용자 질문을 의미에 따라 분류하세요. 우선 아래 기존 카테고리를 사용하세요.
{catalog}

기존 카테고리에 맞지 않으면 질문 내용을 직접 이해해서 2~12자의 구체적인 한국어 새 카테고리명을 만드세요.
'기타', '일반', '일반 문의', '미분류'라는 이름은 절대 사용하지 마세요.
짧은 후속 질문도 문장 자체의 의도를 최대한 표현하세요(예: 재설명 요청, 긍정 응답, 부정 응답).

반드시 다음 JSON 형식만 출력하세요.
{{"items":[{{"id":1,"category_key":"기존 key 또는 new","category_label":"표시명"}}]}}
"""
    payload = [{"id": int(item["id"]), "question": str(item.get("question") or "")[:500]} for item in items]
    client = AsyncOpenAI(api_key=get_settings().openai_api_key)
    try:
        response = await client.chat.completions.create(
            model=get_settings().intent_model_name,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=2000,
            temperature=0,
        )
        parsed = json.loads(response.choices[0].message.content or "{}")
    except Exception:
        return {}

    valid_ids = {int(item["id"]) for item in items}
    results: dict[int, QuestionCategory] = {}
    for item in parsed.get("items", []):
        try:
            row_id = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        if row_id not in valid_ids:
            continue
        key = str(item.get("category_key") or "").strip().lower()
        if key in CATEGORY_CATALOG and key != "general":
            results[row_id] = QuestionCategory(key, CATEGORY_CATALOG[key], "llm")
        else:
            custom_key, custom_label = _safe_custom_category(item.get("category_label") or "")
            results[row_id] = QuestionCategory(custom_key, custom_label, "llm")
    return results
