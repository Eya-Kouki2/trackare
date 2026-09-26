"""
Trackare IoT Receiver & AI Pipeline Server
Delegates to pc_server.py to provide real-time stream, incoming queue, and AI scanning.
"""
import os
import sys

# Add current and parent dir to path
DIR = os.path.dirname(os.path.abspath(__file__))
if DIR not in sys.path:
    sys.path.insert(0, DIR)

from pc_server import app, SAVE_DIR

if __name__ == "__main__":
    print(f"[SERVER] Starting Trackare IoT AI Pipeline Server on Port 9000...")
    print(f"[SERVER] Saving images to: {SAVE_DIR}")
    app.run(host="0.0.0.0", port=9000, debug=False, threaded=True)
