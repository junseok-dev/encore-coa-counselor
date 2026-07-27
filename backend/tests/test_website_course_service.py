import unittest
from datetime import datetime, timezone

from app.services.website_course_service import (
    COURSES,
    INTRO_URL,
    build_schedule_answer_from_snapshot,
    build_snapshot_from_html,
    build_website_context_from_snapshot,
)


DETAIL_TEMPLATE = """
<html><body>
  <h1>{name}</h1>
  <section>
    <h2>교육일정</h2><p>{start} ~ {end}</p>
    <h2>교육시간</h2><p>주중(월~금) 09:00 ~ 18:00</p>
    <h2>교육장소</h2><p>{location}(서울) *역 도보 5분, 100% 오프라인</p>
    <h2>교육비</h2><p>17,424,000원 → 0원</p>
  </section>
  <h2>커리큘럼</h2>
  <p>{detail}</p>
  <script>과거 일정 2025.01.01</script>
</body></html>
"""

INTRO_HTML = """
<html><body>
  <h1>엔코아 AI 캠퍼스</h1>
  <p>월 최대 40만 원 훈련지원금</p>
  <div>기존 K-디지털 트레이닝 과정 교육비 40만원 훈련지원금 총 180만원</div>
  <div>엔코아 AI 캠퍼스 교육비 0원 훈련지원금 총 240만원</div>
  <p>*훈련지원금은 6개월 수강 기준 총 금액입니다.</p>
</body></html>
"""


class WebsiteCourseServiceTest(unittest.TestCase):
    def _pages(self):
        schedule = {
            "orchestration": ("2026.07.30", "2027.01.21", "동작캠퍼스", "LangGraph 멀티에이전트 협업"),
            "ml": ("2026.08.13", "2027.02.05", "동작캠퍼스", "지식그래프 GraphRAG 신뢰성 평가"),
            "mlops": ("2026.08.18", "2027.02.11", "G밸리캠퍼스", "데이터 파이프라인 MLOps 자동화"),
        }
        pages = {INTRO_URL: INTRO_HTML}
        for spec in COURSES:
            start, end, location, detail = schedule[spec.key]
            pages[spec.detail_url] = DETAIL_TEMPLATE.format(
                name=spec.name,
                start=start,
                end=end,
                location=location,
                detail=detail,
            )
            month = int(start[5:7])
            day = int(start[8:10])
            pages[spec.registration_url] = (
                f"<html><body>신청을 원하는 기수를 선택해주세요. "
                f"{spec.name} 2기 ({month}월 {day}일 / {location})</body></html>"
            )
        return pages

    def test_builds_validated_snapshot_with_current_cohorts(self):
        snapshot = build_snapshot_from_html(
            self._pages(),
            fetched_at=datetime(2026, 7, 27, tzinfo=timezone.utc),
        )
        self.assertEqual(3, len(snapshot["courses"]))
        self.assertEqual("2기", snapshot["courses"][0]["cohort"])
        self.assertEqual("2026.07.30", snapshot["courses"][0]["schedule_start"])
        self.assertIn("총 240만 원", snapshot["courses"][0]["training_support"])
        self.assertNotIn("총 180만 원", snapshot["courses"][0]["training_support"])

    def test_rejects_registration_date_mismatch(self):
        pages = self._pages()
        spec = COURSES[0]
        pages[spec.registration_url] = (
            f"<html><body>{spec.name} 2기 (7월 31일 / 동작)</body></html>"
        )
        with self.assertRaisesRegex(ValueError, "일치하지 않습니다"):
            build_snapshot_from_html(pages)

    def test_filters_context_to_requested_course_and_marks_priority(self):
        snapshot = build_snapshot_from_html(self._pages())
        context = build_website_context_from_snapshot(
            snapshot,
            "오케스트레이션 커리큘럼 알려줘",
        )
        self.assertIn("공식 홈페이지 최신 정보", context)
        self.assertIn("멀티 에이전트 AI 오케스트레이션 캠프", context)
        self.assertIn("LangGraph", context)
        self.assertNotIn("AI Ready 데이터 엔지니어링 캠프", context)

    def test_schedule_answer_can_filter_one_course(self):
        snapshot = build_snapshot_from_html(self._pages())
        answer = build_schedule_answer_from_snapshot(
            snapshot,
            "머신러닝 몇 기야?",
        )
        self.assertIn("데이터 분석 & AI 머신러닝 캠프 2기", answer)
        self.assertIn("2026.08.13", answer)
        self.assertNotIn("오케스트레이션 캠프", answer)


if __name__ == "__main__":
    unittest.main()
