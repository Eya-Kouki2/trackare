import cv2
import re
import os
from datetime import datetime
import easyocr

class PharmaceuticalScannerPipeline:
    def __init__(self):
        """Initializes metadata, date dictionaries, and sets up on-demand OCR engine."""
        self._ocr_reader = None

    @property
    def ocr_reader(self):
        """Loads EasyOCR on-demand when a scan is requested, saving RAM on server boot."""
        if self._ocr_reader is None:
            print("[AI PIPELINE 2] Loading Local OCR Text Recognition Engine on-demand...")
            self._ocr_reader = easyocr.Reader(['en'], gpu=False, verbose=False)
            print("[AI PIPELINE 2] Local OCR Engine loaded successfully.")
        return self._ocr_reader

        # --- Bilingual (EN/FR) month name map for alpha-style dates
        self.month_map = {
            "JANV": 1, "JAN": 1, "JANVIER": 1,
            "FEVR": 2, "FEV": 2, "FEB": 2, "FEVRIER": 2, "FEBRUARY": 2,
            "MARS": 3, "MAR": 3, "MARCH": 3,
            "AVRIL": 4, "AVR": 4, "APR": 4, "APRIL": 4,
            "MAI": 5, "MAY": 5,
            "JUIN": 6, "JUN": 6, "JUNE": 6,
            "JUILLET": 7, "JUIL": 7, "JUL": 7, "JULY": 7,
            "AOUT": 8, "AUG": 8, "AUGUST": 8,
            "SEPT": 9, "SEP": 9, "SEPTEMBER": 9,
            "OCTOBRE": 10, "OCT": 10, "OCTOBER": 10,
            "NOVEMBRE": 11, "NOV": 11, "NOVEMBER": 11,
            "DECEMBRE": 12, "DEC": 12, "DECEMBER": 12,
        }
        sorted_month_keys = sorted(self.month_map.keys(), key=len, reverse=True)
        self._months_alternation = "|".join(sorted_month_keys)

        # Keyword lists used to distinguish expiry from manufacture dates
        self.expiry_keywords = [
            "EXP", "EXPIRY", "EXPIRES", "EXPIRATION", "USE BY", "BEST BEFORE",
            "BBE", "BBD", "PEREMPTION", "DATE LIMITE", "DLU", "DLC",
            "VALIDITE", "A CONSOMMER", "UAV", "U.A.V", "UTILISER AVANT"
        ]
        self.manufacture_keywords = [
            "MFG", "MFD", "MANUFACTURED", "MANUFACTURING", "FAB", "FABRICATION",
            "FABRIQUE", "PROD", "PRODUCTION", "MADE ON", "DATE DE FABRICATION"
        ]

        # Pharmaceutical domain keywords for medicine verification
        self.pharma_indicator_keywords = [
            "TABLET", "TABLETS", "CAPSULE", "CAPSULES", "GELULE", "GELULES",
            "COMPRIME", "COMPRIMES", "SIROP", "SYRUP", "SOLUTION", "INJECTION",
            "CREME", "POMMADE", "SACHET", "SACHETS", "SUSPENSION", "POUDRE",
            "MG", "MCG", "ML", "IU", "G/L", "MG/ML", "LABORATOIRE", "LABORATOIRES",
            "PHARMA", "PHARMACEUTICAL", "PHARMACEUTIQUE", "MEDICAMENT", "MEDICINE",
            "VOIE", "ORALE", "INJECTABLE", "POSOLOGIE", "DOSAGE", "LOT", "BATCH",
            "EXP", "FAB", "UAV", "PARACETAMOL", "IBUPROFEN", "AMOXICILLIN", "ANTIBIOTIC",
            "ASPIRIN", "DOLIPRANE", "AUGMENTIN", "EFFERALGAN", "PANADOL", "CLAMID",
            "ANTAFEN", "VOLTARENE", "SPASFON", "VENTOLINE", "AERIUS", "DAFALGAN"
        ]

    def extract_layout_metadata(self, image_path, rotation_info=(90, 180, 270)):
        """
        Scans the visual surface area of an image to isolate textual strings
        and their matching spatial layout coordinates.
        """
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Target scan image not found at: {image_path}")

        print("\n--- STAGE 1: Executing On-Device Deep Pixels Spatial Scan ---")
        spatial_ocr_results = self.ocr_reader.readtext(
            image_path, detail=1, rotation_info=list(rotation_info)
        )
        return spatial_ocr_results

    def _rotate_image_to_temp(self, image_path, angle):
        """Rotates image by angle degrees as a fallback if no date is found."""
        image = cv2.imread(image_path)
        if image is None:
            return None

        if angle == 90:
            rotated = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
        elif angle == 180:
            rotated = cv2.rotate(image, cv2.ROTATE_180)
        elif angle == 270:
            rotated = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        else:
            return None

        base, ext = os.path.splitext(image_path)
        temp_path = f"{base}__rot{angle}{ext}"
        cv2.imwrite(temp_path, rotated)
        return temp_path

    def resolve_drug_identity(self, spatial_ocr_results):
        """
        Applies a geometric area weight score matrix to isolate the dominant brand name,
        filtering out common structural packaging terminology noise.
        """
        highest_geometric_score = 0.0
        isolated_brand_name = "GENERIC / UNKNOWN"
        
        packaging_text_noise = [
            "EXP", "EXPIRY", "BATCH", "LOT", "TABLETS", "CAPSULES", "MG", "FOR", 
            "UNIQUEMENT", "TABLEAU", "SUR", "ORDONNANCO", "MEDICAL", "PRESCRIPTION",
            "ONLY", "VIGNETTE", "FAB", "SFAB", "UAV", "U.A.V", "BOITE", "NOTICE"
        ]

        print("\n--- STAGE 2: Computing Geometric Token Area Coefficients ---")
        for bounding_box, raw_text, reading_confidence in spatial_ocr_results:
            processed_token = raw_text.strip().upper().replace(";", "").replace(":", "")
            
            # Strip away dosage measurements if in same token
            processed_token = re.sub(r'\d+\s*MG.*', '', processed_token).strip()
            
            # Skip invalid processing fragments, pure numeric code strings, or loose dates
            if re.search(r'^\d+$', processed_token) or '/' in processed_token or '-' in processed_token or processed_token == "":
                continue
            if any(noise_word in processed_token for noise_word in packaging_text_noise) or len(processed_token) < 4:
                continue

            # Calculate pixel height and width of bounding polygon
            x_coordinates = [vertex[0] for vertex in bounding_box]
            y_coordinates = [vertex[1] for vertex in bounding_box]
            
            token_width = max(x_coordinates) - min(x_coordinates)
            token_height = max(y_coordinates) - min(y_coordinates)
            visual_surface_area = token_width * token_height
            
            composite_geometric_score = visual_surface_area * reading_confidence
            print(f" -> Candidate: '{processed_token:<15}' | Width: {token_width}px | Height: {token_height}px | Composite Score: {composite_geometric_score:.1f}")

            if composite_geometric_score > highest_geometric_score:
                highest_geometric_score = composite_geometric_score
                isolated_brand_name = processed_token

        # Strip trailing OCR garbage characters (quotes, punctuation artifacts)
        isolated_brand_name = re.sub(r'[^A-Z0-9\s\-]+$', '', isolated_brand_name).strip()
        isolated_brand_name = re.sub(r'^[^A-Z0-9]+', '', isolated_brand_name).strip()

        return isolated_brand_name, highest_geometric_score

    def _collect_numeric_dates(self, flat_text_stream, current_calendar_year):
        candidates = []
        claimed_spans = []

        def span_is_free(start, end):
            return all(end <= s or start >= e for s, e in claimed_spans)

        sep = r'[\/\.\-]'

        # Full 3-part numeric dates
        full_pattern = re.compile(rf'(\d{{1,4}}){sep}(\d{{1,2}}){sep}(\d{{1,4}})')
        for m in full_pattern.finditer(flat_text_stream):
            if not span_is_free(m.start(), m.end()):
                continue
            a, b, c = m.group(1), m.group(2), m.group(3)
            try:
                if len(a) == 4:
                    year_value, month_value, day_value = int(a), int(b), int(c)
                elif len(c) == 4 or len(c) == 2 or len(c) == 3:
                    day_value, month_value = int(a), int(b)
                    if len(c) == 4:
                        year_value = int(c)
                    elif len(c) == 3:
                        year_value = int("2" + c)
                    else:
                        year_value = int("20" + c)
                else:
                    continue

                if not (1 <= month_value <= 12):
                    continue
                if not (1 <= day_value <= 31):
                    continue
                if not (current_calendar_year - 10 <= year_value <= current_calendar_year + 15):
                    continue

                candidates.append((m.start(), m.end(), datetime(year_value, month_value, day_value)))
                claimed_spans.append((m.start(), m.end()))
            except ValueError:
                continue

        # Month/Year numeric dates
        my_pattern = re.compile(rf'(\d{{1,2}}){sep}(\d{{2,4}})|(\d{{2,4}}){sep}(\d{{1,2}})')
        for m in my_pattern.finditer(flat_text_stream):
            if not span_is_free(m.start(), m.end()):
                continue
            try:
                if m.group(1) and m.group(2):
                    first_num, second_num = m.group(1), m.group(2)
                    month_value = int(first_num)
                    year_raw = second_num
                else:
                    first_num, second_num = m.group(3), m.group(4)
                    if len(first_num) >= len(second_num):
                        year_raw = first_num
                        month_value = int(second_num)
                    else:
                        month_value = int(first_num)
                        year_raw = second_num

                if len(year_raw) == 4:
                    year_value = int(year_raw)
                elif len(year_raw) == 3:
                    year_value = int("2" + year_raw)
                else:
                    year_value = int("20" + year_raw)

                if not (1 <= month_value <= 12):
                    continue
                if not (current_calendar_year - 10 <= year_value <= current_calendar_year + 15):
                    continue

                candidates.append((m.start(), m.end(), datetime(year_value, month_value, 1)))
                claimed_spans.append((m.start(), m.end()))
            except ValueError:
                continue

        return candidates

    def _collect_alpha_dates(self, flat_text_stream, current_calendar_year):
        candidates = []

        # DD? MONTH YYYY
        pattern_a = re.compile(
            rf'(?:(\d{{1,2}})\s*[\/\.\-\s]*\s*)?({self._months_alternation})\.?\s*[\/\.\-\s,]*\s*(\d{{2,4}})'
        )
        for m in pattern_a.finditer(flat_text_stream):
            day_str, month_name, year_str = m.group(1), m.group(2), m.group(3)
            month_value = self.month_map.get(month_name)
            if not month_value:
                continue
            try:
                year_value = int(year_str) if len(year_str) == 4 else int("20" + year_str)
                if not (current_calendar_year - 10 <= year_value <= current_calendar_year + 15):
                    continue
                day_value = 1
                if day_str:
                    candidate_day = int(day_str)
                    if 1 <= candidate_day <= 31:
                        day_value = candidate_day
                candidates.append((m.start(), m.end(), datetime(year_value, month_value, day_value)))
            except ValueError:
                continue

        # YYYY MONTH
        pattern_b = re.compile(rf'(\d{{4}})\s*[\/\.\-\s]*\s*({self._months_alternation})')
        for m in pattern_b.finditer(flat_text_stream):
            year_str, month_name = m.group(1), m.group(2)
            month_value = self.month_map.get(month_name)
            if not month_value:
                continue
            try:
                year_value = int(year_str)
                if not (current_calendar_year - 10 <= year_value <= current_calendar_year + 15):
                    continue
                candidates.append((m.start(), m.end(), datetime(year_value, month_value, 1)))
            except ValueError:
                continue

        return candidates

    def _parse_digit_blob_as_month_year(self, blob, current_calendar_year):
        interpretations = []
        length = len(blob)
        if length == 6:
            interpretations.append((blob[:2], blob[2:]))
        elif length == 7:
            for drop_idx in (2, 1, 3):
                candidate = blob[:drop_idx] + blob[drop_idx + 1:]
                if len(candidate) == 6:
                    interpretations.append((candidate[:2], candidate[2:]))

        for month_str, year_str in interpretations:
            try:
                month_value = int(month_str)
                year_value = int(year_str)
                if 1 <= month_value <= 12 and (current_calendar_year - 10 <= year_value <= current_calendar_year + 15):
                    return datetime(year_value, month_value, 1)
            except ValueError:
                continue
        return None

    def _collect_ocr_artifact_dates(self, flat_text_stream, current_calendar_year):
        candidates = []
        for kw in self.expiry_keywords + self.manufacture_keywords:
            pattern = re.compile(rf'{re.escape(kw)}\s*:?\s*(\d{{6,7}})(?!\d)')
            for m in pattern.finditer(flat_text_stream):
                blob = m.group(1)
                parsed = self._parse_digit_blob_as_month_year(blob, current_calendar_year)
                if parsed:
                    candidates.append((m.start(1), m.end(1), parsed))
        return candidates

    def _find_keyword_spans(self, flat_text_stream, keywords):
        spans = []
        for kw in keywords:
            for m in re.finditer(re.escape(kw), flat_text_stream):
                spans.append((m.start(), m.end()))
        return spans

    def resolve_chronological_metrics(self, flat_text_stream):
        flat_text_stream = flat_text_stream.upper()
        current_calendar_year = datetime.now().year

        extracted_strength = "N/A"
        extracted_expiry_string = "UNKNOWN"
        detection_method = "NONE"

        # 1. First check for dual/combination dosage (e.g. "500 MG / 62.5 MG" or "1 G / 125 MG" or "250 MG / 5 ML")
        combo_match = re.search(
            r'(\d+(?:[.,]\d+)?\s*(?:G|MG|MCG))\s*[/]\s*(\d+(?:[.,]\d+)?\s*(?:MG|MCG|ML|G))',
            flat_text_stream
        )
        if combo_match:
            first_part = re.sub(r'(\d+(?:[.,]\d+)?)\s*(G|MG|MCG)', r'\1 \2', combo_match.group(1).strip())
            second_part = re.sub(r'(\d+(?:[.,]\d+)?)\s*(MG|MCG|ML|G)', r'\1 \2', combo_match.group(2).strip())
            extracted_strength = f"{first_part} / {second_part}"
        else:
            # 2. Extract single dosages (compare in MG equivalents)
            dosage_candidates = []
            
            # G matches (1 G = 1000 MG)
            for m in re.finditer(r'(\d+(?:[.,]\d+)?)\s*G(?!\w)', flat_text_stream):
                try:
                    val = float(m.group(1).replace(',', '.'))
                    dosage_candidates.append((val * 1000, f"{val:g} G"))
                except ValueError:
                    pass

            # MG matches
            for m in re.finditer(r'(\d+(?:[.,]\d+)?)\s*MG(?!\w)', flat_text_stream):
                try:
                    val = float(m.group(1).replace(',', '.'))
                    # Ignore tiny auxiliary numbers (e.g. 1 mg if 500 mg exists)
                    dosage_candidates.append((val, f"{m.group(1)} MG"))
                except ValueError:
                    pass

            # Other units: ML, MCG, IU
            for m in re.finditer(r'(\d+(?:[.,]\d+)?)\s*(ML|MCG|IU)(?!\w)', flat_text_stream):
                try:
                    val = float(m.group(1).replace(',', '.'))
                    dosage_candidates.append((val, f"{m.group(1)} {m.group(2)}"))
                except ValueError:
                    pass

            if dosage_candidates:
                # Pick the largest equivalent dosage (primary active ingredient)
                best_candidate = max(dosage_candidates, key=lambda x: x[0])
                extracted_strength = best_candidate[1].replace('  ', ' ').strip()

        print("\n--- STAGE 3: Executing Multi-Format Timeline Chronological Sorting ---")

        numeric_candidates = self._collect_numeric_dates(flat_text_stream, current_calendar_year)
        alpha_candidates = self._collect_alpha_dates(flat_text_stream, current_calendar_year)
        artifact_candidates = self._collect_ocr_artifact_dates(flat_text_stream, current_calendar_year)
        all_candidates = numeric_candidates + alpha_candidates + artifact_candidates

        if not all_candidates:
            print(" -> [WARN] No structural date tokens resolved inside image layout footprint.")
            return extracted_strength, extracted_expiry_string, "REJECTED (INVALID/NO DATE)"

        seen = set()
        unique_candidates = []
        for start, end, dt in all_candidates:
            key = (dt.year, dt.month, dt.day)
            if key not in seen:
                seen.add(key)
                unique_candidates.append((start, end, dt))
        unique_candidates.sort(key=lambda c: c[2])

        print(f" -> System discovered {len(unique_candidates)} timeline checkpoints:")
        for _, _, dt in unique_candidates:
            print(f"      * Identified Date Node: {dt.strftime('%m/%Y')}")

        PROXIMITY_WINDOW = 25
        expiry_kw_spans = self._find_keyword_spans(flat_text_stream, self.expiry_keywords)
        mfg_kw_spans = self._find_keyword_spans(flat_text_stream, self.manufacture_keywords)

        best_expiry_candidate = None
        best_expiry_score = None
        BACKWARD_PENALTY = 1000

        for start, end, dt in unique_candidates:
            for kw_start, kw_end in expiry_kw_spans:
                forward_gap = start - kw_end
                backward_gap = kw_start - end
                if 0 <= forward_gap <= PROXIMITY_WINDOW:
                    score = forward_gap
                elif 0 <= backward_gap <= PROXIMITY_WINDOW:
                    score = backward_gap + BACKWARD_PENALTY
                else:
                    continue
                if best_expiry_score is None or score < best_expiry_score:
                    best_expiry_score = score
                    best_expiry_candidate = dt

        if best_expiry_candidate is not None:
            target_expiry_date = best_expiry_candidate
            detection_method = "KEYWORD_ANCHORED"
        elif len(unique_candidates) == 1 and not mfg_kw_spans:
            target_expiry_date = unique_candidates[0][2]
            detection_method = "SINGLE_DATE_ASSUMED_EXPIRY"
        else:
            target_expiry_date = unique_candidates[-1][2]
            detection_method = "MAX_DATE_HEURISTIC"

        extracted_expiry_string = target_expiry_date.strftime("%m/%Y")

        if detection_method == "MAX_DATE_HEURISTIC" and len(unique_candidates) > 1:
            if target_expiry_date >= datetime.now():
                inventory_status = "MANUAL REVIEW REQUIRED (UNCONFIRMED EXPIRY, LIKELY VALID)"
            else:
                inventory_status = "MANUAL REVIEW REQUIRED (UNCONFIRMED EXPIRY, LIKELY EXPIRED)"
        else:
            if target_expiry_date >= datetime.now():
                inventory_status = "APPROVED (IN STOCK)"
            else:
                inventory_status = "REJECTED (EXPIRED)"

        print(f" -> Detection method: {detection_method}")
        return extracted_strength, extracted_expiry_string, inventory_status

    def verify_medicine_authenticity(self, drug_name, strength, expiry_date, inventory_status, flat_text_stream, brand_score):
        """
        STAGE 4: Verification Gate - Checks if the detected package is truly a medicine.
        Returns (is_medicine: bool, confidence: str, verification_details: dict)
        """
        print("\n--- STAGE 4: Verifying Pharmaceutical Authenticity ---")
        
        pharma_keyword_matches = []
        for kw in self.pharma_indicator_keywords:
            if re.search(rf'\b{re.escape(kw)}\b', flat_text_stream):
                pharma_keyword_matches.append(kw)

        has_known_drug_name = (drug_name != "GENERIC / UNKNOWN" and len(drug_name) >= 3)
        has_strength = (strength != "N/A")
        has_expiry = (expiry_date != "UNKNOWN")
        has_pharma_keywords = (len(pharma_keyword_matches) > 0)
        has_valid_status = not ("INVALID" in inventory_status or "NO DATE" in inventory_status)

        # Verification Score calculation
        score = 0
        if has_known_drug_name: score += 3
        if has_strength: score += 2
        if has_expiry: score += 2
        if has_pharma_keywords: score += min(len(pharma_keyword_matches), 3)
        if brand_score > 500: score += 1

        # A confirmed medicine must satisfy key criteria:
        # Either (valid brand name + (strength or expiry or pharma keyword)) OR (strength + expiry + pharma keyword)
        is_medicine = False
        confidence = "LOW"

        if (has_known_drug_name and (has_strength or has_expiry or has_pharma_keywords)) or (has_strength and has_expiry):
            is_medicine = True
            if score >= 6:
                confidence = "HIGH"
            elif score >= 4:
                confidence = "MEDIUM"
            else:
                confidence = "ACCEPTABLE"
        elif has_known_drug_name and brand_score > 1000:
            is_medicine = True
            confidence = "MEDIUM"
        else:
            is_medicine = False
            confidence = "REJECTED"

        verification_details = {
            "is_medicine": is_medicine,
            "confidence": confidence,
            "score": score,
            "has_known_drug_name": has_known_drug_name,
            "has_strength": has_strength,
            "has_expiry": has_expiry,
            "matched_keywords": pharma_keyword_matches[:8],
        }

        print(f" -> Verified as Medicine: {is_medicine} (Confidence: {confidence}, Score: {score}/10)")
        print(f" -> Matched Pharma Indicators: {pharma_keyword_matches[:8]}")
        return is_medicine, confidence, verification_details

    def process_inventory_scan(self, image_path):
        """The main execution orchestrator connecting layout, identity, date, and verification subsystems."""
        raw_spatial_results = self.extract_layout_metadata(image_path)
        
        text_token_list = [item[1].upper() for item in raw_spatial_results]
        flat_text_stream = " ".join(text_token_list)
        print(f"[RAW LOG STREAM] Clean Combined Tokens: \"{flat_text_stream}\"")

        final_drug_name, brand_score = self.resolve_drug_identity(raw_spatial_results)
        final_strength, final_expiry, final_status = self.resolve_chronological_metrics(flat_text_stream)

        # Fallback retry on rotated copies if no date found
        temp_rotated_paths = []
        if final_status == "REJECTED (INVALID/NO DATE)":
            print("\n--- STAGE 1b: Retrying on rotated image copies ---")
            for angle in (90, 180, 270):
                rotated_path = self._rotate_image_to_temp(image_path, angle)
                if not rotated_path:
                    continue
                temp_rotated_paths.append(rotated_path)
                try:
                    rotated_results = self.extract_layout_metadata(rotated_path)
                except Exception as exc:
                    print(f" -> [WARN] Rotated OCR pass at {angle} deg failed: {exc}")
                    continue

                rotated_tokens = [item[1].upper() for item in rotated_results]
                rotated_stream = " ".join(rotated_tokens)
                combined_stream = flat_text_stream + " " + rotated_stream
                retry_strength, retry_expiry, retry_status = self.resolve_chronological_metrics(combined_stream)

                if retry_status != "REJECTED (INVALID/NO DATE)":
                    final_strength, final_expiry, final_status = retry_strength, retry_expiry, retry_status
                    flat_text_stream = combined_stream
                    print(f" -> Recovered valid date from {angle}-deg rotated pass.")
                    break

            for temp_path in temp_rotated_paths:
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

        # Verify medicine authenticity
        is_medicine, confidence, details = self.verify_medicine_authenticity(
            final_drug_name, final_strength, final_expiry, final_status, flat_text_stream, brand_score
        )

        dashboard_payload = {
            "is_medicine": is_medicine,
            "drug_name": final_drug_name,
            "strength": final_strength,
            "expiry_date": final_expiry,
            "inventory_status": final_status,
            "confidence": confidence,
            "verification": details,
            "raw_text": flat_text_stream,
            "timestamp": datetime.now().isoformat()
        }

        print("\n================ AI PIPELINE 2 RESULT ================")
        print(f" IS MEDICINE      : {dashboard_payload['is_medicine']} ({dashboard_payload['confidence']})")
        print(f" DRUG NAME        : {dashboard_payload['drug_name']}")
        print(f" STRENGTH         : {dashboard_payload['strength']}")
        print(f" EXPIRY DATE      : {dashboard_payload['expiry_date']}")
        print(f" INVENTORY STATUS : {dashboard_payload['inventory_status']}")
        print("======================================================")
        return dashboard_payload


if __name__ == "__main__":
    pipeline = PharmaceuticalScannerPipeline()
    test_image = "uploads/scan_1783271289877.jpg"
    if os.path.exists(test_image):
        pipeline.process_inventory_scan(test_image)
    else:
        print(f"[TEST] Ready. Provide an image path to test.")
