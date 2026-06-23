export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    id: 'faq-coding-test',
    question: '코딩테스트가 있나요?',
    answer:
      "인터뷰 이후 수강생분들의 현재 실력을 파악하고 맞춤형 교육을 지원해 드리기 위한 '사전테스트'를 진행하고 있습니다. 다만, 테스트 결과보다는 인터뷰에서 보여주시는 배우고자 하는 의지와 열정이 선발에 훨씬 더 중요한 영향을 미치니 전혀 부담 갖지 마시고 편안한 마음으로 안심하고 지원해 주세요!",
  },
  {
    id: 'faq-schedule',
    question: '교육일정이 궁금해요',
    answer:
      '엔코아 AI 캠퍼스의 교육 일정에 대해 안내해 드릴게요! 저희 과정은 과정별로 개강 일정과 교육이 진행되는 캠퍼스가 다르게 운영되고 있어요. 현재 예정된 개강 일정은 다음과 같으니 참고해주세요!\n\n[멀티 에이전트 AI 오케스트레이션 캠프]\n- 1기: 2026.07.09 ~ 12.30 / 동작·G밸리캠퍼스\n- 2기: 2026.07.28 ~ 2027.01.19 / 동작·G밸리캠퍼스\n- 📄 [코스 자세히 보기](https://encorecampus.ai/orchestration?utm_source=chatbot&utm_medium=referral&utm_campaign=orchestration)\n\n[데이터 분석 & AI 머신러닝 캠프]\n- 2026.07.16 ~ 2027.01.11 / 동작캠퍼스\n- 📄 [코스 자세히 보기](https://encorecampus.ai/ml?utm_source=chatbot&utm_medium=referral&utm_campaign=ml)\n\n[AI Ready 데이터 엔지니어링 캠프]\n- 2026.07.13 ~ 2027.01.06 / G밸리캠퍼스\n- 📄 [코스 자세히 보기](https://encorecampus.ai/mlops?utm_source=chatbot&utm_medium=referral&utm_campaign=mlops)',
  },
];
