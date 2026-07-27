import unittest

from app.services.employment_service import (
    EMPLOYMENT_RESPONSIBILITY_ANSWER,
    SPECIFIC_EMPLOYER_OUTCOME_ANSWER,
    is_employment_responsibility_query,
    is_specific_employer_outcome_query,
    should_handoff_after_employment_responsibility,
)


class EmploymentServiceTest(unittest.TestCase):
    def test_detects_specific_employer_outcome_question(self):
        self.assertTrue(is_specific_employer_outcome_query("하이닉스로도 취업 많이 하나요?"))
        self.assertTrue(is_specific_employer_outcome_query("삼성전자에 입사할 수 있나요?"))
        self.assertTrue(is_specific_employer_outcome_query("네이버 취업 가능해요?"))

    def test_does_not_capture_general_employment_support_question(self):
        self.assertFalse(is_specific_employer_outcome_query("취업 지원은 어떻게 해주나요?"))
        self.assertFalse(is_specific_employer_outcome_query("수료 후 어디로 취업하나요?"))
        self.assertFalse(is_specific_employer_outcome_query("엔코아 단독 채용 전형이 있나요?"))

    def test_answer_does_not_imply_specific_employer_success(self):
        self.assertNotIn("노려볼 수", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertNotIn("취업 가능", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertNotIn("확인된 정보", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertNotIn("취업 사례", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertIn("수강만으로 가능 여부나 취업 규모를 판단할 수 없어요", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertIn("엔코아 단독 채용 전형", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertIn("파트너사 채용 추천", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertIn("기수마다 우수 수료생 2명", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertIn("수료 후 6개월간 우선 채용 추천 대상자", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)
        self.assertIn("보장한다는 뜻은 아닙니다", SPECIFIC_EMPLOYER_OUTCOME_ANSWER)

    def test_detects_employment_responsibility_question(self):
        self.assertTrue(is_employment_responsibility_query("대기업에 못가면 누구 책임이야?"))
        self.assertTrue(is_employment_responsibility_query("취업이 안 되면 교육기관 책임인가요?"))
        self.assertTrue(is_employment_responsibility_query("입사 못 하면 누가 책임져요?"))

    def test_does_not_treat_general_responsibility_as_employment_question(self):
        self.assertFalse(is_employment_responsibility_query("교육 담당자는 누구인가요?"))
        self.assertFalse(is_employment_responsibility_query("취업 지원은 누가 해주나요?"))
        self.assertFalse(is_employment_responsibility_query("상담 매니저와 연결해 주세요"))

    def test_responsibility_answer_explains_roles_without_handoff(self):
        self.assertIn("교육과 취업지원 프로그램을 제공할 책임", EMPLOYMENT_RESPONSIBILITY_ANSWER)
        self.assertIn("기업의 심사 결과", EMPLOYMENT_RESPONSIBILITY_ANSWER)
        self.assertIn("어느 한쪽의 책임", EMPLOYMENT_RESPONSIBILITY_ANSWER)
        self.assertNotIn("상담 매니저", EMPLOYMENT_RESPONSIBILITY_ANSWER)
        self.assertNotIn("연결", EMPLOYMENT_RESPONSIBILITY_ANSWER)

    def test_handoffs_complaint_after_responsibility_answer(self):
        history = [{"role": "assistant", "content": EMPLOYMENT_RESPONSIBILITY_ANSWER}]

        self.assertTrue(
            should_handoff_after_employment_responsibility(
                "그게 말이 돼? 결국 아무도 책임 안 진다는 거잖아.",
                history,
            )
        )
        self.assertTrue(
            should_handoff_after_employment_responsibility(
                "이 답변은 납득이 안 되고 너무 황당해요.",
                history,
            )
        )

    def test_does_not_handoff_neutral_followup_after_responsibility_answer(self):
        history = [{"role": "assistant", "content": EMPLOYMENT_RESPONSIBILITY_ANSWER}]

        self.assertFalse(
            should_handoff_after_employment_responsibility(
                "그러면 취업 지원은 언제부터 받을 수 있나요?",
                history,
            )
        )

    def test_does_not_handoff_complaint_without_responsibility_context(self):
        history = [{"role": "assistant", "content": "교육 일정을 안내해 드릴게요."}]

        self.assertFalse(
            should_handoff_after_employment_responsibility(
                "이 답변은 납득이 안 돼요.",
                history,
            )
        )


if __name__ == "__main__":
    unittest.main()
