@echo off
chcp 65001 >nul
REM Zhangl Agent launcher (Windows)
REM Usage: zhangl or zhangl --web

setlocal enabledelayedexpansion

for %%A in ("%~dp0..") do set "PROJECT_DIR=%%~fA"
set WEB_PORT=8765
if defined ZHANGL_WEB_PORT set WEB_PORT=%ZHANGL_WEB_PORT%
set LOG_FILE=%TEMP%\zhangl-web.log

REM Find Python
set PYTHON=
where python.exe >nul 2>&1 && set PYTHON=python
if "%PYTHON%"=="" where python >nul 2>&1 && set PYTHON=python
if "%PYTHON%"=="" (
    echo ERROR: Python not found. Install Python 3.10+.
    pause
    exit /b 1
)

REM Show Python info (validate it actually works)
echo Python: %PYTHON%
%PYTHON% --version
if %errorlevel% neq 0 (
    echo ERROR: Python found but not working. Reinstall Python.
    pause
    exit /b 1
)

REM Switch to project dir so Python can find backend package
cd /d "%PROJECT_DIR%"

REM Quick dep check (mirror: aliyun)
%PYTHON% -c "import backend, fastapi, uvicorn" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing dependencies from aliyun mirror...
    %PYTHON% -m pip install -r "%PROJECT_DIR%\requirements.txt" -i https://mirrors.aliyun.com/pypi/simple/
    if %errorlevel% neq 0 (
        echo Mirror failed, retrying default...
        %PYTHON% -m pip install -r "%PROJECT_DIR%\requirements.txt"
        if %errorlevel% neq 0 (
            echo ERROR: pip install failed. Check network or run manually:
            echo   %PYTHON% -m pip install -r "%PROJECT_DIR%\requirements.txt"
            pause
            exit /b 1
        )
    )
    REM Re-check after install
    %PYTHON% -c "import backend, fastapi, uvicorn" >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: core modules still not importable after pip install.
        pause
        exit /b 1
    )
    echo Dependencies installed OK.
)

REM Load/create settings
set SETTINGS=%APPDATA%\zhangl-agent\settings.json
set PY_SETTINGS=%SETTINGS:\=/%

if not exist "%SETTINGS%" (
    echo Creating default settings: %SETTINGS%
    mkdir "%APPDATA%\zhangl-agent" 2>nul
    %PYTHON% -c "import json,os;d={'model':{'MODEL_PROVIDER':'deepseek','ZHANGL_BASE_URL':'','ZHANGL_AUTH_TOKEN':'','DEFAULT_MODEL':'deepseek-v4-flash','DEFAULT_MODEL_MAX_TOKENS':32768,'SMART_MODEL':'','SMART_MODEL_MAX_TOKENS':32768,'SMALL_MODEL':'','SMALL_MODEL_MAX_TOKENS':32768},'permissions':{'allow':[],'deny':[],'ask_before':['write_file']},'memory':{'enabled':True,'storage_dir':'','auto_remember':True},'export':{'default_format':'json','default_dir':'./test_cases','formats':{'json':{'enabled':True,'template':''},'excel':{'enabled':True,'template':''},'markdown':{'enabled':False,'template':''},'testrail_csv':{'enabled':False,'template':''}}},'status_line':{'type':'default','items':['model','provider','tokens']},'ui':{'theme':'dark','dialog_style':'panel'}};os.makedirs(os.path.dirname(r'%PY_SETTINGS%'),exist_ok=True);json.dump(d,open(r'%PY_SETTINGS%','w'),indent=2,ensure_ascii=False)"
)

REM Load API credentials from settings
for /f "delims=" %%i in ('%PYTHON% -c "import json;d=json.load(open('%PY_SETTINGS%'));mc=d.get('model',{});print(mc.get('ZHANGL_AUTH_TOKEN',mc.get('auth_token','')))" 2^>nul') do if not "%%i"=="" set OPENAI_API_KEY=%%i
for /f "delims=" %%i in ('%PYTHON% -c "import json;d=json.load(open('%PY_SETTINGS%'));mc=d.get('model',{});print(mc.get('ZHANGL_BASE_URL',mc.get('base_url','')))" 2^>nul') do if not "%%i"=="" set OPENAI_API_BASE=%%i

REM Kill stale
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%WEB_PORT% " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%a /F 2>nul
    timeout /t 1 /nobreak >nul
)

REM Start server
echo.
echo Starting web server on http://localhost:%WEB_PORT% ...
echo ----------------------------------------
start "zhangl-web" /B cmd /c "%PYTHON% -m uvicorn backend.app:app --host 0.0.0.0 --port %WEB_PORT% 1>%LOG_FILE% 2>&1"
echo ----------------------------------------

REM Wait for ready (up to 15s)
set ready=0
for /l %%i in (1,1,15) do (
    timeout /t 1 /nobreak >nul
    %PYTHON% -c "import urllib.request;urllib.request.urlopen('http://localhost:%WEB_PORT%/api/projects')" >nul 2>&1
    if !errorlevel!==0 (
        set ready=1
        echo Server ready!
        start http://localhost:%WEB_PORT%
        goto :done
    )
    echo Waiting... %%i/15
)

:done
echo.
echo === Zhangl Agent Web ===
echo URL: http://localhost:%WEB_PORT%
echo Log: %LOG_FILE%
if "!ready!"=="1" (
    echo Browser opened. You can close this window.
) else (
    echo.
    echo ========================================
    echo   Server did NOT start successfully!
    echo ========================================
    echo.
    echo Check the log for details:
    echo   type "%LOG_FILE%"
    echo.
    echo Or run manually to see the error:
    echo   cd /d "%PROJECT_DIR%"
    echo   %PYTHON% -m uvicorn backend.app:app --host 0.0.0.0 --port %WEB_PORT%
    echo.
)
pause