@echo off
setlocal

:: Node.js 경로 등록 (npm.cmd 사용 가능하도록)
set PATH=C:\Program Files\nodejs;%PATH%

echo ====================================================
echo  CodeAI 교육 상담 챗봇 시스템 시작
echo ====================================================
echo.

:: ── 백엔드 ──────────────────────────────────────────
echo [1/2] 백엔드(FastAPI) 서버 시작...
start "CodeAI Backend (FastAPI :8888)" cmd /k ^
  "cd /d "%~dp0backend" && venv\Scripts\activate && python -m uvicorn app.main:app --reload --port 8888 --host 0.0.0.0 && pause"

:: ── 프론트엔드 ───────────────────────────────────────
echo [2/2] 프론트엔드(React/Vite) 서버 시작...
start "CodeAI Frontend (Vite :5173)" cmd /k ^
  "cd /d "%~dp0frontend" && npm.cmd run dev && pause"

echo.
echo ====================================================
echo  두 개의 터미널 창이 열렸습니다. 끄지 마세요!
echo  브라우저에서 http://localhost:5173 접속
echo ====================================================
pause
