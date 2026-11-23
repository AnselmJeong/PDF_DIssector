"""Checks for the fields PDF Dissector adds to guide data (formula deep-dive, figx, biomedical elements).

Runs after the upstream check.run_checks and returns extra (errors, warns). Rules:
- formula: steps[] {part, x}, intuition, units, clinical are held to the number rule; illustrative is exempt
  (the page labels it as a made-up example) but must say so with at least one sentence.
- figx: cap must be a caption id; panel labels must occur in the caption; numbers must come from the caption,
  the citing paragraphs or table text. With approx: true, unsupported numbers are warnings, not errors.
"""
import re

from . import lgr  # noqa: F401  (sets sys.path)
from common import as_lang, fmt_num, numbers_in, source_numbers  # noqa: E402
import ko_rules  # noqa: E402

FORMULA_TEXT = ("intuition", "units", "clinical")
FIGX_TEXT = ("what", "axes", "takeaway", "caveat")
PANEL_RE = r"(?:^|[\s(\[,;.:])\(?{label}[).:,\s]"


def _nums(txt, lang):
    if lang == "ko":
        txt = ko_rules.normalize_numbers(txt)
    return numbers_in(txt)


def run(doc, guide):
    errors, warns = [], []
    meta = guide.get("meta") or {}
    langs = meta.get("notes_lang") or ["ko"]
    if isinstance(langs, str):
        langs = [langs]
    primary = langs[0]
    items = {i["id"]: i for i in doc.get("items", [])}
    order = [i["id"] for i in doc.get("items", [])]
    # text that may back a number: the paragraph, its neighbours, captions and table fragments after it
    def scope(eid):
        texts = []
        if eid in items:
            k = order.index(eid)
            texts.append(items[eid]["text"])
            for nid in items[eid].get("notes", []):
                if nid in items:
                    texts.append(items[nid]["text"])
            j = k + 1
            while j < len(order) and items[order[j]]["type"] in ("frag", "caption"):
                texts.append(items[order[j]]["text"])
                j += 1
            for d in (-1, 1):
                kk = k + d
                while 0 <= kk < len(order) and items[order[kk]]["type"] not in ("para",):
                    kk += d
                if 0 <= kk < len(order):
                    texts.append(items[order[kk]]["text"])
        return texts

    def check_nums(where, value, allowed, soft=False):
        for lang, txt in as_lang(value, primary).items():
            extra = sorted(x for x in _nums(txt, lang) if x not in allowed)
            if extra:
                msg = f"{where} ({lang}): numbers not in the source text: {', '.join(fmt_num(x) for x in extra)}"
                (warns if soft else errors).append(msg + (" (read off the graph: write 약/about)" if soft else ""))

    for eid, g in (guide.get("paras") or {}).items():
        if not isinstance(g, dict):
            continue
        texts = scope(eid)
        allowed = set().union(*map(source_numbers, texts)) if texts else set()
        for i, e in enumerate(g.get("els") or []):
            where = f"{eid} element {i + 1}"
            t = e.get("t")
            if t == "formula":
                steps = e.get("steps")
                if steps is not None:
                    if not isinstance(steps, list) or any(not isinstance(s, dict) or not s.get("part") or not s.get("x") for s in steps):
                        errors.append(f"{where}: steps must be a list of objects with 'part' (a LaTeX piece) and 'x' (its meaning)")
                    else:
                        for k, s in enumerate(steps):
                            check_nums(f"{where} step {k + 1}", s["x"], allowed)
                for f in FORMULA_TEXT:
                    if e.get(f) is not None:
                        check_nums(f"{where} {f}", e[f], allowed)
                ill = e.get("illustrative")
                if ill is not None and not any(v.strip() for v in as_lang(ill, primary).values()):
                    errors.append(f"{where}: illustrative is empty; write the worked example or drop the field")
            elif t == "figx":
                cap = e.get("cap")
                capt = items.get(cap)
                if not capt or capt.get("type") != "caption":
                    errors.append(f"{where} (figx): cap must name a caption id (C1, C2, ...); got {cap!r}")
                    cap_text = ""
                else:
                    cap_text = capt["text"]
                fig_allowed = allowed | source_numbers(cap_text)
                # paragraphs elsewhere that cite the same figure also count
                m = re.match(r"\s*(fig(?:ure)?s?\.?|tables?)\s*(\d+)", cap_text, re.I)
                if m:
                    label = re.compile(rf"\b{m.group(1)[:3]}\w*\.?\s*{m.group(2)}\b", re.I)
                    for it in items.values():
                        if it["type"] in ("para", "frag") and label.search(it["text"]):
                            fig_allowed |= source_numbers(it["text"])
                soft = bool(e.get("approx"))
                for f in FIGX_TEXT:
                    if e.get(f) is not None:
                        check_nums(f"{where} {f}", e[f], fig_allowed, soft)
                for k, x in enumerate(e.get("look_for") or []):
                    check_nums(f"{where} look_for {k + 1}", x, fig_allowed, soft)
                panels = e.get("panels")
                if panels is not None:
                    if not isinstance(panels, list) or any(not isinstance(p, dict) or not p.get("label") or not p.get("x") for p in panels):
                        errors.append(f"{where} (figx): panels must be a list of objects with 'label' and 'x'")
                    else:
                        for k, p in enumerate(panels):
                            lab = re.escape(str(p["label"]).strip("() "))
                            if cap_text and not re.search(PANEL_RE.format(label=lab), cap_text):
                                errors.append(f"{where} (figx) panel {k + 1}: label {p['label']!r} does not appear in the caption")
                            check_nums(f"{where} panel {k + 1}", p["x"], fig_allowed, soft)
                if not e.get("what") and not e.get("takeaway"):
                    warns.append(f"{where} (figx): give at least 'what' or 'takeaway'")
    return errors, warns
