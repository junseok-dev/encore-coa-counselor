"""현재 라우팅 vs 하이브리드 라우터 — 같은 평가셋으로 정확도 비교 (오프라인).
backend/.env의 키를 로드해 실제 LLM(nano)로 라우팅을 돌린다. 운영 DB는 건드리지 않음(FAQ는 json).
"""
import os, sys, json, asyncio
sys.path.insert(0, "backend")
sys.stdout.reconfigure(encoding="utf-8")

# 1) backend/.env 로드 (키/모델명 등)
for line in open("backend/.env", encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

# 2) FAQ는 json 직접 사용(운영 DB 우회)
DATA = json.load(open("data/faq/faq.json", encoding="utf-8"))
FAQS = DATA["faqs"]
from app.services import faq_service as F
F._get_faq_data = lambda: DATA

from app.services import router_service as R
from app.services.intent_service import classify_intent
from app.services.guardrail_service import check as guardrail_check
from app.services.openai_service import client as OAI
from app.config import get_settings

MODEL = get_settings().intent_model_name
EVAL = json.load(open("data/routing_evalset.json", encoding="utf-8"))["cases"]


def current_faq_id(message):
    m = F.match_faq(message)
    if not m:
        return None
    score, faq = m
    if not faq.get("direct_answer"):
        return None
    if F._is_guide_faq(faq) and not F.is_guide_query(message):
        return None
    if score >= 10.0:
        return faq.get("id")
    if score >= 7.5 and not F.is_multi_intent(message):
        return faq.get("id")
    return None


async def current_route(message, history):
    """현재 chat.py 라우팅 재현: guardrail→schedule→classify_intent→키워드 FAQ."""
    if guardrail_check(message):
        return ("guardrail", None)
    if F.is_schedule_query(message):
        return ("schedule", None)
    intent = await classify_intent(message, history)
    if intent is None:
        fid = current_faq_id(message)
        return ("faq", fid) if fid else ("rag", None)
    it = intent.intent
    if it in ("greeting", "cancel", "handoff", "out_of_scope", "guide"):
        return (it, None)
    fid = current_faq_id(message)  # specific
    return ("faq", fid) if fid else ("rag", None)


async def hybrid_route(message, history):
    if guardrail_check(message):
        return ("guardrail", None, "guardrail")
    d = await R.route(message, history, faqs=FAQS, client=OAI, model=MODEL)
    return (d.handler, d.faq_id, d.via)


def correct(h, fid, exp_h, exp_fid):
    if h != exp_h:
        return False
    if exp_h == "faq":
        return fid == exp_fid
    return True


async def main():
    cur_ok = hyb_ok = 0
    rows = []
    for c in EVAL:
        q, hist = c["query"], c.get("history", [])
        eh, ef = c["expected_handler"], c.get("expected_faq_id")
        try:
            ch, cf = await current_route(q, hist)
        except Exception as e:
            ch, cf = (f"ERR:{type(e).__name__}", None)
        try:
            hh, hf, via = await hybrid_route(q, hist)
        except Exception as e:
            hh, hf, via = (f"ERR:{type(e).__name__}", None, "err")
        c_ok = correct(ch, cf, eh, ef)
        h_ok = correct(hh, hf, eh, ef)
        cur_ok += c_ok
        hyb_ok += h_ok
        rows.append((c["id"], q, eh, ef, ch, cf, c_ok, hh, hf, via, h_ok, c.get("note", "")))
        await asyncio.sleep(0.15)

    n = len(EVAL)
    print("=" * 100)
    print(f"라우팅 정확도 — 현재: {cur_ok}/{n} ({cur_ok/n*100:.0f}%)  |  하이브리드: {hyb_ok}/{n} ({hyb_ok/n*100:.0f}%)")
    print("=" * 100)
    # 불일치/주목 케이스만 상세
    print("\n[차이 또는 실패한 케이스]")
    for (cid, q, eh, ef, ch, cf, cok, hh, hf, via, hok, note) in rows:
        if cok and hok:
            continue
        exp = f"{eh}{('/'+ef) if ef else ''}"
        cur = f"{ch}{('/'+cf) if cf else ''}"
        hyb = f"{hh}{('/'+hf) if hf else ''}"
        print(f"\n  [{cid}] {q}   (기대: {exp})  {note}")
        print(f"      현재   : {cur:28s} {'✅' if cok else '❌'}")
        print(f"      하이브리드: {hyb:28s} {'✅' if hok else '❌'}  (via={via})")

    # via 분포
    from collections import Counter
    vias = Counter(r[9] for r in rows)
    print(f"\n[하이브리드 경로 분포] {dict(vias)}")


asyncio.run(main())
