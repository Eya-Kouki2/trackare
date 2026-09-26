"""
pharmacy_scan.py
A thin CLI wrapper around PharmaceuticalScannerPipeline that:
  1. Receives an image path as argv[1]
  2. Runs the pipeline
  3. Prints a single JSON line to stdout (consumed by pharmacyRoutes.js)
"""
import sys
import json
import os

# ── Guard: require exactly one argument (the image path) ─────────
if len(sys.argv) < 2:
    print(json.dumps({"error": "Usage: pharmacy_scan.py <image_path>"}))
    sys.exit(1)

image_path = sys.argv[1]

if not os.path.exists(image_path):
    print(json.dumps({"error": f"Image not found: {image_path}"}))
    sys.exit(1)

# ── Silence the easyocr / torch loading chatter so stdout stays clean ──
import io, contextlib

try:
    # Add the ml/ directory to sys.path so ai_pipeline2 is importable
    sys.path.insert(0, os.path.dirname(__file__))
    from ai_pipeline2 import PharmaceuticalScannerPipeline

    # Redirect stdout so pipeline print() calls don't pollute JSON output
    pipeline = PharmaceuticalScannerPipeline()

    with contextlib.redirect_stdout(io.StringIO()):
        result = pipeline.process_inventory_scan(image_path)

    print(json.dumps({
        "is_medicine":      result.get("is_medicine", False),
        "drug_name":        result.get("drug_name", "UNKNOWN"),
        "strength":         result.get("strength", "N/A"),
        "expiry_date":      result.get("expiry_date", "UNKNOWN"),
        "inventory_status": result.get("inventory_status", "UNKNOWN"),
        "confidence":       result.get("confidence", "HIGH"),
        "verification":     result.get("verification", {})
    }))

except Exception as exc:
    print(json.dumps({"error": str(exc)}))
    sys.exit(1)
