import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / "backend" / ".env")
from app.services.rag_service import get_rag_service
print("인덱싱 시작...")
rag = get_rag_service()
rag.index_all()
count = rag._vectorstore.index.ntotal if rag._vectorstore else 0
print(f"완료. 문서(청크) 수: {count}")
