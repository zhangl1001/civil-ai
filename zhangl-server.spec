# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['backend/server_standalone.py'],
    pathex=[],
    binaries=[],
    datas=[('backend/static', 'backend/static')],
    hiddenimports=['backend.app', 'agent.engine'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='zhangl-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['src-tauri/icons/icon.icns'],
)
app = BUNDLE(
    exe,
    name='zhangl-server.app',
    icon='src-tauri/icons/icon.icns',
    bundle_identifier=None,
)
