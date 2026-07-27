import re
from typing import Literal


ConsultationMode = Literal["fact", "situation", "recommendation"]

_PROGRAM_OVERVIEW_SIGNALS = (
    "어떤과정이있",
    "무슨과정이있",
    "과정뭐가있",
    "과정소개",
    "과정알려",
)
_RECOMMENDATION_SIGNALS = (
    "추천",
    "어떤과정",
    "어느과정",
    "무슨과정",
    "나한테맞",
    "저한테맞",
    "내게맞",
    "뭘들어",
    "뭐들어",
    "과정골라",
    "과정선택",
    "선택해야",
    "뭐가좋",
    "과정이맞",
    "과정이좋",
)
_SITUATION_SIGNALS = (
    "비전공",
    "초보",
    "처음",
    "직장인",
    "재직",
    "알바",
    "병행",
    "통학",
    "따라갈",
    "가능할",
    "괜찮을",
    "할수있",
    "할수있을",
)


def consultation_mode_for(question: str) -> ConsultationMode:
    compact = re.sub(r"\s+", "", (question or "").lower())
    if any(signal in compact for signal in _PROGRAM_OVERVIEW_SIGNALS):
        return "fact"
    if any(signal in compact for signal in _RECOMMENDATION_SIGNALS):
        return "recommendation"
    if any(signal in compact for signal in _SITUATION_SIGNALS):
        return "situation"
    return "fact"


def build_consultation_mode_directive(
    question: str,
    no_reask: bool = False,
    recommendation_context: bool = False,
) -> str:
    """질문 성격에 맞춰 능동성의 깊이를 조절하는 턴별 지침을 만든다."""
    mode = consultation_mode_for(question)
    if mode == "recommendation" or recommendation_context:
        if no_reask:
            return (
                "[응답 모드: 과정 추천 — 결론 단계]\n"
                "직전 턴에서 필요한 진단 질문을 이미 했고 사용자가 답했습니다. 추가 질문 없이 지금까지의 "
                "정보로 가장 적합한 과정 1개와 차선책 1개를 제시하세요. 추천 근거, 다른 과정과의 핵심 "
                "차이, 준비할 점을 구체적으로 설명하고 실행 가능한 다음 단계로 마무리하세요."
            )
        return (
            "[응답 모드: 과정 추천]\n"
            "질문만 돌려주지 말고 현재 정보로 가능한 예비 추천부터 제시하세요. 추천 후보별 근거와 "
            "핵심 차이를 설명하고, 가능하면 가장 가까운 과정 1개를 우선 제안하세요. 답에 따라 추천이 "
            "실제로 달라지는 정보가 부족할 때만 구체적인 진단 질문을 최대 1개 하세요. "
            "'어떤 게 궁금하세요?' 같은 포괄적 질문은 금지합니다."
        )
    if mode == "situation":
        return (
            "[응답 모드: 상황 판단]\n"
            "사용자의 조건을 그대로 반복하지 말고 먼저 가능 여부나 판단을 분명히 제시하세요. 확인된 "
            "운영 사실을 사용자의 실제 상황에 연결해 이유와 현실적인 주의점까지 설명하세요. "
            "결론을 내릴 수 있으면 추가 질문으로 끝내지 마세요."
        )
    return (
        "[응답 모드: 사실 안내]\n"
        "질문에 대한 결론과 필요한 근거를 짧고 명확하게 답하세요. 사용자의 결정에 직접 도움이 되는 "
        "주의점이나 다음 행동은 한 줄까지 덧붙일 수 있지만, 관련 없는 정보를 확장하거나 불필요한 "
        "확인 질문을 하지 마세요."
    )
