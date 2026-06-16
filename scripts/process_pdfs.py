"""
Build chatbot knowledge assets from `data/original_data`.

What this script does:
1. Converts the managed PDF source files into curated Markdown under `data/docs`.
2. Generates `data/faq/faq.json` with clean FAQ entries for the chatbot.
3. Writes `data/docs/catalog.json` so the RAG index can load only the managed docs.

Usage:
  cd c:\\Workspaces\\document-chatbot_practice
  backend\\venv\\Scripts\\python scripts\\process_pdfs.py
"""

from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import opendataloader_pdf
import pypdfium2 as pdfium
import pytesseract

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "data" / "original_data"
DOCS_DIR = ROOT / "data" / "docs"
FAQ_DIR = ROOT / "data" / "faq"
DOC_CATALOG_PATH = DOCS_DIR / "catalog.json"
FAQ_JSON_PATH = FAQ_DIR / "faq.json"
TESSERACT_CANDIDATES = [
    Path(r"C:\Users\Playdata\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
]

CATEGORIES = [
    {
        "id": "law",
        "label": "법률",
        "description": "개인정보 보호와 표시·광고 관련 기준을 안내합니다.",
        "query": "법률 관련해서 어떤 내용을 물어보면 좋을까요?",
    },
    {
        "id": "regulation",
        "label": "운영규정",
        "description": "국민내일배움카드와 직업훈련 운영 기준을 안내합니다.",
        "query": "운영규정 관련해서 어떤 내용을 물어보면 좋을까요?",
    },
    {
        "id": "course",
        "label": "과정 상세",
        "description": "과정별 목표, 커리큘럼, 프로젝트, 진로 차이를 안내합니다.",
        "query": "과정 상세에서는 어떤 질문을 하면 좋을까요?",
    },
    {
        "id": "playdata",
        "label": "플레이데이터 정보",
        "description": "기관 소개, 캠퍼스, 홈페이지 핵심 정보를 안내합니다.",
        "query": "플레이데이터 정보에서는 어떤 질문을 하면 좋을까요?",
    },
]

PDF_SPECS = [
    {
        "source": "개인정보 보호법(법률)(제20897호)(20251002).pdf",
        "output": "privacy_law.md",
        "title": "개인정보 보호법",
        "category_id": "law",
    },
    {
        "source": "표시ㆍ광고의 공정화에 관한 법률(법률)(제20712호)(20250121).pdf",
        "output": "fair_labeling_law.md",
        "title": "표시·광고의 공정화에 관한 법률",
        "category_id": "law",
    },
    {
        "source": "국민내일배움카드 운영규정(고용노동부고시)(제2026-101호)(20260101).pdf",
        "output": "national_training_card_regulation.md",
        "title": "국민내일배움카드 운영규정",
        "category_id": "regulation",
    },
    {
        "source": "국민내일배움카드_발급자격.pdf",
        "output": "national_training_card_eligibility.md",
        "title": "국민내일배움카드 발급자격",
        "category_id": "regulation",
    },
    {
        "source": "현장 실무인재 양성을 위한 직업능력개발훈련 운영규정(고용노동부고시)(제2026-32호)(20260505).pdf",
        "output": "vocational_training_regulation.md",
        "title": "현장 실무인재 양성을 위한 직업능력개발훈련 운영규정",
        "category_id": "regulation",
    },
    {
        "source": "과정상세내용_AI 오케스트레이션.pdf",
        "output": "course_ai_orchestration.md",
        "title": "멀티 에이전트 AI 오케스트레이션 캠프 상세",
        "category_id": "course",
    },
    {
        "source": "과정상세내용_MLOps 엔지니어.pdf",
        "output": "course_mlops.md",
        "title": "AI Ready 데이터 엔지니어링 캠프 상세",
        "category_id": "course",
    },
    {
        "source": "과정상세내용_머신러닝 엔지니어.pdf",
        "output": "course_ml_engineer.md",
        "title": "데이터 분석 & AI 머신러닝 캠프 상세",
        "category_id": "course",
    },
    {
        "source": "플레이데이터_ 기관정보_소개서.pdf",
        "output": "playdata_intro.md",
        "title": "플레이데이터 기관 정보 소개",
        "category_id": "playdata",
    },
    {
        "source": "플레이데이터 캠퍼스 정보.pdf",
        "output": "campus_info.md",
        "title": "플레이데이터 캠퍼스 정보",
        "category_id": "playdata",
    },
    {
        "source": "플레이데이터_홈페이지_소개.pdf",
        "output": "homepage_intro.md",
        "title": "플레이데이터 홈페이지 소개",
        "category_id": "playdata",
    },
]

COURSE_DETAILS = {
    "course_mlops.md": {
        "name": "AI Ready 데이터 엔지니어링 캠프",
        "official_name": "AI Ready Data 기반 Cloud-Native 자동화를 위한 MLOps 엔지니어 양성 과정",
        "identity": "AI가 멈추지 않고 안정적으로 운영되도록 만드는 기술",
        "core_value": [
            "데이터 엔지니어링과 모델 운영을 함께 다루는 실무형 과정입니다.",
            "AI Ready Data, CI/CD/CT, 모니터링, 배포 자동화 경험을 쌓는 데 초점이 있습니다.",
            "개발 이후 운영·배포·검증까지 이어지는 파이프라인 관점이 강합니다.",
        ],
        "recommended_for": [
            "모델 개발보다 운영 자동화, 배포, 실서비스 안정성에 더 관심이 있는 사람",
            "데이터 파이프라인과 MLOps 플랫폼 구축 경험을 쌓고 싶은 사람",
            "AI 엔지니어, MLOps 엔지니어, 데이터 플랫폼 엔지니어를 목표로 하는 사람",
        ],
        "roles": [
            "AI 엔지니어",
            "MLOps 엔지니어",
            "데이터 플랫폼 엔지니어",
        ],
        "projects": [
            "LLM 성능 평가와 RAGOps 기반 데이터 파이프라인 구축",
            "OCR 모델 성능 저하를 감지하고 재학습/배포를 자동화하는 파이프라인 구축",
            "VOC 분석 모델의 카나리 배포와 실시간 모니터링 시스템 구현",
            "데이터 검증 기반 이상 탐지 및 모델 자동 업데이트 체계 설계",
            "데이터 파이프라인과 모델 이력을 관리하는 운영 플랫폼 구현",
        ],
    },
    "course_ml_engineer.md": {
        "name": "데이터 분석 & AI 머신러닝 캠프",
        "official_name": "LLM 지식 그래프 기반 지능형 GraphRAG 구축을 위한 머신러닝 엔지니어 양성 과정",
        "identity": "AI가 정확하게 답하고 추론하도록 만드는 기술",
        "core_value": [
            "RAG, GraphRAG, 지식 그래프, 검색 품질 개선 중심의 과정입니다.",
            "모델 자체보다 모델이 더 정확한 답을 내도록 만드는 구조 설계에 강점이 있습니다.",
            "문서·규정·사내 지식처럼 복잡한 텍스트 자산을 다루는 역량을 키우는 데 적합합니다.",
        ],
        "recommended_for": [
            "RAG, 검색, 지식 그래프, 문서 기반 AI 서비스에 관심이 있는 사람",
            "정확도와 추론 품질 개선이 중요한 AI 시스템을 만들고 싶은 사람",
            "머신러닝 엔지니어, AI 엔지니어, 지식 시스템 구축 역할을 목표로 하는 사람",
        ],
        "roles": [
            "AI 엔지니어",
            "머신러닝 엔지니어",
            "지식 시스템 엔지니어",
        ],
        "projects": [
            "엔터프라이즈 지식자산 최적화를 위한 RAG 기반 질의응답 에이전트 구축",
            "컴플라이언스 규정 준수 여부를 검증하는 규칙 기반 지식 시스템 설계",
            "직무 역량과 이력 정보를 바탕으로 한 커리어 가이드 서비스 구현",
            "지식 그래프 기반 금융 상담 에이전트 설계",
            "그래프 기반 검색과 업무 자동화를 결합한 통합 서비스 구축",
        ],
    },
    "course_ai_orchestration.md": {
        "name": "멀티 에이전트 AI 오케스트레이션 캠프",
        "official_name": "Auto-Healing 멀티에이전트 워크플로우 기반 AI 오케스트레이션 애플리케이션 개발자 양성 과정",
        "identity": "상황에 맞게 여러 AI 에이전트를 설계하고 조율하는 기술",
        "core_value": [
            "멀티에이전트, LangGraph, Function Calling, 워크플로우 설계가 핵심입니다.",
            "Auto-Healing 개념을 통해 에이전트 장애 감지와 복구 흐름까지 다룹니다.",
            "Vibe Coding, Cursor, Claude Code, n8n 같은 도구와 함께 빠르게 서비스 형태로 구현하는 흐름이 특징입니다.",
        ],
        "recommended_for": [
            "AI 서비스를 기획하고 여러 에이전트를 조합해 문제를 풀고 싶은 사람",
            "비전공자라도 코딩 도구와 자동화 도구를 활용해 빠르게 결과물을 만들고 싶은 사람",
            "AI 서비스 기획, AI PM, AI 애플리케이션 개발에 관심이 있는 사람",
        ],
        "roles": [
            "AI 애플리케이션 개발자",
            "AI 서비스 기획자",
            "AI PM",
            "워크플로우 자동화 설계자",
        ],
        "projects": [
            "Auto-Healing 기반 기업형 인프라 관리 및 장애 복구 에이전트 구현",
            "기업 내부 일정·비서·자산 관리를 돕는 멀티에이전트 서비스 구현",
            "금융 상담과 자산 분석을 지원하는 다중 에이전트 고객 응대 시스템 설계",
            "시장 조사와 보고서 생성을 자동화하는 리서치 에이전트 구현",
            "AI 기반 코드 생성과 테스트 자동화를 결합한 개발 지원 워크플로우 구현",
        ],
    },
}

DOCUMENT_SUMMARIES = {
    "privacy_law.md": {
        "overview": [
            "개인정보의 수집, 이용, 제공, 보관, 파기 전 과정에서 지켜야 할 기본 원칙을 규정합니다.",
            "정보주체의 권리, 개인정보처리자의 의무, 안전조치, 침해 구제와 제재 체계를 함께 다룹니다.",
        ],
        "highlights": [
            "개인정보는 목적에 필요한 최소 범위에서 적법하고 명확하게 처리해야 합니다.",
            "정보주체는 열람, 정정, 삭제, 처리정지 등 자신의 개인정보에 관한 권리를 가집니다.",
            "개인정보처리자는 유출·오남용 방지를 위한 관리적·기술적·물리적 안전조치를 해야 합니다.",
            "위반 시 시정명령, 과징금, 과태료, 손해배상 등 후속 조치가 발생할 수 있습니다.",
        ],
        "counseling_points": [
            "상담 챗봇이 어떤 개인정보를 받아도 되는지",
            "수집 목적과 보관 기간을 어떻게 안내해야 하는지",
            "민감정보나 주민등록번호처럼 더 엄격한 정보가 있는지",
        ],
    },
    "fair_labeling_law.md": {
        "overview": [
            "상품이나 서비스의 표시·광고가 소비자를 속이거나 오인시키지 않도록 하는 기준입니다.",
            "허위·과장, 기만, 부당 비교, 비방 광고와 같은 유형을 중심으로 판단합니다.",
        ],
        "highlights": [
            "객관적 근거 없이 성과나 혜택을 과장하면 부당 표시·광고로 볼 수 있습니다.",
            "다른 기관이나 경쟁사와 비교할 때는 기준이 명확하고 사실에 근거해야 합니다.",
            "수강 혜택, 취업 지원, 국비지원 범위는 실제 제공 조건과 동일하게 안내해야 합니다.",
            "상담 문구, 홈페이지 배너, 안내 자료 모두 같은 기준으로 관리하는 것이 안전합니다.",
        ],
        "counseling_points": [
            "취업률, 채용 연계, 장려금 같은 표현을 어떻게 말해야 하는지",
            "타 과정과 비교할 때 어떤 표현이 위험한지",
            "상담사가 자주 쓰는 강조 문구가 과장에 해당하는지",
        ],
    },
    "national_training_card_regulation.md": {
        "overview": [
            "국민내일배움카드로 훈련과정을 신청하고 운영하는 절차와 기준을 다루는 규정입니다.",
            "훈련과정 인정, 출결, 수강 제한, 비용 지원, 운영 관리 기준이 함께 포함됩니다.",
        ],
        "highlights": [
            "훈련기관은 과정 정보와 운영 내용을 HRD 시스템 기준에 맞춰 관리해야 합니다.",
            "출결과 수강 태도는 지원금 지급과 수료 여부에 직접 영향을 줍니다.",
            "부정수급이나 허위 출결은 카드 사용 제한과 환수로 이어질 수 있습니다.",
            "과정 변경, 운영, 종료 보고까지 행정 절차를 정확히 지키는 것이 중요합니다.",
        ],
        "counseling_points": [
            "수강 신청 이후 어떤 절차가 이어지는지",
            "결석이나 중도 포기가 지원금에 어떤 영향을 주는지",
            "훈련기관과 수강생이 각각 지켜야 할 기준이 무엇인지",
        ],
    },
    "national_training_card_eligibility.md": {
        "overview": [
            "국민내일배움카드 발급 대상, 제외 대상, 신청 절차와 지원 범위를 안내합니다.",
            "취업 준비, 직무 전환, 재직자 역량 강화 목적의 훈련비 지원 제도라는 점이 핵심입니다.",
        ],
        "highlights": [
            "기본적으로 5년간 300만 원 한도에서 시작하며, 조건에 따라 최대 500만 원까지 확대될 수 있습니다.",
            "카드 발급과 수강 신청은 고용24와 고용센터 절차를 중심으로 진행됩니다.",
            "일부 공무원, 고소득 자영업자, 대규모 기업 근로자 등은 지원 제외 또는 제한 대상이 될 수 있습니다.",
            "훈련장려금은 출석률과 수강 형태에 따라 달라질 수 있으므로 반드시 개별 확인이 필요합니다.",
        ],
        "counseling_points": [
            "내가 발급 대상인지 먼저 확인하고 싶을 때",
            "지원 한도와 본인부담금 구조가 헷갈릴 때",
            "카드 신청부터 수강 신청까지의 순서를 알고 싶을 때",
        ],
    },
    "vocational_training_regulation.md": {
        "overview": [
            "현장 실무인재 양성을 위한 직업능력개발훈련의 인정·운영·평가 기준을 정리한 규정입니다.",
            "기업 수요 기반 과정 설계, 프로젝트형 학습, 성과 관리와 취업 연계가 핵심 축입니다.",
        ],
        "highlights": [
            "기업 수요와 직무 역량을 반영해 훈련과정을 설계해야 합니다.",
            "프로젝트형 학습과 실무 중심 운영이 강조됩니다.",
            "훈련기관은 과정 정보, 출결, 성과, 종료 보고를 체계적으로 관리해야 합니다.",
            "성과 평가와 운영 품질이 향후 과정 인정과 운영에 영향을 줄 수 있습니다.",
        ],
        "counseling_points": [
            "K-디지털 트레이닝 과정이 왜 프로젝트 중심인지",
            "기업 수요 반영 과정이라는 말이 실제로 무엇을 뜻하는지",
            "과정 운영과 평가에서 중요하게 보는 기준이 무엇인지",
        ],
    },
    "playdata_intro.md": {
        "overview": [
            "플레이데이터는 IT·데이터·AI 분야 취업 준비와 직무 전환을 돕는 실무형 교육 브랜드입니다.",
            "연령과 전공에 관계없이, 오프라인 중심으로 몰입형 교육을 원하는 사람에게 적합한 구조를 강조합니다.",
        ],
        "highlights": [
            "교육 대상은 연령·전공 무관의 개발자 취업 희망자와 직무 전환 희망자입니다.",
            "빅데이터, AI, 백엔드, 클라우드 등 실무 중심 분야를 다룹니다.",
            "대학생 연계 교육, 재직자 직무 교육, 기업 맞춤형 교육과 채용 연계 지원을 함께 소개합니다.",
            "오프라인 중심 운영과 장기 몰입형 학습 환경이 플레이데이터의 차별점으로 반복해서 제시됩니다.",
        ],
        "counseling_points": [
            "플레이데이터가 어떤 사람에게 맞는 기관인지",
            "전공이 아니어도 지원 가능한지",
            "교육 이후 어떤 진로와 지원을 기대할 수 있는지",
        ],
    },
    "campus_info.md": {
        "overview": [
            "플레이데이터 각 캠퍼스의 위치, 운영시간, 대여 정책을 정리한 안내 문서입니다.",
            "실제 상담에서 가장 자주 묻는 방문 동선과 운영 편의 정보를 빠르게 확인할 수 있습니다.",
        ],
        "highlights": [
            "캠퍼스 운영시간은 오전 8시 30분부터 오후 10시까지입니다.",
            "실제 수업은 평일 오전 9시부터 오후 6시까지 진행됩니다.",
            "동작, G밸리, 서초 캠퍼스 주소와 인근 역 정보를 안내합니다.",
            "교재 대여와 노트북 대여 가능 여부를 함께 확인할 수 있습니다.",
        ],
        "counseling_points": [
            "수업 시간과 캠퍼스 운영시간이 어떻게 다른지",
            "내가 신청한 과정이 어느 캠퍼스에서 열리는지",
            "노트북이나 교재를 별도로 준비해야 하는지",
        ],
    },
    "homepage_intro.md": {
        "overview": [
            "플레이데이터 홈페이지 소개 자료는 기관의 강점과 상담 포인트를 한눈에 보여주는 브로슈어 성격의 문서입니다.",
            "오프라인 몰입형 교육, 실무형 커리큘럼, AI·데이터 특화 교육 메시지가 반복적으로 강조됩니다.",
        ],
        "highlights": [
            "교육비 0원, 훈련장려금, 실무형 커리큘럼 같은 핵심 메시지를 전면에 배치합니다.",
            "AI·데이터 실무 경험, 오프라인 캠퍼스 운영, 프로젝트형 교육 환경을 강점으로 소개합니다.",
            "과정 소개뿐 아니라 상담 유도 문구와 지원 동선 안내가 함께 들어 있습니다.",
            "상담 챗봇에서는 기관 소개보다 '어떤 사람에게 맞는 교육인지'로 풀어서 설명하는 것이 좋습니다.",
        ],
        "counseling_points": [
            "플레이데이터 교육의 강점이 무엇인지",
            "홈페이지에서 가장 먼저 강조하는 혜택과 운영 방식이 무엇인지",
            "지원 전 어떤 기준으로 과정을 비교하면 좋은지",
        ],
    },
}

DETAIL_SECTIONS = {
    "playdata_intro.md": [
        {
            "heading": "## 기관 성격과 강점",
            "items": [
                "플레이데이터는 엔코아 계열의 실무형 교육 브랜드로, 데이터와 AI 분야 인재 양성을 핵심 메시지로 소개합니다.",
                "단순 이론보다 취업과 실무 투입을 목표로 한 장기 몰입형 교육 구조를 강조합니다.",
                "상담에서는 '학원'보다는 '취업 연계형 실무 교육기관'이라는 맥락으로 설명하는 편이 자연스럽습니다.",
            ],
        },
        {
            "heading": "## 교육 대상",
            "items": [
                "비전공자, 취업 준비생, 직무 전환 희망자까지 폭넓게 수용하는 방향으로 소개합니다.",
                "연령이나 전공보다 학습 의지와 몰입 가능성, 목표 직무가 더 중요한 기준으로 읽힙니다.",
                "처음 개발을 시작하는 사람에게도 진입 가능성이 있다는 점을 상담 포인트로 활용할 수 있습니다.",
            ],
        },
        {
            "heading": "## 취업 지원과 운영 방식",
            "items": [
                "채용 전담 매니저, 채용 공고 분석, 수료생 추천, 레퍼런스 체크 대행처럼 취업 연결 요소가 함께 소개됩니다.",
                "교육 과정은 파트너사 수요를 반영해 설계된다는 메시지가 반복되어, 현업 적합성을 강조하는 자료로 볼 수 있습니다.",
                "상담 시에는 '수업만 제공하는 곳'이 아니라 취업 준비 과정까지 함께 보는 구조라는 점을 연결하면 좋습니다.",
            ],
        },
    ],
    "campus_info.md": [
        {
            "heading": "## 방문 전 안내 포인트",
            "items": [
                "캠퍼스 운영 시간과 실제 수업 시간은 다를 수 있으므로, 상담에서는 둘을 나눠 설명하는 편이 안전합니다.",
                "노트북, 교재, 출입, 좌석 환경처럼 수강 전 지참 사항이나 제공 물품을 묻는 질문에 대응하기 위한 기초 정보 문서로 활용할 수 있습니다.",
                "지원자가 어느 캠퍼스로 배정될 수 있는지, 접근성은 어떤지 확인할 때 가장 먼저 참고할 문서입니다.",
            ],
        },
        {
            "heading": "## 상담에서 자주 연결할 내용",
            "items": [
                "오프라인 수업 참석 가능 여부",
                "거주지와 캠퍼스 거리, 통학 가능성",
                "수업 시간 외 자습이나 시설 이용 가능 여부",
            ],
        },
    ],
    "homepage_intro.md": [
        {
            "heading": "## 홈페이지가 강조하는 메시지",
            "items": [
                "AI와 데이터 분야로 취업하고 싶은 사람에게 필요한 경쟁력을 키워준다는 메시지가 전면에 배치됩니다.",
                "오프라인 몰입형 교육, 밀착 매니징, 실시간 피드백, 팀 프로젝트 환경이 대표 강점으로 반복됩니다.",
                "상담에서는 화려한 홍보 문구보다 '왜 오프라인 중심 운영을 고수하는지'를 풀어주는 방식이 더 설득력 있습니다.",
            ],
        },
        {
            "heading": "## 학습 경험 관점에서 풀어낼 내용",
            "items": [
                "수업 외 시간에도 캠퍼스에서 학습 흐름을 유지하기 쉬운 구조라는 점",
                "팀 프로젝트와 동료 학습이 자연스럽게 일어나는 오프라인 환경이라는 점",
                "매니저와 운영팀의 밀착 지원을 통해 학습 지속성을 높인다는 점",
            ],
        },
        {
            "heading": "## 운영 안내로 연결할 내용",
            "items": [
                "개강 전 프리코스와 온라인 기초 학습을 제공한다는 흐름이 보여, 입과 전 준비 단계가 있다는 점을 안내할 수 있습니다.",
                "아침부터 밤까지 이어지는 오프라인 학습 환경, 매니저 밀착 케어, 실시간 피드백이 핵심 운영 포인트로 읽힙니다.",
                "후기와 사례 중심으로 신뢰를 쌓는 문서이므로, 챗봇에서는 홍보 문구보다 실제 학습 경험과 지원 구조로 풀어주는 편이 좋습니다.",
            ],
        },
    ],
    "national_training_card_eligibility.md": [
        {
            "heading": "## 발급 대상 이해하기",
            "items": [
                "국민내일배움카드는 취업 준비, 이직 준비, 직무 역량 강화를 위한 훈련비 지원 제도입니다.",
                "대상 여부는 고용 상태, 소득 수준, 사업자 여부, 공무원 여부 등 개인 조건에 따라 달라집니다.",
                "상담에서는 '누구나 무조건 가능하다'고 말하기보다, 고용24와 고용센터 기준으로 최종 확인이 필요하다고 안내해야 안전합니다.",
            ],
        },
        {
            "heading": "## 지원 범위와 비용 구조",
            "items": [
                "기본 한도는 5년간 300만 원이며, 조건에 따라 추가 지원을 포함해 최대 500만 원까지 확대될 수 있습니다.",
                "훈련비 전액 지원이 아니라 본인부담금이 발생할 수 있고, 과정 유형과 개인 조건에 따라 비율이 달라집니다.",
                "저소득층, 장애인, 한부모가정 등은 부담이 낮아지거나 면제되는 경우가 있어 개별 확인이 중요합니다.",
            ],
        },
        {
            "heading": "## 신청 흐름",
            "items": [
                "일반적으로 카드 발급 가능 여부 확인, 카드 신청, 훈련과정 검색, 수강 신청 순서로 이해하면 됩니다.",
                "고용24에서 온라인 절차를 진행하거나 고용센터 안내를 통해 필요한 상담과 확인 절차를 거칠 수 있습니다.",
                "지원자는 카드 발급과 과정 신청이 별개라는 점을 헷갈리는 경우가 많아, 이 순서를 분리해서 설명하는 것이 좋습니다.",
            ],
        },
    ],
}

REFERENCE_POLICIES = {
    "privacy_law.md": "full",
    "fair_labeling_law.md": "full",
    "national_training_card_regulation.md": "full",
    "national_training_card_eligibility.md": "filtered",
    "vocational_training_regulation.md": "full",
    "course_ai_orchestration.md": "filtered",
    "course_mlops.md": "filtered",
    "course_ml_engineer.md": "filtered",
    "playdata_intro.md": "filtered",
    "campus_info.md": "none",
    "homepage_intro.md": "none",
}

def category_by_id(category_id: str) -> dict:
    for category in CATEGORIES:
        if category["id"] == category_id:
            return category
    raise KeyError(f"Unknown category id: {category_id}")


def configure_tesseract() -> None:
    if shutil.which("tesseract"):
        return
    for candidate in TESSERACT_CANDIDATES:
        if candidate.exists():
            pytesseract.pytesseract.tesseract_cmd = str(candidate)
            return


def clean_ocr_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    lines: list[str] = []
    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line:
            lines.append("")
            continue
        if re.fullmatch(r"[-_=~.]{3,}", line):
            continue
        lines.append(line)
    cleaned = "\n".join(lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def sanitize_markdown(md_content: str) -> str:
    text = md_content.replace("\r\n", "\n")
    text = re.sub(r"<br\s*/?>\s*<br\s*/?>", " / ", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = re.sub(r"```.*?```", "", text, flags=re.S)

    sanitized_lines: list[str] = []
    for raw_line in text.split("\n"):
        line = re.sub(r"!\[[^\]]*]\([^)]*\)", "", raw_line)
        line = re.sub(r"<img\b[^>]*>", "", line, flags=re.I)
        stripped = line.strip()
        if not stripped:
            sanitized_lines.append("")
            continue
        if re.fullmatch(r"\d{1,3}", stripped):
            continue
        if re.search(r"[\u2500-\u257F]", stripped):
            continue
        if re.fullmatch(r"image\s*\d+", stripped, flags=re.I):
            continue
        sanitized_lines.append(line.rstrip())

    text = "\n".join(sanitized_lines)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def is_sparse_text(text: str) -> bool:
    return len(re.findall(r"[A-Za-z0-9가-힣]", text)) < 100


def extract_markdown_with_parser(pdf_path: Path) -> str:
    with TemporaryDirectory() as tmp_dir:
        work_dir = Path(tmp_dir)
        output_dir = work_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        input_pdf = work_dir / "input.pdf"
        shutil.copy2(pdf_path, input_pdf)

        opendataloader_pdf.convert(
            input_path=[str(input_pdf)],
            output_dir=str(output_dir),
            format="markdown",
        )

        candidates = sorted(output_dir.rglob("*.md"))
        if not candidates:
            return ""

        preferred = next((path for path in candidates if path.name == "input.md"), candidates[0])
        return sanitize_markdown(preferred.read_text(encoding="utf-8"))


def extract_markdown_with_ocr(pdf_path: Path) -> str:
    configure_tesseract()
    pdf = pdfium.PdfDocument(str(pdf_path))
    pages: list[str] = []
    for index in range(len(pdf)):
        image = pdf[index].render(scale=2.4).to_pil()
        text = pytesseract.image_to_string(image, lang="kor+eng")
        cleaned = clean_ocr_text(text)
        if cleaned:
            pages.append(f"## 페이지 {index + 1}\n\n{cleaned}")
    return "\n\n".join(pages).strip()


def line_is_reasonable(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if len(stripped) < 2:
        return False
    if re.fullmatch(r"[\W_]+", stripped):
        return False
    if stripped.startswith("|") and stripped.endswith("|"):
        return False
    if re.search(r"[\U0001F300-\U0001FAFF]", stripped):
        return False

    suspicious_marks = stripped.count("?") + stripped.count("�")
    if suspicious_marks >= 3:
        return False

    cjk_count = len(re.findall(r"[\u3400-\u4DBF\u4E00-\u9FFF]", stripped))
    if cjk_count >= 2:
        return False

    weird_ratio = suspicious_marks / max(len(stripped), 1)
    if weird_ratio > 0.06:
        return False

    return True


def build_reference_excerpt(raw_text: str) -> str:
    blocks: list[str] = []
    current: list[str] = []

    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                blocks.append("\n".join(current))
                current = []
            continue
        if line.startswith("#"):
            if current:
                blocks.append("\n".join(current))
                current = []
            current.append(line)
            continue
        if line_is_reasonable(line):
            current.append(line)
        elif current:
            blocks.append("\n".join(current))
            current = []

    if current:
        blocks.append("\n".join(current))

    compact_blocks = [
        block
        for block in blocks
        if len(re.findall(r"[A-Za-z0-9가-힣]", block)) >= 40
    ]

    filtered = "\n\n".join(compact_blocks).strip()
    if len(re.findall(r"[A-Za-z0-9가-힣]", filtered)) < 120:
        return ""
    return filtered


def extract_reference_text(pdf_path: Path) -> str:
    parsed = extract_markdown_with_parser(pdf_path)
    candidate = parsed
    if not candidate or is_sparse_text(candidate):
        candidate = extract_markdown_with_ocr(pdf_path)
    return build_reference_excerpt(candidate)


def block_quality(block: str) -> tuple[int, float, float, int]:
    total = len(block)
    hangul = len(re.findall(r"[가-힣]", block))
    latin = len(re.findall(r"[A-Za-z]", block))
    digits = len(re.findall(r"\d", block))
    suspicious = block.count("?") + block.count("�")
    hangul_ratio = hangul / max(total, 1)
    latin_ratio = latin / max(total, 1)
    score = hangul + digits - suspicious * 12 - latin * 2
    return score, hangul_ratio, latin_ratio, suspicious


def should_keep_reference_block(block: str, policy: str) -> bool:
    score, hangul_ratio, latin_ratio, suspicious = block_quality(block)
    if len(re.findall(r"[A-Za-z0-9가-힣]", block)) < 30:
        return False
    if suspicious >= 4:
        return False

    if policy == "full":
        return score > 20 and hangul_ratio >= 0.18
    if policy == "filtered":
        if hangul_ratio < 0.28:
            return False
        if latin_ratio > 0.22:
            return False
        if re.search(r"[A-Za-z]{4,}", block) and hangul_ratio < 0.45:
            return False
        return score > 40

    return False


def build_reference_section(reference_text: str, policy: str, max_chars: int = 16000) -> str:
    if policy == "none":
        return ""

    blocks: list[str] = []
    total_chars = 0

    for raw_block in reference_text.split("\n\n"):
        lines = [line.rstrip() for line in raw_block.splitlines() if line.strip()]
        if not lines:
            continue

        block = "\n".join(lines).strip()
        if not should_keep_reference_block(block, policy):
            continue

        block_len = len(block)
        if blocks and total_chars + block_len > max_chars:
            break

        blocks.append(block)
        total_chars += block_len

    if not blocks:
        return ""

    lines = ["## 원문 기반 상세 내용", ""]
    for block in blocks:
        lines.append(block)
        lines.append("")
    return "\n".join(lines).strip()


def build_detail_sections(output_name: str) -> str:
    sections = DETAIL_SECTIONS.get(output_name, [])
    if not sections:
        return ""

    lines: list[str] = []
    for section in sections:
        if lines:
            lines.append("")
        lines.append(section["heading"])
        lines.append("")
        lines.extend([f"- {item}" for item in section["items"]])
    return "\n".join(lines)


def build_common_course_section(output_name: str) -> str:
    details = COURSE_DETAILS[output_name]
    lines = [
        "## 과정 한눈에 보기",
        "",
        f"- 공식 과정명: {details['official_name']}",
        "- 기간: 6개월 (960시간)",
        "- 비용: 교육비 0원 + 훈련장려금 240만 원 안내 기준",
        "- 교육 장소: G밸리 캠퍼스 또는 동작 캠퍼스 안내 기준",
        "- 운영 사업: 2026 K-디지털 트레이닝 AI 심화 훈련",
        "",
        "## 과정 정체성",
        "",
        f"- {details['identity']}",
        "",
        "## 핵심 가치",
        "",
    ]
    lines.extend([f"- {item}" for item in details["core_value"]])
    lines.extend(
        [
            "",
            "## 추천 대상",
            "",
        ]
    )
    lines.extend([f"- {item}" for item in details["recommended_for"]])
    lines.extend(
        [
            "",
            "## 수료 후 방향",
            "",
        ]
    )
    lines.extend([f"- {item}" for item in details["roles"]])
    lines.extend(
        [
            "",
            "## 프로젝트 예시",
            "",
        ]
    )
    lines.extend([f"- {item}" for item in details["projects"]])
    return "\n".join(lines)


def build_summary_sections(output_name: str) -> str:
    if output_name in COURSE_DETAILS:
        return build_common_course_section(output_name)

    summary = DOCUMENT_SUMMARIES[output_name]
    lines = [
        "## 핵심 요약",
        "",
    ]
    lines.extend([f"- {item}" for item in summary["overview"]])
    lines.extend(
        [
            "",
            "## 꼭 알아둘 내용",
            "",
        ]
    )
    lines.extend([f"- {item}" for item in summary["highlights"]])
    lines.extend(
        [
            "",
            "## 상담 시 자주 연결할 질문",
            "",
        ]
    )
    lines.extend([f"- {item}" for item in summary["counseling_points"]])
    return "\n".join(lines)


def build_document_content(spec: dict, reference_text: str) -> str:
    category = category_by_id(spec["category_id"])
    detail_section = build_detail_sections(spec["output"])
    reference_policy = REFERENCE_POLICIES.get(spec["output"], "filtered")
    reference_section = build_reference_section(reference_text, reference_policy)

    lines = [
        f"# {spec['title']}",
        "",
        f"- 문서 분류: {category['label']}",
        f"- 원본 파일: {spec['source']}",
        "",
        "---",
        "",
        build_summary_sections(spec["output"]),
    ]

    if detail_section:
        lines.extend(["", detail_section])
    if reference_section:
        lines.extend(["", reference_section])

    lines.append("")
    return "\n".join(lines)


def convert_managed_pdfs() -> list[dict]:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    documents: list[dict] = []

    for spec in PDF_SPECS:
        pdf_path = SOURCE_DIR / spec["source"]
        if not pdf_path.exists():
            raise FileNotFoundError(f"Source PDF not found: {pdf_path}")

        print(f"  Converting {spec['source']}")
        reference_text = extract_reference_text(pdf_path)
        content = build_document_content(spec, reference_text)

        output_path = DOCS_DIR / spec["output"]
        output_path.write_text(content, encoding="utf-8")
        documents.append(
            {
                "path": output_path.name,
                "title": spec["title"],
                "category": category_by_id(spec["category_id"])["label"],
                "source": spec["source"],
            }
        )

    DOC_CATALOG_PATH.write_text(
        json.dumps({"documents": documents, "categories": CATEGORIES}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return documents


def build_faq_entry(
    faq_id: int,
    category: str,
    question: str,
    answer: str,
    keywords: list[str],
    source_file: str,
) -> dict:
    return {
        "id": f"faq_{faq_id:03d}",
        "category": category,
        "question": question,
        "answer": answer,
        "keywords": keywords,
        "source_file": source_file,
    }


def build_suggested_questions() -> list[dict]:
    return [
        {
            "id": f"sq_{index + 1:03d}",
            "label": category["label"],
            "query": category["query"],
        }
        for index, category in enumerate(CATEGORIES)
    ]


def build_faq_json() -> dict:
    faqs: list[dict] = []
    faq_id = 1

    guide_answers = {
        "법률": "법률 카테고리에서는 개인정보 수집 범위, 보관·삭제 기준, 광고 문구의 허위·과장 여부처럼 상담 과정에서 법적 리스크가 생길 수 있는 질문을 먼저 확인하면 좋습니다.",
        "운영규정": "운영규정 카테고리에서는 국민내일배움카드 발급 가능 여부, 지원 한도, 본인부담금, 출결·수료·중도포기 기준처럼 실제 수강 절차와 연결되는 질문이 가장 유용합니다.",
        "과정 상세": "과정 상세 카테고리에서는 세 과정의 차이, 추천 대상, 프로젝트 예시, 수료 후 진로 방향을 비교하는 질문이 가장 자연스럽습니다.",
        "플레이데이터 정보": "플레이데이터 정보 카테고리에서는 기관 특성, 교육 대상, 캠퍼스 위치, 운영시간, 제공 물품 및 지참 사항, 오프라인 운영 방식처럼 지원 전 기본 정보를 확인하는 질문이 좋습니다.",
    }

    for category in CATEGORIES:
        faqs.append(
            build_faq_entry(
                faq_id,
                "카테고리 안내",
                category["query"],
                guide_answers[category["label"]],
                [category["label"], "질문 추천", "상담 시작"],
                "system",
            )
        )
        faq_id += 1

    faqs.extend(
        [
            build_faq_entry(
                faq_id,
                "과정 상세",
                "세 과정의 차이를 한 번에 설명해 주세요.",
                "AI Ready 데이터 엔지니어링 캠프는 모델 운영과 자동화, 데이터 분석 & AI 머신러닝 캠프는 RAG·GraphRAG와 검색 정확도 개선, 멀티 에이전트 AI 오케스트레이션 캠프는 멀티에이전트와 워크플로우 설계에 초점이 있습니다.",
                ["과정 비교", "MLOps", "머신러닝", "AI 오케스트레이션"],
                "system",
            ),
            build_faq_entry(
                faq_id + 1,
                "과정 상세",
                "AI Ready 데이터 엔지니어링 캠프는 어떤 사람에게 맞나요?",
                "모델 개발 이후 배포, 운영 자동화, CI/CD/CT, 모니터링까지 이어지는 파이프라인에 관심이 있는 사람에게 가장 잘 맞습니다.",
                ["MLOps", "추천 대상", "운영 자동화"],
                "system",
            ),
            build_faq_entry(
                faq_id + 2,
                "과정 상세",
                "데이터 분석 & AI 머신러닝 캠프는 어떤 사람에게 맞나요?",
                "RAG, 지식 그래프, 검색 품질, 문서 기반 AI 시스템처럼 정확한 답변과 추론 구조를 설계하는 데 관심이 있는 사람에게 적합합니다.",
                ["머신러닝", "RAG", "GraphRAG"],
                "system",
            ),
            build_faq_entry(
                faq_id + 3,
                "과정 상세",
                "멀티 에이전트 AI 오케스트레이션 캠프는 어떤 사람에게 맞나요?",
                "여러 AI 에이전트를 설계하고 연결해 실제 업무 문제를 풀고 싶은 사람, AI 서비스 기획과 애플리케이션 구현을 함께 경험하고 싶은 사람에게 적합합니다.",
                ["AI 오케스트레이션", "멀티에이전트", "서비스 기획"],
                "system",
            ),
            build_faq_entry(
                faq_id + 4,
                "과정 상세",
                "멀티 에이전트 AI 오케스트레이션 캠프의 프로젝트 예시는 무엇인가요?",
                "Auto-Healing 기반 장애 복구 에이전트, 기업형 비서·자산 관리 멀티에이전트, 금융 상담 에이전트, 시장 조사 자동화 에이전트 같은 프로젝트 예시가 상담 포인트로 적합합니다.",
                ["AI 오케스트레이션", "프로젝트", "에이전트"],
                "system",
            ),
            build_faq_entry(
                faq_id + 5,
                "과정 상세",
                "AI Ready 데이터 엔지니어링 캠프의 프로젝트 예시는 무엇인가요?",
                "RAGOps 데이터 파이프라인, OCR 모델 자동 재학습, 카나리 배포와 모니터링, 데이터 검증 기반 이상 탐지, 모델 이력 관리 플랫폼 같은 예시로 설명할 수 있습니다.",
                ["MLOps", "프로젝트", "배포", "모니터링"],
                "system",
            ),
            build_faq_entry(
                faq_id + 6,
                "과정 상세",
                "데이터 분석 & AI 머신러닝 캠프의 프로젝트 예시는 무엇인가요?",
                "RAG 기반 질의응답 서비스, 규정 준수 검증 시스템, 커리어 가이드 서비스, 지식 그래프 기반 상담 에이전트처럼 검색과 추론 품질이 중요한 서비스 예시로 설명할 수 있습니다.",
                ["머신러닝", "프로젝트", "RAG", "지식 그래프"],
                "system",
            ),
            build_faq_entry(
                faq_id + 7,
                "운영규정",
                "국민내일배움카드는 어떤 제도인가요?",
                "취업 준비나 직무 전환, 재직자 역량 강화를 위해 훈련비를 지원하는 제도이며, 기본적으로 5년간 300만 원 한도에서 시작하고 조건에 따라 최대 500만 원까지 확대될 수 있습니다.",
                ["국민내일배움카드", "지원 제도", "훈련비"],
                "system",
            ),
            build_faq_entry(
                faq_id + 8,
                "운영규정",
                "국민내일배움카드 발급 대상인지 무엇부터 확인해야 하나요?",
                "고용24와 고용센터 기준으로 발급 가능 여부, 지원 제외 대상 여부, 현재 고용 상태와 지원 한도를 먼저 확인하는 것이 가장 중요합니다.",
                ["발급자격", "고용24", "고용센터"],
                "system",
            ),
            build_faq_entry(
                faq_id + 9,
                "운영규정",
                "출결이나 중도포기가 지원금에 영향을 주나요?",
                "그렇습니다. 출결은 수료와 지원금, 훈련장려금에 직접 연결되며, 중도포기나 부정 출결은 지원 제한이나 환수로 이어질 수 있습니다.",
                ["출결", "중도포기", "훈련장려금"],
                "system",
            ),
            build_faq_entry(
                faq_id + 10,
                "플레이데이터 정보",
                "플레이데이터 교육은 어떤 사람에게 맞나요?",
                "연령과 전공에 상관없이 IT·데이터·AI 분야로 취업하거나 직무를 전환하고 싶은 사람, 오프라인 중심으로 몰입 학습을 원하는 사람에게 잘 맞습니다.",
                ["플레이데이터", "교육 대상", "비전공자"],
                "system",
            ),
            build_faq_entry(
                faq_id + 11,
                "플레이데이터 정보",
                "캠퍼스 운영시간과 수업 시간은 어떻게 다른가요?",
                "캠퍼스는 오전 8시 30분부터 오후 10시까지 운영되며, 실제 수업은 평일 오전 9시부터 오후 6시까지 진행되는 기준으로 안내하면 됩니다.",
                ["운영시간", "수업시간", "캠퍼스"],
                "system",
            ),
            build_faq_entry(
                faq_id + 12,
                "플레이데이터 정보",
                "노트북이나 교재를 따로 준비해야 하나요?",
                "상담 시에는 노트북과 교재 대여 가능 여부를 캠퍼스 안내 문서 기준으로 함께 설명해 주면 좋습니다. 세부 정책은 과정과 시점에 따라 다시 확인하는 것이 안전합니다.",
                ["노트북", "교재", "대여"],
                "system",
            ),
            build_faq_entry(
                faq_id + 13,
                "법률",
                "상담 챗봇이 개인정보를 받을 때 가장 먼저 주의할 점은 무엇인가요?",
                "수집 목적을 명확히 안내하고, 목적에 필요한 최소한의 정보만 받아야 하며, 보관·삭제 기준도 함께 설명할 수 있어야 합니다.",
                ["개인정보", "수집", "보관"],
                "system",
            ),
            build_faq_entry(
                faq_id + 14,
                "법률",
                "광고 문구를 안내할 때 어떤 점을 조심해야 하나요?",
                "취업, 혜택, 지원금, 수료 효과를 과장하지 말고 객관적 근거가 있는 범위 안에서만 설명해야 합니다. 비교 표현도 기준이 명확해야 합니다.",
                ["광고", "허위과장", "비교광고"],
                "system",
            ),
        ]
    )

    return {
        "faqs": faqs,
        "suggested_questions": build_suggested_questions(),
        "categories": CATEGORIES,
    }


def main() -> None:
    if not SOURCE_DIR.exists():
        print(f"Source directory not found: {SOURCE_DIR}")
        sys.exit(1)

    print("=" * 60)
    print("1. Convert managed PDF files to Markdown")
    print("=" * 60)
    documents = convert_managed_pdfs()
    print(f"Converted {len(documents)} PDF files into {DOCS_DIR}")

    print("\n" + "=" * 60)
    print("2. Generate faq.json")
    print("=" * 60)
    FAQ_DIR.mkdir(parents=True, exist_ok=True)
    faq_payload = build_faq_json()
    FAQ_JSON_PATH.write_text(
        json.dumps(faq_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Generated {len(faq_payload['faqs'])} FAQ entries at {FAQ_JSON_PATH}")

    print("\n" + "=" * 60)
    print("Done")
    print("=" * 60)
    print(f"Managed docs catalog: {DOC_CATALOG_PATH}")
    print(f"Suggested category buttons: {len(faq_payload['suggested_questions'])}")


if __name__ == "__main__":
    main()
