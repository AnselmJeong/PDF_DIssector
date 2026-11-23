"""Stable ids for annotations: P-numbers change when fixes split or join paragraphs, sids do not."""
import hashlib
import json
import re
import unicodedata
from pathlib import Path


def norm_text(text):
    t = unicodedata.normalize("NFKC", text or "").casefold()
    return re.sub(r"\s+", " ", t).strip()


def sid_for(item):
    raw = norm_text(item.get("text"))[:200] + "|" + str(item.get("page") or "")
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def add_sids(doc):
    """Give every item a sid (sha1 of the first 200 normalised characters and the page), unique within the doc."""
    seen = {}
    for it in doc.get("items", []):
        base = sid_for(it)
        n = seen.get(base, 0)
        seen[base] = n + 1
        it["sid"] = base if n == 0 else f"{base}-{n}"
    doc["doc_rev"] = doc_rev(doc)
    return doc


def doc_rev(doc):
    """A hash of the segmentation the guide is written against (ids, types and texts)."""
    h = hashlib.sha1()
    for it in doc.get("items", []):
        h.update(f"{it.get('id')}|{it.get('type')}|{it.get('text')}\n".encode("utf-8"))
    return h.hexdigest()[:16]


def stamp(paras_path):
    p = Path(paras_path)
    doc = json.loads(p.read_text(encoding="utf-8"))
    add_sids(doc)
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    return doc
