import os
import sys
import glob
import json

# Ensure standard output uses UTF-8 without crashing on Windows cmd
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from ai_pipeline2 import PharmaceuticalScannerPipeline

def run_test_suite():
    print("=" * 70)
    print("[TEST SUITE] TRACKCARE AI PIPELINE 2 - BATCH MEDICINE FILTER TEST")
    print("Filtering images: only confirmed medicines are accepted and sent to front")
    print("=" * 70)

    pipeline = PharmaceuticalScannerPipeline()

    test_images = []

    # High quality medicine package samples
    images_dir = os.path.join(BASE_DIR, "uploads", "images")
    if os.path.exists(images_dir):
        test_images.extend(glob.glob(os.path.join(images_dir, "*.jpg")))
        test_images.extend(glob.glob(os.path.join(images_dir, "*.png")))

    # Root uploads scans
    uploads_dir = os.path.join(BASE_DIR, "uploads")
    test_images.extend(glob.glob(os.path.join(uploads_dir, "scan_*.jpg")))
    test_images.extend(glob.glob(os.path.join(uploads_dir, "scan_*.png")))

    # Sample a few frames from IoT captures (non-medicine / low-quality / blurry frames)
    med_dir = os.path.join(BASE_DIR, "uploads", "medicine")
    if os.path.exists(med_dir):
        all_med_frames = glob.glob(os.path.join(med_dir, "*.jpg"))
        if all_med_frames:
            test_images.append(os.path.join(med_dir, "received.jpg"))
            test_images.append(all_med_frames[0])
            test_images.append(all_med_frames[10])
            test_images.append(all_med_frames[-1])

    unique_images = []
    seen = set()
    for img in test_images:
        norm = os.path.normpath(img)
        if norm not in seen and os.path.exists(norm):
            seen.add(norm)
            unique_images.append(norm)

    print(f"\nDiscovered {len(unique_images)} test images to process.\n")

    confirmed_medicines = []
    rejected_non_medicines = []

    for idx, img_path in enumerate(unique_images, 1):
        filename = os.path.basename(img_path)
        print(f"\n[{idx}/{len(unique_images)}] Scanning: {filename}")
        print("-" * 50)

        try:
            result = pipeline.process_inventory_scan(img_path)
            is_med = result.get("is_medicine", False)

            summary = {
                "file": filename,
                "path": img_path,
                "is_medicine": is_med,
                "drug_name": result.get("drug_name"),
                "strength": result.get("strength"),
                "expiry_date": result.get("expiry_date"),
                "status": result.get("inventory_status"),
                "confidence": result.get("confidence"),
                "verification": result.get("verification", {})
            }

            if is_med:
                confirmed_medicines.append(summary)
                print(f"[ACCEPTED - MEDICINE CONFIRMED] -> Drug: {result.get('drug_name')} ({result.get('strength')}) | Expiry: {result.get('expiry_date')} | Confidence: {result.get('confidence')}")
            else:
                rejected_non_medicines.append(summary)
                print(f"[REJECTED - NOT A MEDICINE] -> Filtered out (Confidence: {result.get('confidence')})")

        except Exception as e:
            print(f"[ERROR] Error scanning {filename}: {e}")

    # Summary Report
    print("\n" + "=" * 70)
    print("BATCH SCANNING SUMMARY REPORT")
    print("=" * 70)
    print(f"Total Images Scanned   : {len(unique_images)}")
    print(f"Confirmed Medicines    : {len(confirmed_medicines)}")
    print(f"Filtered Non-Medicines : {len(rejected_non_medicines)}")

    print("\n[CONFIRMED MEDICINES TO SEND TO FRONTEND]")
    if confirmed_medicines:
        for m in confirmed_medicines:
            print(f" * Drug: {m['drug_name']:<18} | Strength: {m['strength']:<10} | Expiry: {m['expiry_date']:<8} | Status: {m['status']} | Confidence: {m['confidence']}")
    else:
        print("  None detected.")

    print("\n[FILTERED OUT - NON-MEDICINE FRAMES]")
    for r in rejected_non_medicines:
        print(f" * File: {r['file']:<35} | Detected Label: {r['drug_name']:<15} | Reason: Low pharma verification score")

    print("\n" + "=" * 70)

if __name__ == "__main__":
    run_test_suite()
