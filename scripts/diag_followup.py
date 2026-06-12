import os, sys, json, asyncio
sys.path.insert(0, "backend"); sys.stdout.reconfigure(encoding="utf-8")
for line in open("backend/.env", encoding="utf-8"):
    line=line.strip()
    if line and not line.startswith("#") and "=" in line:
        k,v=line.split("=",1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
DATA=json.load(open("data/faq/faq.json",encoding="utf-8"))
from app.services import faq_service as F
F._get_faq_data=lambda: DATA
from app.services import router_service as R
from app.services.openai_service import client as OAI
from app.config import get_settings
MODEL=get_settings().intent_model_name

HIST=[
 {"role":"user","content":"주말에는 알바 하면서 평일에는 수업듣는게 가능할까?"},
 {"role":"assistant","content":"가능한 경우가 많아요. 캠퍼스는 8:30~22시, 수업은 평일 9~18시예요. 어떤 과정 생각 중이세요? 알바는 토/일 중 언제, 하루 몇 시간인가요?"},
 {"role":"user","content":"토,일 오전 9시부터 6시까지 알바야"},
 {"role":"assistant","content":"주말 토/일 9~18시면 평일 수업과 충돌 가능성은 낮아요. 알바가 토/일 둘 다인가요? 어떤 과정 보세요?"},
]
TESTS=[
 ("둘다 알바야", HIST),
 ("토,일 오전 9시부터 6시까지 알바야", HIST[:2]),
 ("응 둘 다야", HIST),
 ("MLOps 생각 중이야", HIST),
]
async def main():
    for msg,h in TESTS:
        d=await R.route(msg,h,faqs=DATA["faqs"],client=OAI,model=MODEL)
        print(f"\nU: {msg}")
        print(f"  → handler={d.handler} faq_id={d.faq_id} via={d.via} search={d.search_query!r} slots={d.slots}")
asyncio.run(main())
