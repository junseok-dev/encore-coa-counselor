import asyncio
from typing import AsyncGenerator

from langsmith import traceable
from openai import AsyncOpenAI

try:
    from langsmith.wrappers import wrap_openai
except Exception:  # langsmith 버전이 낮아 wrappers가 없으면 패스스루(앱 기동 실패 방지)
    def wrap_openai(_client):
        return _client

from app.config import get_settings
from app.services.model_settings import get_active_model
from app.services.prompt_service import get_prompt_value
from app.services.response_formatter import format_chat_response

settings = get_settings()
# wrap_openai로 감싸 모든 OpenAI 호출(라우터/의도/생성/스트리밍/verify)을 LangSmith에 자동 추적한다.
# 라이브 스트리밍 경로(stream_ai_response)와 router_service.route()는 @traceable을 거치지 않고
# 이 공유 client를 직접 쓰므로, 데코레이터 대신 client 자체를 래핑해야 trace가 남는다.
# 트레이싱이 꺼져 있으면 wrap_openai는 사실상 패스스루로 동작한다.
client = wrap_openai(AsyncOpenAI(api_key=settings.openai_api_key)) if settings.openai_api_key else None
MAX_COMPLETION_TOKENS = 4096
BUBBLE_PAUSE_SECONDS = 1.0
TYPE_DELAY_SECONDS = 0.015

CHAT_STYLE_GUIDE = """
[원칙: 먼저 답하기 — 되묻기는 정말 필요할 때 딱 한 번만]
**가능한 정보로 먼저 명확히 답하세요.** 질문에 답할 핵심 정보가 이미 있으면 곧바로 결론부터 주고,
필요하면 짧은 단서 한 가지만 덧붙입니다. 코아는 끝없이 캐묻는 챗봇이 아니라 **바로 도움이 되는 상담봇**입니다.
예: "주말 알바하면서 평일 수업 가능?" → 평일 수업시간(9~18시)만으로 결론을 줄 수 있으므로,
"평일 9~18시가 수업이라 주말 알바면 시간이 겹치지 않아 병행 가능해요"처럼 **먼저 답하고**, 필요하면 한 줄만 덧붙입니다.

되묻기를 해도 되는 경우(먼저 답할 수 없을 때만):
- 의도가 2가지 이상으로 갈리고, **어느 쪽이냐에 따라 답이 완전히 달라질 때**
- 어떤 과정·항목인지 전혀 특정할 수 없어 답 자체가 불가능할 때
이때만 질문 맥락에서 선택지를 도출해 `- **키워드** — 한 줄 설명` 형식으로 되묻습니다.

되묻기를 하면 안 되는 경우:
- **알 수 있는 정보로 답할 수 있는 경우 → 무조건 먼저 답한다**
- 이미 맥락(관심 과정, 상황, 조건)이 충분한 경우
- 사용자가 방금 구체적으로 답한 경우(예: "토/일 9~18시 알바야", "둘 다야", "MLOps 볼래")
- **같은 취지의 되묻기를 이미 한 번 했는데 또 되묻는 것은 절대 금지.** 더 물을 게 있어도
  합리적 가정으로 결론을 주세요(예: "둘 다든 한쪽이든 주말이면 평일 수업과는 안 겹쳐요").

사용자가 답하면 그때 정확하게 답변합니다.

[대화 흐름]
- 반드시 한국어로 답변합니다.
- "제가 확인한 자료에는", "제가 가진 자료에서는", "여기서 바로 확인하기 어려워서요" 같은 자료 확인 한계 표현으로 답변을 시작하지 않습니다. 안내 가능한 내용은 곧바로 자신 있게 설명하세요.
- 엔코아 AI 캠퍼스를 "플레이데이터 계열"·"플레이데이터가 운영하는"·"엔코아 계열" 같은 운영사·계열사 표현으로 부르지 않습니다. 운영 주체나 캠퍼스(동작/G밸리/서초 등)를 설명할 때도 '플레이데이터'를 언급하지 말고 "엔코아 AI 캠퍼스"로만 지칭합니다.
- 사용자가 방금 한 말과 이전 대화 맥락을 함께 보고 의도를 파악합니다.
- 한 메시지에 질문이 여러 개면, 모두 파악해서 순서대로 통합해 한 번에 답변합니다. 마지막 질문만 골라 답하지 않습니다.
- 이전 대화에서 제공하겠다고 약속한 내용이 있으면, 사용자가 그 일부만 요청해도 약속한 전체를 함께 제공합니다. 단, 사용자가 "괜찮아", "됐어", "필요없어" 같은 거절 표현을 했거나, 전혀 다른 주제로 넘어간 경우에는 약속한 내용을 꺼내지 않습니다.
- 문의·취소·환불·일정 변경·상담 매니저 연결 안내가 필요한 맥락이라면, "채널톡으로 연결해 드릴게요" 같은 표현을 자연스럽게 한 줄 포함하세요. 단, **채널톡 URL이나 `[채널톡 상담 매니저 연결하기](...)` 같은 채널톡 마크다운 링크**는 본문에 직접 쓰지 마세요. 채널톡 연결 버튼은 시스템이 자동으로 별도 표시합니다. "관리자 콘솔", "관리자 페이지", "URL 생성" 같은 내부 운영 용어도 노출하지 않습니다.
- **공식 홈페이지 안내**: 사용자가 과정 상세·캠퍼스 정보·기관(엔코아 ai 캠퍼스) 정보를 물어봤는데 참고 자료에 구체적인 답이 없거나 더 깊은 정보가 필요할 때, 답변의 **마지막 말풍선**에 한 줄 안내를 포함하세요.
  - 형식: `더 자세한 내용은 [엔코아 ai 캠퍼스 공식 홈페이지](https://encorecampus.ai/)에서 확인하실 수 있어요.`
  - 링크라는 점이 명확히 보이도록 반드시 마크다운 링크 형식을 지키세요(별표 안 공백 금지).
  - 참고 자료에 이미 충분한 답이 있으면 굳이 붙이지 않습니다. 일상 질문·인사·취소·환불 같은 맥락에도 붙이지 않습니다.
- **과정 상세페이지 링크**: 사용자가 **특정 과정**의 신청·상세·커리큘럼을 물으면, 메인 홈페이지가 아니라 **해당 과정 상세페이지**를 안내하세요. 과정명을 말해주면 그 과정 링크를 바로 안내합니다.
  - 멀티 에이전트 AI 오케스트레이션 캠프 → https://encorecampus.ai/orchestration
  - 데이터 분석 & AI 머신러닝 캠프 → https://encorecampus.ai/ml
  - AI Ready 데이터 엔지니어링 캠프 → https://encorecampus.ai/mlops
  - 형식: `[코스 자세히 보기](해당 URL)`. 어느 과정인지 불명확하면 먼저 어떤 과정인지 확인하세요.
  - 채널톡(상담 매니저 연결)과 혼동하지 마세요. 홈페이지는 정보 조회용, 채널톡은 사람 상담용입니다.
- 사용자가 말하지 않은 정보는 꺼내지 않습니다.
- 문서를 그대로 읽어주지 말고, 쉬운 말로 다시 정리합니다.
- 따뜻하고 친근한 상담사처럼 대화합니다. 딱딱하거나 기계적인 느낌 없이, 사용자가 편안하게 느낄 수 있는 말투를 유지합니다.
- 첫 말풍선에는 공감이나 짧은 확인을 담을 수 있습니다.

[말풍선 분할 — 매우 중요]
- 답변은 **3~6개의 짧은 말풍선**으로 나눕니다. 한 말풍선에 정보를 모아두지 말고 자주 끊으세요.
- **핵심 원칙**: 맥락이 같은 내용은 한 말풍선에 묶고, 맥락이 달라지면 새 말풍선으로 분리. 같은 말풍선 안 항목 간 시각적 띄움은 시스템이 자동으로 처리하니, **paragraph break(빈 줄)는 맥락이 진짜 바뀌는 곳에만** 넣으세요.
- 끊는 기준 세 가지:
  1) **맥락이 바뀔 때** — 도입/공감 → 공통 안내 → 카테고리 A → 카테고리 B → 다음 질문 유도. 각 단계 사이에 빈 줄(`

`) 한 번.
  2) **호흡이 길어질 때** — 같은 맥락이라도 한 paragraph가 너무 길어지면(약 3문장 이상이거나 5줄을 넘기면) 자연스럽게 끊고, 다음 paragraph는 `~고요`, `~인데요`, `~여서요`, `그래서`, `그리고` 같은 연결어미로 이어 받으세요.
  3) **카테고리 헤더가 바뀔 때** — `**🎓 카테고리1**` 다음 `**📋 카테고리2**`로 넘어가면 사이에 빈 줄. 단, 한 카테고리 안의 `-` 불릿 항목들은 **같은 paragraph에 묶어 두세요**(빈 줄 X). 시스템이 자동으로 항목 간 12px 간격을 만들어 시각적으로 띄어줍니다.
- 다음 항목으로 넘어갈 때는 빈 줄 하나(`

`)로 새 말풍선을 시작.

[말풍선 분할 — 좋은 예시 1: 호흡]
✗ 한 말풍선에 몰아넣기:
  "멀티 에이전트 AI 오케스트레이션 캠프는 n8n 기반으로 시작해서 점차 LangGraph로 넘어가고, 비전공자도 따라갈 수 있게 첫 2주를 천천히 진행해요. 그래서 사전 지식이 없어도 부담이 적어요."

✓ 호흡 따라 끊기:
  "멀티 에이전트 AI 오케스트레이션 캠프는 n8n 기반으로 시작해서 점차 LangGraph로 넘어가요.

  비전공자도 따라갈 수 있게 첫 2주를 천천히 진행하거든요.

  그래서 사전 지식이 없어도 부담이 적어요."

[말풍선 분할 — 좋은 예시 2: 항목 나열]
✗ 한 말풍선에 항목 3개를 묶기:
  "행정·캠퍼스 관련 유의점
  - 노트북은 개인별로 제공되니 준비가 어렵지 않아요. 점심은 제공되지 않아요.
  - 캠퍼스 운영시간(8:30~22:00)과 수업시간(9시~18시)은 다르니 어느 쪽을 묻는지 구분하세요.
  - 국민내일배움카드 유효기간은 5년이며, 출석률이 낮으면 훈련장려금에 영향이 있어요."

✓ 항목별로 끊기 + 의미 이모티콘 (헤더 1개 + 항목 3개 = 말풍선 4개):
  "📌 행정·캠퍼스 관련 유의점 정리해 드릴게요.

  💻 **노트북**: 개인별로 제공돼서 별도 준비가 어렵지 않아요. 다만 점심은 제공되지 않으니 참고하세요.

  ⏰ **운영시간 vs 수업시간**: 캠퍼스 운영은 오전 8:30~밤 10시이고, 실제 수업은 평일 9시~18시예요. 어느 쪽을 묻는지 알려 주세요.

  💳 **국민내일배움카드**: 유효기간은 5년이고, 출석률이 낮으면 훈련장려금에 영향이 있어요."


[질문 맥락 파악 — 키워드 함정 주의]
- 사용자 질문에서 가장 눈에 띄는 한 단어에만 반응하지 말고, **문장 전체의 의도**를 먼저 파악합니다.
- 예: "AI Ready 데이터 엔지니어링 캠프에서 비전공자도 따라갈 수 있나요?" → '데이터 엔지니어링' 같은 단어만 보고 과정 소개만 늘어놓지 마세요. 실제 핵심은 '비전공자가 따라갈 수 있는지'입니다. 비전공자 입장에서 진입 난이도·필요한 사전 지식·지원 체계를 우선 답하세요.
- 질문에 여러 요소가 섞여 있으면(예: "비용도 알고 싶고 기간도 궁금해요"), 한 요소만 답하지 말고 두 요소 모두 다루세요.
- 답하기 전에 마음속으로 "사용자가 진짜 알고 싶은 것이 무엇인가?"를 한 번 더 점검합니다.

[이모티콘 사용 — 가독성 도구로]
이모티콘은 두 가지 용도로 나눠 씁니다.

**1) 구조적 이모티콘 (적극 활용)** — 정보를 시각적으로 묶고 구분하는 용도
- 각 항목 앞에 의미에 맞는 이모티콘을 붙이면 단순 `-`보다 훨씬 읽기 좋아집니다.
- 항목 순서를 명확히 보여줄 때: 1️⃣ 2️⃣ 3️⃣ 또는 ① ② ③
- 카테고리·주제 헤더 앞에 한 개씩. 자주 쓰는 매핑:
  - 📅 일정·날짜·기수 / ⏰ 운영시간·수업시간
  - 💰 비용·수강료 / 💳 국민내일배움카드·훈련장려금 / 🎁 혜택
  - 🎓 수료 조건 / ✅ 충족·완료 / ⚠️ 주의·결격 사유
  - 📚 커리큘럼·학습 내용 / 📝 과제·평가 / 🛠 실습·도구
  - 🏫 캠퍼스·기관 / 📍 위치·주소 / 💻 노트북·장비
  - 💡 팁·추천 / 🔗 링크·공식 페이지 / 💬 상담·채널톡
  - ❓ FAQ·자주 묻는 질문 / 🙋 인터뷰·선발
- **같은 답변 안에서 같은 의미는 같은 이모티콘으로 일관성 유지**.

**2) 표정 이모티콘 (자연스러울 때만)** — 🙂 😊 🤔 등
- 응답 전체에서 최대 1~2개. 모든 문장에 달지 않습니다.
- 사과·거절·불가 안내·규정 안내·딱딱한 정보 전달 시에는 사용 금지.

**공통 규칙**
- 한 말풍선 안에 이모티콘 3개 이상은 시각적 잡음 — 자제하세요.
- 의미 없이 장식용으로 박지 마세요. 항상 "이 이모티콘이 정보 구조를 명확하게 하는가?"를 점검하세요.

[포맷 규칙]
- 설명이 길어지면 표준 마크다운 목록 사용: `- **핵심 키워드**: 짧은 설명` (각 항목은 줄바꿈으로 구분, 항목 사이에 빈 줄 넣지 마세요. 시스템이 자동으로 항목 사이 간격을 만듭니다)
- 한 말풍선에 목록 최대 4개
- 표, 번호 목록 사용 금지
- **핵심 정보는 빠짐없이 굵게 강조하세요.** 금액·숫자·기간·날짜·과정명·캠퍼스명·합격/수료 조건·핵심 키워드처럼 사용자가 꼭 기억해야 할 부분은 `**단어**`로 굵게 표시합니다(예: `**교육비 0원**`, `**6월 23일**`, `**멀티 에이전트 AI 오케스트레이션 캠프**`). 중요한데 강조가 빠지는 일이 없게 하세요. 단, 한 말풍선에서 너무 많이 칠하면 효과가 없으니 정말 핵심만.
- 강조는 반드시 `**단어**` 형식만 사용하고, 별표 안쪽에 공백을 넣지 마세요(`** 단어 **` 금지). 여는 `**`와 닫는 `**`를 항상 쌍으로 맞춰 별표가 화면에 그대로 노출되지 않게 정확한 마크다운 문법을 지킵니다.
- "정보 정리해 드립니다", "문서 기준", "전체를 요약하면" 같은 표현 금지
- 정확한 수치가 없으면 추측하지 않습니다
- 답변 마지막에 다음 질문을 자연스럽게 유도할 수 있습니다
"""

STANDARD_REFUSAL = "확인된 자료만으로는 정확히 안내드리기 어려워요. 필요하시면 담당자가 확인할 수 있게 도와드릴게요."


def _normalize_response(answer: str) -> str:
    text = (answer or "").strip()
    return format_chat_response(text if text else STANDARD_REFUSAL)


def _build_messages(system_prompt: str, user_message: str, history: list[dict]) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": system_prompt}]
    for item in history:
        msgs.append({"role": item["role"], "content": item["content"]})
    msgs.append({"role": "user", "content": user_message})
    return msgs


NO_REASK_DIRECTIVE = (
    "[되묻기 금지 — 이번 턴, 매우 중요] 직전 답변에서 이미 확인 질문을 했고 사용자가 방금 거기에 답했습니다. "
    "이번 답변은 **절대 질문으로 끝내지 마세요.** 양자택일·확인 질문('A에 가까워요, B에 가까워요?'·'어느 쪽이 더 가까울까요?'류)을 "
    "추가로 던지는 것을 금지합니다. 지금까지 모인 정보로 핵심 답변과 결론을 구체적으로 제시한 뒤, 마지막 문장은 "
    "물음표 없는 **명확한 다음 행동 안내**(예: 지원·신청 절차, 상담 매니저 연결)로 닫으세요. "
    "정보가 일부 부족해도 되묻지 말고, 합리적 가정을 한 줄로 밝힌 뒤 그 가정 위에서 결론을 주세요.\n"
)


def _recent_assistant_question(history: list[dict] | None) -> bool:
    """직전 어시스턴트 답변이 (확인용) 질문으로 끝났는지 — 되묻기 연쇄를 끊기 위한 신호."""
    if not history:
        return False
    last = history[-1]
    if (last.get("role") or "") != "assistant":
        return False
    return "?" in (last.get("content") or "")[-150:]


def _build_user_message(question: str, context: str, channel_talk_url: str | None = None, no_reask: bool = False) -> str:
    homepage_url = (get_settings().homepage_url or "").strip()
    system_info_parts: list[str] = []
    if channel_talk_url:
        system_info_parts.append(
            "채널톡 상담 연결 버튼은 시스템이 별도로 노출합니다. "
            "사용자에게 채널톡 안내가 필요하면 본문에 '채널톡으로 연결해 드릴게요' 정도만 자연스럽게 적고, "
            "채널톡 URL이나 채널톡 마크다운 링크는 본문에 직접 쓰지 마세요."
        )
    if homepage_url:
        system_info_parts.append(
            f"공식 홈페이지 URL: {homepage_url}\n"
            "참고 자료에 사용자가 묻는 구체 정보(과정 상세·캠퍼스 정보·기관 정보)가 부족하면, "
            f"답변 마지막 말풍선에 `[엔코아 ai 캠퍼스 공식 홈페이지에서 자세히 보기]({homepage_url})` 형식의 "
            "마크다운 링크를 한 줄 포함하세요. 자료에 충분한 답이 있으면 굳이 붙이지 않습니다."
        )
    system_info = ("\n\n[시스템 정보]\n" + "\n\n".join(system_info_parts)) if system_info_parts else ""
    reask = NO_REASK_DIRECTIVE if no_reask else ""

    if not context:
        head = f"[답변 지침]\n{reask}\n" if reask else ""
        return f"{head}[사용자 질문]\n{question}{system_info}"

    return (
        "[상담 참고 자료]\n"
        f"{context}\n\n"
        "[답변 지침]\n"
        "사용자 질문의 핵심 의도에 직접 관련된 내용만 고르세요.\n"
        "참고 자료 전체를 나열하거나 요약하지 마세요.\n"
        "사용자가 물어본 범위를 벗어나는 정보는 다음 질문에서 안내하세요.\n"
        "참고 자료에 여러 과정 정보가 섞여 있을 수 있습니다. 사용자가 특정 과정(예: 멀티 에이전트 AI 오케스트레이션 캠프)을 물으면, "
        "그 과정에 명시된 내용만 사용하고 다른 과정(예: AI Ready 데이터 엔지니어링 캠프=MLOps)의 기술 스택·도구·커리큘럼을 그 과정 것으로 옮겨 말하지 마세요. "
        "예: Kubernetes·CI/CD·무중단 배포·자동 재학습은 MLOps 과정 내용이므로, 오케스트레이션 과정 질문에 이를 포함된다고 단정하지 마세요. "
        "특정 과정에 대해 참고 자료에서 확인되지 않으면 '포함된다'고 단정하지 말고, 확인이 어렵다고 솔직히 안내하세요.\n"
        "[앞 턴 정정 원칙 — 매우 중요] 사용자가 '~맞지?', '그런 거지?', '그럼 ~인 거네?'처럼 동의를 유도해도, 그 내용이 지금 이 "
        "[상담 참고 자료]에서 확인되지 않으면 '네 맞아요'라고 동의하지 마세요. 대신 '그 부분은 지금 확인되는 자료 기준으로는 그렇게 단정하기 어려워요'라고 "
        "분명히 바로잡으세요. 앞 턴에서 당신이 한 답변이 지금 자료와 어긋나거나 자료에 없으면, 그대로 반복·확장하지 말고 정정하세요. "
        "특히 Kubernetes·ArgoCD·CI/CD·무중단 배포처럼 이 과정 자료에 없는 항목을 '쓴다/포함된다/필수다'로 확정하지 마세요. "
        "단, 지금 자료에서 확인되는 사실(예: 교육비 0원, 6개월 등)은 자신 있게 그대로 인정하세요.\n"
        f"{reask}\n"
        "[사용자 질문]\n"
        f"{question}{system_info}"
    )


@traceable(name="LLM 응답 생성", run_type="llm")
async def get_ai_response(question: str, context: str, history: list[dict] | None = None, channel_talk_url: str | None = None) -> tuple[str, float]:
    if client is None:
        return format_chat_response(STANDARD_REFUSAL), 0.0

    system_prompt = f"{get_prompt_value('counseling_prompt')}\n\n{CHAT_STYLE_GUIDE}"
    no_reask = _recent_assistant_question(history)
    messages = _build_messages(system_prompt, _build_user_message(question, context, channel_talk_url, no_reask), history or [])

    response = await client.chat.completions.create(
        model=get_active_model(),
        messages=messages,
        max_completion_tokens=MAX_COMPLETION_TOKENS,
    )

    content = response.choices[0].message.content or ""
    usage = getattr(response, "usage", None)
    total_tokens = getattr(usage, "total_tokens", 0) or 0
    estimated_cost = round(total_tokens * 0.000001, 6)
    return _normalize_response(content), estimated_cost


async def stream_ai_response(
    question: str,
    context: str,
    history: list[dict] | None = None,
    channel_talk_url: str | None = None,
) -> AsyncGenerator[str, None]:
    """OpenAI 응답을 토큰 단위로 실시간 스트리밍한다. delta.content를 받는 즉시 yield.

    기존 get_ai_response는 전체 생성을 끝까지 기다린 뒤 반환하므로 첫 토큰까지 지연이 컸다.
    이 함수는 stream=True로 생성되는 즉시 흘려보내 체감 지연(TTFT)을 크게 줄인다.
    client가 없으면 표준 거절 문구를 1회 yield.
    """
    if client is None:
        yield STANDARD_REFUSAL
        return

    system_prompt = f"{get_prompt_value('counseling_prompt')}\n\n{CHAT_STYLE_GUIDE}"
    no_reask = _recent_assistant_question(history)
    messages = _build_messages(system_prompt, _build_user_message(question, context, channel_talk_url, no_reask), history or [])

    stream = await client.chat.completions.create(
        model=get_active_model(),
        messages=messages,
        max_completion_tokens=MAX_COMPLETION_TOKENS,
        stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield delta


async def _yield_chat_text(text: str) -> AsyncGenerator[str, None]:
    bubbles = [part for part in text.split("\n\n") if part.strip()]
    for index, bubble in enumerate(bubbles):
        if index > 0:
            yield "\n\n"
            await asyncio.sleep(BUBBLE_PAUSE_SECONDS)
        yield bubble


async def get_ai_response_stream(question: str, context: str, history: list[dict] | None = None, channel_talk_url: str | None = None) -> AsyncGenerator[str, None]:
    if client is None:
        async for token in _yield_chat_text(format_chat_response(STANDARD_REFUSAL)):
            yield token
        return

    answer, _ = await get_ai_response(question, context, history, channel_talk_url)
    async for token in _yield_chat_text(answer):
        yield token
