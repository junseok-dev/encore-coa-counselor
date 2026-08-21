import unittest

from app.services.response_formatter import apply_link_tracking, format_chat_response


class ResponseFormatterTest(unittest.TestCase):
    def test_runtime_tracking_params_are_applied_with_path_campaign(self):
        tracked = apply_link_tracking(
            "https://encorecampus.ai/ml#apply",
            [{"label": "머신러닝", "url": "https://encorecampus.ai/ml?utm_source=admin&utm_medium=chat&utm_campaign=ml"}],
        )

        self.assertEqual(
            "https://encorecampus.ai/ml?utm_source=admin&utm_medium=chat&utm_campaign=ml#apply",
            tracked,
        )

    def test_existing_tracking_values_are_replaced_by_runtime_settings(self):
        tracked = apply_link_tracking(
            "https://encorecampus.ai/ml?utm_source=old&utm_medium=old-medium&utm_campaign=ml#apply",
            [{"label": "머신러닝", "url": "https://encorecampus.ai/ml?utm_source=admin&utm_medium=chat&utm_campaign=ml"}],
        )

        self.assertEqual(
            "https://encorecampus.ai/ml?utm_source=admin&utm_medium=chat&utm_campaign=ml#apply",
            tracked,
        )

    def test_bold_list_items_stay_in_one_bubble(self):
        answer = (
            "다음과 같은 취업 지원을 제공하고 있어요.\n"
            "- **엔코아 단독 채용 전형**\n"
            "- **파트너사 채용 추천**\n"
            "- **기업 초청 채용설명회**\n"
            "- **이력서·포트폴리오 1:1 피드백**\n"
            "- **실전 기술면접 컨설팅**\n\n"
            "취업을 보장한다는 뜻은 아닙니다."
        )

        formatted = format_chat_response(answer)
        support_bubble = formatted.split("\n\n")[0]

        self.assertIn("- **엔코아 단독 채용 전형**", support_bubble)
        self.assertIn("- **파트너사 채용 추천**", support_bubble)
        self.assertIn("- **기업 초청 채용설명회**", support_bubble)
        self.assertIn("- **이력서·포트폴리오 1:1 피드백**", support_bubble)
        self.assertIn("- **실전 기술면접 컨설팅**", support_bubble)


if __name__ == "__main__":
    unittest.main()
