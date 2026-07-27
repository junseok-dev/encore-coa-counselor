import sys
import types
import unittest
from types import SimpleNamespace


# response_formatter의 링크 설정 외 기능만 독립적으로 검증한다.
if "app.config" not in sys.modules:
    config_stub = types.ModuleType("app.config")
    config_stub.get_settings = lambda: SimpleNamespace(link_tracking_params="")
    sys.modules["app.config"] = config_stub

from app.services.response_formatter import format_chat_response


class ResponseFormatterTest(unittest.TestCase):
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
