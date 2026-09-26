import os
import sys
import time
import json
import queue
import threading
from datetime import datetime
from flask import Flask, request, Response, send_file, jsonify
from flask_cors import CORS

# Ensure parent directory (backend/ml) is in sys.path to import ai_pipeline2
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ML_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
if ML_DIR not in sys.path:
    sys.path.insert(0, ML_DIR)

from ai_pipeline2 import PharmaceuticalScannerPipeline

NODE_SERVER_URL = os.environ.get("NODE_SERVER_URL", "http://localhost:5000")
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "iot-internal-key-trackare")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Directory where medicine images will be saved: backend/ml/uploads/medicine
SAVE_DIR = os.path.abspath(os.path.join(ML_DIR, "uploads", "medicine"))
os.makedirs(SAVE_DIR, exist_ok=True)

# Shared state
# Shared state
latest_frame = None
latest_filepath = None
latest_detection = None
detection_history = []
sse_subscribers = []
incoming_queue = []  # List of dicts: [{"id": filename, "filename": filename, "time": timestamp_str, "path": filepath}]

frame_lock = threading.Lock()
subscribers_lock = threading.Lock()
history_lock = threading.Lock()
pipeline_lock = threading.Lock()
queue_lock = threading.Lock()

# Initialize AI Pipeline 2
print("[PC SERVER] Loading AI Pipeline 2 Engine...")
pipeline = PharmaceuticalScannerPipeline()
print("[PC SERVER] AI Pipeline 2 Ready.")


def notify_subscribers(event_type, data):
    """Sends Server-Sent Events (SSE) to all connected frontend clients."""
    with subscribers_lock:
        dead_subs = []
        payload = f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        for sub_q in sse_subscribers:
            try:
                sub_q.put_nowait(payload)
            except queue.Full:
                dead_subs.append(sub_q)
        for dead in dead_subs:
            sse_subscribers.remove(dead)


# ---------- Receive frames from Pi / Camera / Frontend (Lightweight - Zero CPU overload) ----------
@app.route("/upload", methods=["POST"])
def upload():
    global latest_frame, latest_filepath
    data = None
    original_name = None

    if "image" in request.files or "file" in request.files:
        f = request.files.get("image") or request.files.get("file")
        data = f.read()
        if f.filename:
            original_name = f.filename
    elif request.files:
        for key in request.files:
            f = request.files[key]
            data = f.read()
            if f.filename:
                original_name = f.filename
            break
    else:
        data = request.get_data()

    if data and len(data) > 0:
        with frame_lock:
            latest_frame = data

        timestamp_num = int(time.time() * 1000)
        time_str = datetime.now().strftime("%H:%M:%S")
        filename_base = f"medicine_{timestamp_num}.jpg"
        filename_full = os.path.join(SAVE_DIR, filename_base)
        with open(filename_full, "wb") as f:
            f.write(data)
        
        latest_path = os.path.join(SAVE_DIR, "latest.jpg")
        with open(latest_path, "wb") as f:
            f.write(data)
        
        latest_filepath = filename_full

        # Add to incoming review queue (capped at 50 to prevent unbounded disk usage)
        item = {
            "id": filename_base,
            "filename": filename_base,
            "url": f"/image/{filename_base}",
            "time": time_str,
            "size": len(data)
        }
        with queue_lock:
            incoming_queue.insert(0, item)
            if len(incoming_queue) > 50:
                old = incoming_queue.pop()
                old_path = os.path.join(SAVE_DIR, old["filename"])
                if os.path.exists(old_path):
                    try: os.remove(old_path)
                    except OSError: pass

        notify_subscribers("incoming_queue_updated", list(incoming_queue))
        return jsonify({"status": "success", "message": "Frame received and added to review queue", "item": item}), 200

    return jsonify({"status": "error", "message": "No data received"}), 400


# ---------- List queued incoming images ----------
@app.route("/incoming_queue", methods=["GET"])
def get_incoming_queue():
    with queue_lock:
        return jsonify({"success": True, "queue": list(incoming_queue)})


# ---------- Single image snapshot or specific filename endpoint ----------
@app.route("/image/<filename>")
def get_image_file(filename):
    file_path = os.path.join(SAVE_DIR, os.path.basename(filename))
    if os.path.exists(file_path):
        return send_file(file_path, mimetype="image/jpeg")
    return "Image not found", 404


@app.route("/image")
def image():
    latest_path = os.path.join(SAVE_DIR, "latest.jpg")
    if os.path.exists(latest_path):
        return send_file(latest_path, mimetype="image/jpeg")
    return "No image captured yet", 404


# ---------- MJPEG live video stream to dashboard / frontend ----------
def generate_stream():
    while True:
        with frame_lock:
            frame = latest_frame
        if frame is not None:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.05)


@app.route("/stream")
def stream():
    return Response(generate_stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


# ---------- Scan & Save Frame endpoint (Targeted AI Execution) ----------
@app.route("/scan_frame", methods=["POST"])
def scan_frame():
    global incoming_queue, latest_detection
    req_json = request.get_json(silent=True) or {}
    filename = req_json.get("filename")

    if filename:
        target_path = os.path.join(SAVE_DIR, os.path.basename(filename))
    else:
        target_path = os.path.join(SAVE_DIR, "latest.jpg")

    if not os.path.exists(target_path):
        return jsonify({"error": f"Image file not found: {filename or 'latest.jpg'}"}), 400

    try:
        with pipeline_lock:
            result = pipeline.process_inventory_scan(target_path)

        drug_name = (result.get("drug_name") or "UNKNOWN").strip().upper()
        strength = (result.get("strength") or "N/A").strip().upper()
        is_med = result.get("is_medicine", False) and drug_name != "UNKNOWN"

        detection_payload = {
            "id": int(time.time() * 1000),
            "is_medicine": is_med,
            "drug_name": drug_name,
            "strength": strength,
            "expiry_date": result.get("expiry_date", "UNKNOWN"),
            "inventory_status": result.get("inventory_status", "UNKNOWN"),
            "confidence": result.get("confidence", "HIGH"),
            "verification": result.get("verification", {}),
            "image_url": f"/image/{os.path.basename(target_path)}",
            "image_name": os.path.basename(target_path),
            "scanned_at": datetime.now().strftime("%H:%M:%S"),
            "timestamp": int(time.time() * 1000)
        }

        # Auto-save confirmed medicines to MongoDB ScanQueue
        if is_med:
            try:
                import urllib.request
                push_payload = json.dumps({
                    "drug_name":        detection_payload["drug_name"],
                    "strength":         detection_payload["strength"],
                    "expiry_date":      detection_payload["expiry_date"],
                    "inventory_status": detection_payload["inventory_status"],
                    "confidence":       detection_payload["confidence"],
                    "image_name":       detection_payload.get("image_name", ""),
                    "verification":     detection_payload.get("verification", {}),
                    "source":           "IoT Camera Scan"
                }).encode("utf-8")
                push_req = urllib.request.Request(
                    f"{NODE_SERVER_URL}/internal/scan-queue/internal/push",
                    data=push_payload,
                    headers={
                        "Content-Type":   "application/json",
                        "x-internal-key": INTERNAL_API_KEY
                    },
                    method="POST"
                )
                with urllib.request.urlopen(push_req, timeout=5) as resp:
                    print(f"[PC SERVER] Auto-saved scanned item to DB: {resp.status}")
            except Exception as db_err:
                print(f"[PC SERVER WARN] Could not auto-save to DB: {db_err}")

            notify_subscribers("medicine_detected", detection_payload)

        # Remove from incoming queue once scanned
        with queue_lock:
            incoming_queue = [x for x in incoming_queue if x["filename"] != os.path.basename(target_path)]

        notify_subscribers("incoming_queue_updated", list(incoming_queue))
        return jsonify({
            "success": True,
            "detection": detection_payload,
            "remaining_queue": list(incoming_queue)
        })

    except Exception as e:
        print(f"[PC SERVER ERROR] Scan failed: {e}")
        return jsonify({"error": str(e)}), 500


# ---------- Skip / Discard Frame endpoint ----------
@app.route("/skip_frame", methods=["POST"])
def skip_frame():
    global incoming_queue
    req_json = request.get_json(silent=True) or {}
    filename = req_json.get("filename")

    if not filename:
        with queue_lock:
            if incoming_queue:
                filename = incoming_queue[0]["filename"]

    if filename:
        target_path = os.path.join(SAVE_DIR, os.path.basename(filename))
        if os.path.exists(target_path) and os.path.basename(target_path) != "latest.jpg":
            try:
                os.remove(target_path)
            except OSError:
                pass

        with queue_lock:
            incoming_queue = [x for x in incoming_queue if x["filename"] != os.path.basename(filename)]

        notify_subscribers("incoming_queue_updated", list(incoming_queue))
        return jsonify({"success": True, "remaining_queue": list(incoming_queue)})

    return jsonify({"success": True, "remaining_queue": []})


# ---------- Clear entire queue endpoint ----------
@app.route("/clear_queue", methods=["POST"])
def clear_queue():
    global incoming_queue
    with queue_lock:
        for item in incoming_queue:
            p = os.path.join(SAVE_DIR, item["filename"])
            if os.path.exists(p) and item["filename"] != "latest.jpg":
                try: os.remove(p)
                except OSError: pass
        incoming_queue = []

    notify_subscribers("incoming_queue_updated", [])
    return jsonify({"success": True, "remaining_queue": []})


# ---------- Legacy /scan_now endpoint ----------
@app.route("/scan_now", methods=["POST", "GET"])
def scan_now():
    return scan_frame()


# ---------- Query latest detection ----------
@app.route("/latest_detection", methods=["GET"])
def get_latest_detection():
    if latest_detection:
        return jsonify({"success": True, "detection": latest_detection})
    return jsonify({"success": True, "detection": None, "message": "No medicine detected yet"})


# ---------- Query detection history ----------
@app.route("/detections", methods=["GET"])
def get_detections():
    with history_lock:
        return jsonify({"success": True, "detections": list(detection_history)})


# ---------- Server health & status endpoint ----------
@app.route("/status", methods=["GET"])
def status():
    with queue_lock:
        q_len = len(incoming_queue)
    return jsonify({
        "status": "online",
        "has_frame": latest_frame is not None,
        "queue_size": q_len,
        "latest_detection": latest_detection,
        "timestamp": int(time.time() * 1000)
    })


# ---------- Server-Sent Events (SSE) Real-Time Stream to Frontend ----------
@app.route("/detection_stream")
def detection_stream():
    def event_stream():
        client_q = queue.Queue(maxsize=50)
        with subscribers_lock:
            sse_subscribers.append(client_q)
        
        # Send initial connected message
        yield f"event: connected\ndata: {json.dumps({'status': 'connected', 'time': int(time.time() * 1000)})}\n\n"
        
        try:
            while True:
                try:
                    msg = client_q.get(timeout=20.0)
                    yield msg
                except queue.Empty:
                    # Keep-alive ping
                    yield ": ping\n\n"
        except GeneratorExit:
            with subscribers_lock:
                if client_q in sse_subscribers:
                    sse_subscribers.remove(client_q)

    return Response(event_stream(), mimetype="text/event-stream")


# ---------- Clear detection ----------
@app.route("/clear_detection", methods=["POST"])
def clear_detection():
    global latest_detection
    latest_detection = None
    return jsonify({"success": True, "message": "Latest detection cleared"})


# ---------- Web Dashboard page for direct testing ----------
@app.route("/")
def dashboard():
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>TrackCare IoT Medicine Scanner & PC Server</title>
        <style>
            body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; }
            .container { max-width: 900px; margin: 0 auto; text-align: center; }
            h1 { color: #38bdf8; margin-bottom: 5px; }
            p { color: #94a3b8; }
            .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 20px; border: 1px solid #334155; }
            img { max-width: 100%; height: auto; border-radius: 8px; border: 2px solid #0284c7; }
            .btn { background: #0284c7; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; cursor: pointer; margin: 10px 5px; }
            .btn:hover { background: #0369a1; }
            .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold; background: #059669; color: white; }
            #detectionBox { margin-top: 15px; font-size: 16px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>TrackCare IoT Camera & AI Server</h1>
            <p>Live stream and AI medicine detection engine (Port 9000)</p>
            <div class="card">
                <span class="badge">LIVE MJPEG FEED</span>
                <br/><br/>
                <img src="/stream" alt="Live Camera Feed" />
                <br/><br/>
                <button class="btn" onclick="triggerScan()">Scan Current Frame (AI Pipeline 2)</button>
                <div id="detectionBox">Waiting for detection...</div>
            </div>
        </div>
        <script>
            const evtSource = new EventSource('/detection_stream');
            evtSource.addEventListener('medicine_detected', function(e) {
                const data = JSON.parse(e.data);
                document.getElementById('detectionBox').innerHTML = 
                    `<span style="color:#4ade80;">✔ Confirmed Medicine: ${data.drug_name} (${data.strength}) - Expiry: ${data.expiry_date} [${data.inventory_status}]</span>`;
            });
            function triggerScan() {
                document.getElementById('detectionBox').innerText = 'Scanning with AI Pipeline 2...';
                fetch('/scan_now', { method: 'POST' })
                    .then(r => r.json())
                    .then(data => {
                        if (data.is_medicine) {
                            document.getElementById('detectionBox').innerHTML = 
                                `<span style="color:#4ade80;">✔ Confirmed Medicine: ${data.drug_name} (${data.strength}) - Expiry: ${data.expiry_date} [${data.inventory_status}]</span>`;
                        } else {
                            document.getElementById('detectionBox').innerHTML = 
                                `<span style="color:#f87171;">✖ No medicine package identified</span>`;
                        }
                    })
                    .catch(err => {
                        document.getElementById('detectionBox').innerText = 'Error triggering scan: ' + err;
                    });
            }
        </script>
    </body>
    </html>
    """

if __name__ == "__main__":
    print(f"[PC SERVER] Server running on http://0.0.0.0:9000")
    print(f"[PC SERVER] Saving incoming images to: {SAVE_DIR}")
    print(f"[PC SERVER] Connected to AI Pipeline 2 with real-time SSE stream on /detection_stream")
    app.run(host="0.0.0.0", port=9000, debug=False, threaded=True)
