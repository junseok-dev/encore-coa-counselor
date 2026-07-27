import unittest

from app.services.consultation_service import (
    build_consultation_mode_directive,
    consultation_mode_for,
)


class ConsultationServiceTest(unittest.TestCase):
    def test_classifies_recommendation_questions(self):
        self.assertEqual("recommendation", consultation_mode_for("비전공자인데 어떤 과정이 좋아요?"))
        self.assertEqual("recommendation", consultation_mode_for("저한테 맞는 과정 추천해 주세요"))
        self.assertEqual("recommendation", consultation_mode_for("RAG에 관심 있으면 어느 과정을 선택해야 해요?"))
        self.assertEqual(
            "recommendation",
            consultation_mode_for(
                "비전공자인데 AI 쪽으로 취업하고 싶어. 어떤 과정이 가장 잘 맞아?"
            ),
        )

    def test_classifies_situation_questions(self):
        self.assertEqual("situation", consultation_mode_for("주말 알바와 수업을 병행할 수 있나요?"))
        self.assertEqual("situation", consultation_mode_for("비전공자도 따라갈 수 있을까요?"))

    def test_classifies_plain_fact_questions(self):
        self.assertEqual("fact", consultation_mode_for("교육 시간은 몇 시예요?"))
        self.assertEqual("fact", consultation_mode_for("교육비가 얼마예요?"))
        self.assertEqual("fact", consultation_mode_for("어떤 과정이 있어요?"))
        self.assertEqual("fact", consultation_mode_for("교육 과정 소개해 주세요"))

    def test_recommendation_directive_requires_preliminary_judgment(self):
        directive = build_consultation_mode_directive("어떤 과정이 저한테 맞아요?")

        self.assertIn("예비 추천부터", directive)
        self.assertIn("가장 가까운 과정 1개", directive)
        self.assertIn("진단 질문을 최대 1개", directive)
        self.assertNotIn("질문만 돌려주", directive.splitlines()[0])

    def test_recommendation_followup_requires_final_conclusion(self):
        directive = build_consultation_mode_directive(
            "서비스 개발 쪽이 더 좋아요",
            no_reask=True,
            recommendation_context=True,
        )

        self.assertIn("과정 추천 — 결론 단계", directive)
        self.assertIn("가장 적합한 과정 1개와 차선책 1개", directive)
        self.assertIn("추가 질문 없이", directive)

    def test_situation_directive_connects_facts_to_real_context(self):
        directive = build_consultation_mode_directive("주말 알바와 병행할 수 있어요?")

        self.assertIn("가능 여부나 판단을 분명히", directive)
        self.assertIn("실제 상황에 연결", directive)
        self.assertIn("현실적인 주의점", directive)


if __name__ == "__main__":
    unittest.main()
