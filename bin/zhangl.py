#!/usr/bin/env python
"""
Zhangl Agent launcher — works on macOS, Linux, Windows.
Usage:
  python bin/zhanglnb.py              Web server + CLI
  python bin/zhanglnb.py --web        Web server only
  python bin/zhanglnb.py -s "prompt"  One-shot
"""

import os, sys, subprocess, time, json, argparse, tempfile, platform
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
WEB_PORT = os.environ.get("ZHANGL_WEB_PORT", "8765")
LOG_FILE = Path(tempfile.gettempdir()) / "zhangl-web.log"
MIRROR = "https://mirrors.aliyun.com/pypi/simple/"
if platform.system() == "Windows":
    SETTINGS_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "zhangl-agent"
else:
    SETTINGS_DIR = Path.home() / ".zhangl-agent"
SETTINGS = SETTINGS_DIR / "settings.json"

DEFAULT_SETTINGS = {
    "model": {
        "MODEL_PROVIDER": "openai",
        "ZHANGL_BASE_URL": "",
        "ZHANGL_AUTH_TOKEN": "",
        "DEFAULT_MODEL": "deepseek-v4-flash",
        "DEFAULT_MODEL_MAX_TOKENS": 32768,
        "SMART_MODEL": "",
        "SMART_MODEL_MAX_TOKENS": 32768,
        "SMALL_MODEL": "",
        "SMALL_MODEL_MAX_TOKENS": 32768
    },
    "permissions": {"allow": [], "deny": [], "ask_before": ["write_file"]},
    "memory": {"enabled": True, "storage_dir": "", "auto_remember": True},
    "export": {"default_format": "json", "default_dir": "./test_cases", "formats": {
        "json": {"enabled": True, "template": ""},
        "excel": {"enabled": True, "template": ""},
        "markdown": {"enabled": False, "template": ""},
        "testrail_csv": {"enabled": False, "template": ""}
    }},
    "status_line": {"type": "default", "items": ["model", "provider", "tokens"]},
    "ui": {"theme": "dark", "dialog_style": "panel"}
}

def fail(msg):
    print(f"\n[ERROR] {msg}")
    input("Press Enter to exit...")
    sys.exit(1)

def load_settings():
    if not SETTINGS_DIR.exists():
        SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS.exists():
        print(f"Creating default settings: {SETTINGS}")
        SETTINGS.write_text(json.dumps(DEFAULT_SETTINGS, ensure_ascii=False, indent=2))
    try:
        data = json.loads(SETTINGS.read_text())
        mc = data.get("model", {})
        api_key = mc.get("ZHANGL_AUTH_TOKEN", mc.get("auth_token", ""))
        base_url = mc.get("ZHANGL_BASE_URL", mc.get("base_url", ""))
        if api_key:
            os.environ["OPENAI_API_KEY"] = api_key
        if base_url:
            os.environ["OPENAI_API_BASE"] = base_url
    except Exception:
        pass

def check_deps():
    r = subprocess.run([sys.executable, "-c", "import backend, fastapi, uvicorn"],
                       capture_output=True, timeout=15)
    return r.returncode == 0

def install_deps():
    print("Installing dependencies (mirror: aliyun)...")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "-r",
                        str(PROJECT_DIR / "requirements.txt"),
                        "-i", MIRROR])
    if r.returncode != 0:
        print("Mirror failed, retrying default...")
        r = subprocess.run([sys.executable, "-m", "pip", "install", "-r",
                            str(PROJECT_DIR / "requirements.txt")])
    return r.returncode == 0

def kill_stale():
    try:
        if platform.system() == "Windows":
            out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True)
            for line in out.stdout.split("\n"):
                if f":{WEB_PORT}" in line and "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    subprocess.run(["taskkill", "/PID", pid, "/F"],
                                   capture_output=True)
                    time.sleep(1)
                    break
        else:
            subprocess.run(["lsof", "-ti", f"tcp:{WEB_PORT}"],
                           capture_output=True)
            # lsof returns PIDs, but killing them is OS-specific
            import signal
            out = subprocess.run(["lsof", "-ti", f"tcp:{WEB_PORT}"],
                                 capture_output=True, text=True)
            for pid in out.stdout.strip().split("\n"):
                if pid:
                    os.kill(int(pid), signal.SIGKILL)
                    time.sleep(1)
    except Exception:
        pass  # best-effort

def open_browser(url):
    sys_name = platform.system()
    if sys_name == "Darwin":
        subprocess.run(["open", url])
    elif sys_name == "Windows":
        os.startfile(url)
    else:
        subprocess.run(["xdg-open", url])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--web", action="store_true")
    parser.add_argument("-s", "--one-shot", default="")
    parser.add_argument("cli_args", nargs="*")
    args = parser.parse_args()

    os.chdir(PROJECT_DIR)

    # ── Deps ────────────────────────────────────
    if not check_deps():
        if not install_deps():
            fail("Dependency installation failed")
        if not check_deps():
            fail("Dependencies installed but still not importable. Run: pip install -r requirements.txt")

    # ── Settings ────────────────────────────────
    load_settings()
    # load_settings now auto-creates default settings if missing

    # ── Kill stale ──────────────────────────────
    kill_stale()

    # ── Start server ────────────────────────────
    print(f"Starting server on http://localhost:{WEB_PORT} ...")
    popen_kw = {
        "stdout": open(LOG_FILE, "w"),
        "stderr": subprocess.STDOUT,
    }
    if platform.system() == "Windows":
        popen_kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kw["start_new_session"] = True
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.app:app",
         "--host", "0.0.0.0", "--port", WEB_PORT],
        **popen_kw
    )

    # ── Wait ready ──────────────────────────────
    import urllib.request
    print("Waiting for server", end="", flush=True)
    ready = False
    for _ in range(30):
        time.sleep(0.5)
        print(".", end="", flush=True)
        try:
            urllib.request.urlopen(f"http://localhost:{WEB_PORT}/api/projects", timeout=2)
            ready = True
            break
        except Exception:
            pass
    print(" ready!" if ready else "\nServer still starting...")

    # ── Open browser ────────────────────────────
    try:
        open_browser(f"http://localhost:{WEB_PORT}")
    except Exception:
        pass

    # ── Run ─────────────────────────────────────
    if args.web:
        print(f"\n=== Zhangl Agent Web ===")
        print(f"URL: http://localhost:{WEB_PORT}")
        print(f"Log: {LOG_FILE}")
        print("Press Ctrl+C to stop")
        try:
            server.wait()
        except KeyboardInterrupt:
            pass
    elif args.one_shot:
        subprocess.run([sys.executable, "-m", "cli.main", "-s", args.one_shot])
    else:
        print(f"\n=== Zhangl Agent ===")
        print(f"Web UI: http://localhost:{WEB_PORT}\n")
        subprocess.run([sys.executable, "-m", "cli.main"] + args.cli_args)

    # ── Cleanup ─────────────────────────────────
    if server.poll() is None:
        print("Stopping server...")
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    main()
