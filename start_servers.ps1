# CodeAI 서버 시작 스크립트 (PowerShell 전용)
# 실행: 우클릭 -> "PowerShell로 실행"  또는  .\start_servers.ps1

$root = $PSScriptRoot

Write-Host "====================================================`n CodeAI 서버 시작`n====================================================" -ForegroundColor Cyan

# ── 백엔드 ──────────────────────────────────────────────
Write-Host "[1/2] 백엔드(FastAPI :8888) 시작..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$root\backend'; .\venv\Scripts\Activate.ps1; python -m uvicorn app.main:app --reload --port 8888 --host 0.0.0.0" `
    -WindowStyle Normal

Start-Sleep -Seconds 2

# ── 프론트엔드 ───────────────────────────────────────────
Write-Host "[2/2] 프론트엔드(Vite :5173) 시작..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location '$root\frontend'; & 'C:\Program Files\nodejs\npm.cmd' run dev" `
    -WindowStyle Normal

Write-Host "`n브라우저에서 http://localhost:5173 접속하세요." -ForegroundColor Green
