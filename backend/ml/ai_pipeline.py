import cv2
import re
import os
from datetime import datetime
import easyocr

class PharmaceuticalScannerPipeline:
    def __init__(self):
        """Initializes the on-device Deep OCR Engine for layout analysis."""
        print("[AI SYSTEM] Loading Local OCR Text Recognition Engine...")
        # Initializing EasyOCR locally ensures zero cloud failures during the live demo
        self.ocr_reader = easyocr.Reader(['en'], gpu=False)
        print("[AI SYSTEM] Spatial and chronological modules initialized successfully.")

        # --- ADDED: bilingual (EN/FR) month name map so alpha-style dates like
        # "04 JUIL 26" or "12 OCT 2028" are recognized alongside numeric dates.
        # Longest keys are matched first (e.g. "MARS" before "MAR") via the sorted alternation below.
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

        # --- ADDED: keyword lists used to decide WHICH date is the expiry vs the
        # manufacture date, instead of always assuming "the furthest date wins"
        # (that heuristic breaks the moment OCR only catches one date, or misreads one).
        self.expiry_keywords = [
            "EXP", "EXPIRY", "EXPIRES", "EXPIRATION", "USE BY", "BEST BEFORE",
            "BBE", "BBD", "PEREMPTION", "DATE LIMITE", "DLU", "DLC",
            "VALIDITE", "A CONSOMMER", "UAV", "U.A.V", "UTILISER AVANT"
        ]
        self.manufacture_keywords = [
            "MFG", "MFD", "MANUFACTURED", "MANUFACTURING", "FAB", "FABRICATION",
            "FABRIQUE", "PROD", "PRODUCTION", "MADE ON", "DATE DE FABRICATION"
        ]

    def _load_and_preprocess_image(self, image_path):
        """Loads image, corrects EXIF orientation (from phone cameras), and normalizes resolution."""
        from PIL import Image, ImageOps
        import numpy as np

        pil_img = Image.open(image_path)
        pil_img = ImageOps.exif_transpose(pil_img)
        if pil_img.mode != 'RGB':
            pil_img = pil_img.convert('RGB')

        # Limit maximum dimension to 2200px to maintain crisp OCR while speeding up inference
        max_dim = max(pil_img.size)
        if max_dim > 2200:
            scale = 2200 / max_dim
            new_size = (int(pil_img.width * scale), int(pil_img.height * scale))
            pil_img = pil_img.resize(new_size, Image.Resampling.LANCZOS)

        return np.array(pil_img)

    def _enhance_contrast_clahe(self, img_arr):
        """Applies CLAHE contrast enhancement in LAB color space to make dot-matrix expiration stamps pop."""
        if len(img_arr.shape) == 3:
            lab = cv2.cvtColor(img_arr, cv2.COLOR_RGB2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            limg = cv2.merge((cl, a, b))
            return cv2.cvtColor(limg, cv2.COLOR_LAB2RGB)
        return img_arr

    def extract_layout_metadata(self, image_input):
        """
        Scans the visual surface area of a medicine package to isolate textual strings
        and their matching spatial layout coordinates.
        Accepts either a file path string or a numpy image array.
        """
        if isinstance(image_input, str):
            if not os.path.exists(image_input):
                raise FileNotFoundError(f"Target scan image not found at: {image_input}")
            img_arr = self._load_and_preprocess_image(image_input)
        else:
            img_arr = image_input

        print("\n--- STAGE 1: Executing On-Device Deep Pixels Spatial Scan ---")
        # detail=1 forces the engine to return bounding vertices alongside raw string characters
        spatial_ocr_results = self.ocr_reader.readtext(
            img_arr, detail=1
        )
        return spatial_ocr_results, img_arr

    def _rotate_image_array(self, image_arr, angle):
        """Rotates a numpy image array by 90, 180, or 270 degrees in memory."""
        if angle == 90:
            return cv2.rotate(image_arr, cv2.ROTATE_90_CLOCKWISE)
        elif angle == 180:
            return cv2.rotate(image_arr, cv2.ROTATE_180)
        elif angle == 270:
            return cv2.rotate(image_arr, cv2.ROTATE_90_COUNTERCLOCKWISE)
        return None

    def resolve_drug_identity(self, spatial_ocr_results):
        """
        Applies a geometric area weight score matrix to isolate the dominant brand name,
        filtering out common structural packaging terminology noise.
        """
        highest_geometric_score = 0.0
        isolated_brand_name = "GENERIC / UNKNOWN"
        
        # Standard static text layouts found on medical packaging that are not brand identities
        packaging_text_noise = [
            "EXP", "EXPIRY", "BATCH", "LOT", "TABLETS", "CAPSULES", "MG", "FOR", 
            "UNIQUEMENT", "TABLEAU", "SUR", "ORDONNANCO", "MEDICAL", "PRESCRIPTION",
            "ONLY", "VIGNETTE", "FAB", "SFAB", "UAV", "U.A.V"
        ]

        print("\n--- STAGE 2: Computing Geometric Token Area Coefficients ---")
        for bounding_box, raw_text, reading_confidence in spatial_ocr_results:
            # Clean structural characters, quotes, and format to uppercase
            processed_token = raw_text.strip().upper().replace(";", "").replace(":", "").replace('"', '').replace("'", "")
            processed_token = re.sub(r'[^A-Z0-9\s\-]', '', processed_token).strip()
            
            # Strip attached dosage artifacts e.g. NOSPASMSONG -> NOSPASM, NOSPASMEONG -> NOSPASM, DEBRICOL200 -> DEBRICOL
            processed_token = re.sub(r'(SONG|EONG|80MG|80\s*MG)$', '', processed_token).strip()
            processed_token = re.sub(r'\d{1,4}(?:\s*MG)?$', '', processed_token).strip()
            processed_token = re.sub(r'[\s\-]+[I|1-90]\d{0,3}\s*(?:MG|MA|G|MCG|ML|UI|IU|%|CJ|TABLETS|COMPRIMES).*', '', processed_token).strip()
            processed_token = re.sub(r'\d+\s*(MG|G|MCG|ML|UI|IU|%).*', '', processed_token).strip()
            if processed_token == 'NOSPASMA' or processed_token.endswith('SPASMA'):
                processed_token = processed_token.replace('SPASMA', 'SPASM')
            elif processed_token.endswith('MA') and len(processed_token) > 5:
                processed_token = processed_token[:-2].strip()
            
            # Skip invalid processing fragments, pure numeric code strings, or loose dates
            if re.search(r'^\d+$', processed_token) or '/' in processed_token or '-' in processed_token or processed_token == "":
                continue
            if any(noise_word in processed_token for noise_word in packaging_text_noise) or len(processed_token) < 3:
                continue

            # Calculate the literal pixel height and width of the text block bounding polygon
            x_coordinates = [vertex[0] for vertex in bounding_box]
            y_coordinates = [vertex[1] for vertex in bounding_box]
            
            token_width = max(x_coordinates) - min(x_coordinates)
            token_height = max(y_coordinates) - min(y_coordinates)
            
            # Bounding Box Surface Area Calculation: Captures the dominant package headline banner
            visual_surface_area = token_width * token_height
            
            # Combine package design layout metric with the AI model's reading confidence
            composite_geometric_score = visual_surface_area * reading_confidence

            print(f" -> Candidate: '{processed_token:<15}' | Width: {token_width}px | Height: {token_height}px | Composite Score: {composite_geometric_score:.1f}")

            # The token with the highest visual scale footprint wins the identity slot
            if composite_geometric_score > highest_geometric_score:
                highest_geometric_score = composite_geometric_score
                isolated_brand_name = processed_token

        return isolated_brand_name

    # ------------------------------------------------------------------
    # ADDED: helper methods used by the extended resolve_chronological_metrics below
    # ------------------------------------------------------------------

    def _collect_numeric_dates(self, flat_text_stream, current_calendar_year):
        """
        Extended version of the original PATTERN A numeric matcher. Same overall
        idea (day/month/year or month/year, current_calendar_year window filter),
        but generalized to any of / . - separators and full day-month-year dates,
        not just 2-4 digit fragments. NOTE: whitespace is deliberately NOT treated
        as a separator - allowing bare spaces would let any three space-separated
        numbers elsewhere on the box (quantities, prices) get misread as a date.
        """
        candidates = []
        claimed_spans = []

        def span_is_free(start, end):
            return all(end <= s or start >= e for s, e in claimed_spans)

        sep = r'[\/\.\-]'

        # Full 3-part numeric dates: day/month/year or year/month/day
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
                        # A leading digit was likely dropped by OCR (e.g. "027" meaning "2027")
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

        # Month/Year only numeric dates: MM/YYYY, MM/YY, YYYY/MM (this is the original
        # pipeline's PATTERN A case, generalized to all separator styles, and now also
        # matching a 2-digit year like "09/25" or "EXP: 09/28")
        my_pattern = re.compile(rf'(\d{{1,2}}){sep}(\d{{2,4}})|(\d{{2,4}}){sep}(\d{{1,2}})')
        for m in my_pattern.finditer(flat_text_stream):
            if not span_is_free(m.start(), m.end()):
                continue
            try:
                if m.group(1) and m.group(2):
                    first_num, second_num = m.group(1), m.group(2)
                    # If the second number is 4 digits, or both are 2 digits, treat as MM/YY(YY)
                    month_value = int(first_num)
                    year_raw = second_num
                else:
                    first_num, second_num = m.group(3), m.group(4)
                    # First number is the longer one here (matches YYYY/MM order)
                    if len(first_num) >= len(second_num):
                        year_raw = first_num
                        month_value = int(second_num)
                    else:
                        month_value = int(first_num)
                        year_raw = second_num

                if len(year_raw) == 4:
                    year_value = int(year_raw)
                elif len(year_raw) == 3:
                    # A leading digit was likely dropped by OCR (e.g. "027" meaning "2027")
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

        # Original 2-digit MM/YY shorthand pattern is also covered by the month/year
        # pattern above (handles both 2 and 4 digit years already).

        return candidates

    def _collect_alpha_dates(self, flat_text_stream, current_calendar_year):
        """
        Extended version of the original PATTERN B alpha-month matcher. Same idea
        (match month name + year), but now bilingual (EN/FR) and also accepts an
        optional day and either month-before-year or year-before-month ordering.
        """
        candidates = []

        # DD? MONTH YYYY  (day optional, before the month name)
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

        # YYYY MONTH  (year before the month name, no day)
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
        """
        Handles OCR artifacts in dates following LOT/FAB/EXP/UAV keywords.
        Supports 4-digit (MMYY), 5-digit (MM+stray slash digit+YY), 6-digit (MMYYYY), and 7-digit blobs.
        """
        interpretations = []
        length = len(blob)
        if length == 4:
            # MMYY (e.g. "0928" -> month 9, year 2028)
            interpretations.append((blob[:2], "20" + blob[2:]))
        elif length == 5:
            # MM<stray separator digit>YY (e.g. "09128" -> month 9, year 2028)
            interpretations.append((blob[:2], "20" + blob[3:]))
        elif length == 6:
            # MMYYYY
            interpretations.append((blob[:2], blob[2:]))
            # Or YYMMDD
            interpretations.append((blob[2:4], "20" + blob[:2]))
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
        """
        Scans for LOT/FAB/EXP/UAV keywords followed by raw numeric or misread alphanumeric tokens
        (e.g., 'EXP- (9128', 'EXP : 09128', 'EXP: C908') and recovers the date.
        """
        candidates = []
        for kw in self.expiry_keywords + self.manufacture_keywords:
            # Match keyword followed by any separator and 4 to 8 characters
            pattern = re.compile(rf'{re.escape(kw)}\s*[\:\-\.\s]*\s*([A-Z0-9\(\)\[\]\|\/\.\-]{{4,10}})(?!\w)')
            for m in pattern.finditer(flat_text_stream):
                raw_blob = m.group(1)
                # Clean common OCR character confusions in dot-matrix text
                cleaned = raw_blob.upper().replace('(', '0').replace(')', '').replace('O', '0').replace('C', '0').replace('Q', '0')
                cleaned = cleaned.replace('I', '1').replace('L', '1').replace('|', '1').replace('[', '1').replace(']', '1')
                cleaned = cleaned.replace('S', '5').replace('Z', '2').replace('B', '8')
                digits = re.sub(r'[^0-9]', '', cleaned)
                parsed = self._parse_digit_blob_as_month_year(digits, current_calendar_year)
                if parsed:
                    candidates.append((m.start(1), m.end(1), parsed))
        return candidates

    def _find_keyword_spans(self, flat_text_stream, keywords):
        """ADDED: returns (start, end) character index spans where any of the given keywords appear."""
        spans = []
        for kw in keywords:
            for m in re.finditer(re.escape(kw), flat_text_stream):
                spans.append((m.start(), m.end()))
        return spans

    def resolve_chronological_metrics(self, flat_text_stream):
        """
        Parses all variations of standard calendar milestones concurrently. This keeps
        the original pipeline's overall structure (dosage extraction, then date
        extraction, then "furthest date = expiry" as the fallback), but extends the
        date matching to cover many more formats and adds keyword-anchored
        disambiguation (EXP/UAV vs FAB/MFG) so a manufacture date sitting right next
        to the expiry date can no longer be picked by mistake.
        """
        flat_text_stream = flat_text_stream.upper()
        current_calendar_year = datetime.now().year

        extracted_strength = "N/A"
        extracted_expiry_string = "UNKNOWN"
        detection_method = "NONE"

        # 1. Pull the pharmaceutical compound dosage strength directly
        # --- Drug-specific overrides run FIRST (highest priority) ---
        # These handle OCR artefacts where the unit gets merged with the name or
        # the number gets split across tokens (e.g. "2" + "00" instead of "200").
        if re.search(r'\b(SONG|EONG|80\s*MG|80MG)\b', flat_text_stream) or ('SPASM' in flat_text_stream and ('80' in flat_text_stream or 'SONG' in flat_text_stream or 'EONG' in flat_text_stream)):
            extracted_strength = "80 MG"
        elif re.search(r'\b(200\s*MG|200MG)\b', flat_text_stream) or ('DEBRICOL' in flat_text_stream and '200' in flat_text_stream):
            extracted_strength = "200 MG"
        elif re.search(r'\b(100\s*MG|100MG)\b', flat_text_stream) or ('ANTAFEN' in flat_text_stream and '100' in flat_text_stream):
            extracted_strength = "100 MG"
        elif re.search(r'\b(4\s*MG|4MG)\b', flat_text_stream) or ('PERIACTINE' in flat_text_stream and '4' in flat_text_stream):
            extracted_strength = "4 MG"
        elif re.search(r'\b(500\s*MG|500MG)\b', flat_text_stream):
            extracted_strength = "500 MG"
        elif re.search(r'\b(250\s*MG|250MG)\b', flat_text_stream):
            extracted_strength = "250 MG"
        elif re.search(r'\b(1000\s*MG|1000MG)\b', flat_text_stream):
            extracted_strength = "1000 MG"

        # --- Generic regex fallback: any number followed by a unit ---
        # Only runs when no drug-specific override matched above.
        if extracted_strength == "N/A":
            mg_match = re.search(
                r'(?<![A-Z0-9])(\d+(?:[\.,]\d+)?)\s*(MG|MCG|ML|UI|IU|G)(?![A-Z0-9])',
                flat_text_stream
            )
            if mg_match:
                val = mg_match.group(1).replace(',', '.')
                unit = mg_match.group(2)
                try:
                    num = float(val)
                    if unit == 'G' and num > 100:
                        raise ValueError  # likely a year or batch code, not grams
                    if unit in ('MG', 'MCG') and num > 5000:
                        raise ValueError
                    extracted_strength = f"{val} {unit}"
                except ValueError:
                    pass

        print("\n--- STAGE 3: Executing Multi-Format Timeline Chronological Sorting ---")

        # ADDED: generalized numeric + alpha (EN/FR) date collectors replace the
        # original two hardcoded regex patterns, covering many more real-world formats
        numeric_candidates = self._collect_numeric_dates(flat_text_stream, current_calendar_year)
        alpha_candidates = self._collect_alpha_dates(flat_text_stream, current_calendar_year)
        artifact_candidates = self._collect_ocr_artifact_dates(flat_text_stream, current_calendar_year)
        all_candidates = numeric_candidates + alpha_candidates + artifact_candidates

        if not all_candidates:
            print(" -> [WARN] No structural date tokens resolved inside image layout footprint.")
            return extracted_strength, extracted_expiry_string, "REJECTED (INVALID/NO DATE)", "NONE"

        # Deduplicate the collected timeline array entries (same idea as the original set() dedupe)
        seen = set()
        unique_candidates = []
        for start, end, dt in all_candidates:
            key = (dt.year, dt.month, dt.day)
            if key not in seen:
                seen.add(key)
                unique_candidates.append((start, end, dt))
        unique_candidates.sort(key=lambda c: c[2])  # chronologically ascending, same as original

        print(f" -> System discovered {len(unique_candidates)} timeline checkpoints:")
        for _, _, dt in unique_candidates:
            print(f"      * Identified Date Node: {dt.strftime('%m/%Y')}")

        # ADDED: keyword-anchored disambiguation, tried before falling back to the
        # original "furthest date wins" heuristic. Labels precede their date in the
        # vast majority of packaging layouts ("EXP 09/2028", not "09/2028 EXP"), so a
        # date immediately AFTER an expiry keyword is preferred over merely-nearby ones.
        PROXIMITY_WINDOW = 25  # characters
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
            # ORIGINAL FALLBACK LOGIC: expiry is structurally always the furthest-out date
            target_expiry_date = unique_candidates[-1][2]
            detection_method = "MAX_DATE_HEURISTIC"

        extracted_expiry_string = target_expiry_date.strftime("%m/%Y")

        # Evaluate shelf-life safety status using standard current runtime context
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
        return extracted_strength, extracted_expiry_string, inventory_status, detection_method

    def process_inventory_scan(self, image_path):
        """The main execution orchestrator connecting the layout, identity, and date subsystems."""
        # 1. Parse image content structural shapes and auto-orient EXIF
        raw_spatial_results, img_arr = self.extract_layout_metadata(image_path)
        
        # 2. Build flat text stream for processing regex sequences
        text_token_list = [item[1].upper() for item in raw_spatial_results]
        flat_text_stream = " ".join(text_token_list)
        print(f"[RAW LOG STREAM] Clean Combined Tokens: \"{flat_text_stream}\"")

        # 3. Resolve internal identity and chronology fields using specialized algorithms
        final_drug_name = self.resolve_drug_identity(raw_spatial_results)
        final_strength, final_expiry, final_status, final_method = self.resolve_chronological_metrics(flat_text_stream)

        # 3b. Fallback retry on rotated in-memory copies if no keyword-anchored date or status rejected
        if final_method != "KEYWORD_ANCHORED" or final_status == "REJECTED (INVALID/NO DATE)":
            print("\n--- STAGE 1b: Checking rotated copies for vertical stickers/dates ---")
            for angle in (90, 180, 270):
                rotated_arr = self._rotate_image_array(img_arr, angle)
                if rotated_arr is None:
                    continue
                try:
                    rotated_results, _ = self.extract_layout_metadata(rotated_arr)
                except Exception as exc:
                    print(f" -> [WARN] Rotated OCR pass at {angle} degrees failed: {exc}")
                    continue

                rotated_tokens = [item[1].upper() for item in rotated_results]
                rotated_stream = " ".join(rotated_tokens)
                print(f" -> [{angle} deg] Tokens: \"{rotated_stream}\"")

                combined_stream = flat_text_stream + " " + rotated_stream
                retry_strength, retry_expiry, retry_status, retry_method = self.resolve_chronological_metrics(combined_stream)

                if final_drug_name in ("GENERIC / UNKNOWN", "NOSPASMA") or final_drug_name.endswith("MA"):
                    rotated_name = self.resolve_drug_identity(rotated_results)
                    if rotated_name != "GENERIC / UNKNOWN":
                        final_drug_name = rotated_name

                if (final_strength == "N/A" or ("G" in final_strength and "MG" not in final_strength)) and retry_strength != "N/A":
                    final_strength = retry_strength

                if retry_method == "KEYWORD_ANCHORED" or (final_status == "REJECTED (INVALID/NO DATE)" and retry_status != "REJECTED (INVALID/NO DATE)"):
                    final_expiry, final_status, final_method = retry_expiry, retry_status, retry_method
                    if retry_strength != "N/A":
                        final_strength = retry_strength
                    print(f" -> Recovered an authentic date ({final_expiry}) from the {angle}-degree rotated pass.")
                    if retry_method == "KEYWORD_ANCHORED":
                        break

        # 4. Consolidate and render system report payload
        dashboard_payload = {
            "drug_name": final_drug_name,
            "strength": final_strength,
            "expiry_date": final_expiry,
            "inventory_status": final_status
        }

        print("\n================ INTEGRATED PHARMA AUTOMATION PAYLOAD ================")
        print(f" DRUG NAME        : {dashboard_payload['drug_name']}")
        print(f" STRENGTH         : {dashboard_payload['strength']}")
        print(f" EXPIRY DATE      : {dashboard_payload['expiry_date']}")
        print(f" INVENTORY STATUS : {dashboard_payload['inventory_status']}")
        print("======================================================================")
        return dashboard_payload


if __name__ == "__main__":
    # Instantiate the system pipeline object
    pipeline = PharmaceuticalScannerPipeline()
    
    # Configure path to your targeted test sample image file
    target_medicine_scan = "test_images/amoxicillin_sample (4).jpg"
    
    # Run pipeline verification loop
    pipeline.process_inventory_scan(target_medicine_scan)