import unittest

from app.services.employment_service import (
    SPECIFIC_EMPLOYER_OUTCOME_ANSWER,
    is_specific_employer_outcome_query,
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


if __name__ == "__main__":
    unittest.main()
