import sys, json
sys.path.insert(0, "backend")
sys.stdout.reconfigure(encoding="utf-8")
from app.services import faq_service as F

# DB 우회: 운영 RDS 대신 json 파일을 직접 매칭 소스로 사용 (오프라인 매칭 테스트용)
_DATA = json.load(open("data/faq/faq.json", encoding="utf-8"))
F._get_faq_data = lambda: _DATA

QUERIES = [
    # --- 고쳐야 할 문제 쿼리 ---
    "취업은 어떻게 지원해줘?",
    "AI 오케스트레이션 과정 알려줘",
    "머신러닝 엔지니어 과정 알려줘",
    "환불 규정 알려줘",
    "환불 어떻게 받아?",
    # --- 회귀 확인: 기존에 잘 되던 것 ---
    "취업 지원 어떻게 돼?",
    "교육생 선발 과정이 어떻게 되나요?",
    "개강일이 언제야?",
    "교육 일정 알려줘",
    "인터뷰는 어떻게 진행되나요?",
    "머신러닝 엔지니어 과정은 얼마야?",
]

def top3(q):
    scored = sorted(
        ((F._score_faq(q, faq), faq) for faq in _DATA.get("faqs", [])),
        key=lambda x: x[0], reverse=True,
    )[:3]
    return scored

print("=== 현재 매칭 결과 (상위 3) ===")
for q in QUERIES:
    btn = F.match_button_faq(q)
    gen = F.match_faq_general(q)
    route = "button" if btn else ("general" if gen else "RAG/none")
    print(f"\nQ: {q}   [라우팅={route}]")
    for sc, faq in top3(q):
        print(f"   {sc:5.1f}  {faq.get('category'):12s} | {faq.get('question','')[:40]}")

print("\n\n=== 관련 FAQ 메타 (취업/선발/일정/과정/환불/모집) ===")
for faq in F._get_faq_data().get("faqs", []):
    q = faq.get("question", "")
    cat = faq.get("category", "")
    blob = q + cat + " ".join(faq.get("aliases", []) or [])
    if any(k in blob for k in ["취업", "선발", "일정", "과정", "환불", "모집", "진로", "채용"]):
        print(f"\n- {faq.get('faq_key')} | cat={cat} | direct_answer={faq.get('direct_answer')}")
        print(f"    Q: {q}")
        print(f"    aliases : {faq.get('aliases')}")
        print(f"    keywords: {faq.get('keywords')}")
