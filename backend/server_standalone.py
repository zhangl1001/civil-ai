"""Standalone entry point for bundled app. Serves both API and static files."""
import os
import sys

# CRITICAL: Prevent this subprocess from showing on the Dock
# This must be done before importing anything that touches NSApplication
if sys.platform == 'darwin':
    try:
        import Foundation
        # Tell macOS this process should not appear in the Dock
        info = Foundation.NSBundle.mainBundle().infoDictionary()
        info['LSUIElement'] = '1'
    except:
        pass
    # Alternative: set env var before any Cocoa import
    os.environ['PYTHONUNBUFFERED'] = '1'

import uvicorn
from backend.app import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="warning")
