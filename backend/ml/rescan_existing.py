"""
rescan_existing.py
Re-submits already-saved images in uploads/medicine/ to the running pc_server
so they get processed by AI Pipeline 2 and appear on the frontend dashboard.
"""
import os
import sys
import glob
import time
import requests

PC_SERVER = "http://localhost:9000"
MEDICINE_DIR = os.path.join(os.path.dirname(__file__), "uploads", "medicine")

def rescan():
    # Check server is up
    try:
        r = requests.get(f"{PC_SERVER}/status", timeout=5)
        print(f"[RESCAN] Server online: {r.json()}")
    except Exception as e:
        print(f"[RESCAN] ERROR: Server not reachable at {PC_SERVER} — {e}")
        sys.exit(1)

    images = sorted(glob.glob(os.path.join(MEDICINE_DIR, "medicine_*.jpg")))
    print(f"[RESCAN] Found {len(images)} images to re-submit.\n")

    ok = 0
    for img_path in images:
        fname = os.path.basename(img_path)
        try:
            with open(img_path, "rb") as f:
                data = f.read()
            r = requests.post(f"{PC_SERVER}/upload", data=data,
                              headers={"Content-Type": "application/octet-stream"},
                              timeout=10)
            print(f"  [{r.status_code}] Submitted: {fname} ({len(data)//1024} KB)")
            ok += 1
            time.sleep(1.5)  # slight gap so the queue doesn't overflow
        except Exception as e:
            print(f"  [ERROR] {fname}: {e}")

    print(f"\n[RESCAN] Done — {ok}/{len(images)} images re-submitted to AI pipeline.")
    print("[RESCAN] Watch the dashboard for results (each scan takes ~10-30s on CPU).")

if __name__ == "__main__":
    rescan()
