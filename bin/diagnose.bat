@echo off
chcp 65001 >nul
echo === Zhangl Config Diagnosis ===
echo.

set SETTINGS=%APPDATA%\zhangl-agent\settings.json
echo Settings path: %SETTINGS%
echo.

REM 1. Check directory
if exist "%APPDATA%\zhangl-agent" (
    echo [OK] Directory exists
) else (
    echo [INFO] Directory not found, trying to create...
    mkdir "%APPDATA%\zhangl-agent" 2>nul
    if !errorlevel!==0 (
        echo [OK] Directory created
    ) else (
        echo [FAIL] Cannot create directory! Permission denied!
        echo Run CMD as Administrator and try again.
        goto :end
    )
)
echo.

REM 2. Test write permission with Python
echo Testing write permission...
python -c "import json,os; p=r'%SETTINGS%'; os.makedirs(os.path.dirname(p),exist_ok=True); json.dump({'test':1},open(p,'w'),indent=2,ensure_ascii=False); print('[OK] Write successful: '+p)" 2>nul
if !errorlevel!==0 (
    echo [OK] Python write OK
) else (
    echo [FAIL] Python write failed!
    echo Check Python installation and run as Administrator.
)
echo.

REM 3. Check port 8765
echo Checking port 8765...
netstat -ano | findstr ":8765 " | findstr "LISTENING" >nul 2>nul
if !errorlevel!==0 (
    echo [WARN] Port 8765 is already in use
    netstat -ano | findstr ":8765 " | findstr "LISTENING"
) else (
    echo [OK] Port 8765 is free
)
echo.

REM 4. Check Python dependencies
echo Checking Python dependencies...
python -c "import backend, fastapi, uvicorn; print('[OK] Core dependencies installed')" 2>nul
if !errorlevel!==0 (
    echo [WARN] Missing dependencies
    echo Run: python -m pip install -r requirements.txt
) else (
    echo [OK] Dependencies OK
)
echo.

:end
echo === Diagnosis Complete ===
pause
