import re
import json
from bs4 import BeautifulSoup
from difflib import SequenceMatcher

def split_text_and_table(content):
    match = re.search(r"<table.*?</table>", content, re.DOTALL)
    if match:
        table_html = match.group(0)
        plain_text = content.replace(table_html, "").strip()
        return plain_text.strip().splitlines(), table_html
    else:
        return content.strip().splitlines(), None

def get_char_diffs_both(s1, s2):
    sm = SequenceMatcher(None, s1, s2)
    diffs_second_model = []
    diffs_first_model = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != 'equal':
            diffs_second_model.append((i1, i2))
            diffs_first_model.append((j1, j2))
    return diffs_second_model, diffs_first_model

def compare_plain_text(second_model_lines, first_model_lines, min_score_threshold=0.6):
    result = []
    used_first_model_indexes = set()
    second_model_matched = set()
    first_model_matched = set()

    for i, q_line in enumerate(second_model_lines):
        best_score = -1
        best_match_idx = -1
        for j, g_line in enumerate(first_model_lines):
            if j in used_first_model_indexes:
                continue
            score = SequenceMatcher(None, q_line, g_line).ratio()
            if score > best_score:
                best_score = score
                best_match_idx = j

        if best_score >= min_score_threshold:
            best_match = first_model_lines[best_match_idx]
            diffs_second_model, diffs_first_model = get_char_diffs_both(q_line, best_match)
            if diffs_second_model or diffs_first_model:
                result.append({
                    "type": "partial_match",
                    "second_model_index": i,
                    "first_model_index": best_match_idx,
                    "second_model_line": q_line,
                    "first_model_best_match": best_match,
                    "char_diffs_second_model": diffs_second_model,
                    "char_diffs_first_model": diffs_first_model
                })
            used_first_model_indexes.add(best_match_idx)
            second_model_matched.add(i)
            first_model_matched.add(best_match_idx)
        else:
            result.append({
                "type": "second_model_unmatched",
                "second_model_index": i,
                "second_model_line": q_line
            })

    for j, g_line in enumerate(first_model_lines):
        if j not in first_model_matched:
            result.append({
                "type": "first_model_unmatched",
                "first_model_index": j,
                "first_model_line": g_line
            })

    return result

def extract_table_cells(html):
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    rows = []
    for i, row in enumerate(table.find_all("tr")):
        row_data = []
        for j, cell in enumerate(row.find_all(["td", "th"])):
            row_data.append({
                "row": i,
                "col": j,
                "text": cell.get_text(strip=True),
                "rowspan": int(cell.get("rowspan", 1)),
                "colspan": int(cell.get("colspan", 1))
            })
        rows.append(row_data)
    return rows

def compare_tables(second_model_html, first_model_html):
    second_model_table = extract_table_cells(second_model_html)
    first_model_table = extract_table_cells(first_model_html)
    diffs = []
    for i in range(min(len(second_model_table), len(first_model_table))):
        for j in range(min(len(second_model_table[i]), len(first_model_table[i]))):
            q_cell = second_model_table[i][j]
            g_cell = first_model_table[i][j]
            diff_type = []
            if q_cell["text"] != g_cell["text"]:
                diff_type.append("text_diff")
            if q_cell["rowspan"] != g_cell["rowspan"] or q_cell["colspan"] != g_cell["colspan"]:
                diff_type.append("span_diff")
            if diff_type:
                diffs.append({
                    "row": i,
                    "col": j,
                    "second_model_cell": q_cell,
                    "first_model_cell": g_cell,
                    "diff_type": diff_type
                })

    return diffs

def compare_ocr_results(second_model_path, first_model_path, min_score_threshold=0.6):
    with open(second_model_path, 'r', encoding='utf-8') as f:
        second_model_content = f.read()
    with open(first_model_path, 'r', encoding='utf-8') as f:
        first_model_content = f.read()

    second_model_lines, second_model_table = split_text_and_table(second_model_content)
    first_model_lines, first_model_table = split_text_and_table(first_model_content)

    plain_diffs = compare_plain_text(second_model_lines, first_model_lines, min_score_threshold)

    table_diffs = []
    if second_model_table and first_model_table:
        table_diffs = compare_tables(second_model_table, first_model_table)

    return {
        "plain_text_diff": plain_diffs,
        "table_diff": table_diffs
    }

def compare_ocr_results_from_content(second_model_content, first_model_content, min_score_threshold=0.6):
    second_model_lines, second_model_table = split_text_and_table(second_model_content)
    first_model_lines, first_model_table = split_text_and_table(first_model_content)

    plain_diffs = compare_plain_text(second_model_lines, first_model_lines, min_score_threshold)

    table_diffs = []
    if second_model_table and first_model_table:
        table_diffs = compare_tables(second_model_table, first_model_table)

    return {
        "plain_text_diff": plain_diffs,
        "table_diff": table_diffs
    }

if __name__ == "__main__":
    result = compare_ocr_results("gemini2.0_sample/1.txt", "gemini2.5_sample/1.txt", min_score_threshold=0.6)
    with open("diff_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
