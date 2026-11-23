"""Reader data for the app (JSON) and the standalone HTML export, both built on render.py."""
import glob
import json
import types
from pathlib import Path

from . import lgr  # noqa: F401
import render  # noqa: E402
from check import run_checks  # noqa: E402
from common import as_lang, load_guide, load_json  # noqa: E402

from . import biomed_checks

EXTRA_TEXT = ("intuition", "units", "clinical", "illustrative", "what", "axes", "takeaway", "caveat")


def guide_files(work):
    work = Path(work)
    return [work / "guide.json"] + sorted(Path(p) for p in glob.glob(str(work / "paras_*.json")))


def load_work(work):
    work = Path(work)
    doc = load_json(work / "paragraphs.json")
    guide = load_guide([str(p) for p in guide_files(work) if p.exists()])
    return doc, guide


def checks(work, density=None):
    doc, guide = load_work(work)
    errors, warns, comp = run_checks(doc, guide, density)
    e2, w2 = biomed_checks.run(doc, guide)
    return {"errors": errors + e2, "warns": warns + w2, "stats": comp["stats"]}


def _enrich(entries, guide, primary):
    """build_data keeps only the upstream element fields; add the PDF Dissector ones back."""
    for eid, e in entries.items():
        src = (guide["paras"].get(eid) or {}).get("els") or []
        for y, x in zip(e.get("els", []), src):
            for f in EXTRA_TEXT:
                if x.get(f) is not None:
                    y[f] = as_lang(x[f], primary)
            if isinstance(x.get("steps"), list):
                y["steps"] = [{"part": str(s.get("part", "")), "x": as_lang(s.get("x"), primary)} for s in x["steps"] if isinstance(s, dict)]
            if isinstance(x.get("panels"), list):
                y["panels"] = [{"label": str(p.get("label", "")), "x": as_lang(p.get("x"), primary)} for p in x["panels"] if isinstance(p, dict)]
            if isinstance(x.get("look_for"), list):
                y["look_for"] = [as_lang(v, primary) for v in x["look_for"]]
            for f in ("cap", "approx"):
                if x.get(f) is not None:
                    y[f] = x[f]
        g = guide["paras"].get(eid) or {}
        if g.get("verify_failed"):
            e["verify_failed"] = g["verify_failed"]


def reader_data(work, lang=None, density=None):
    """The data render.build_data makes, with crop file paths instead of data URIs and no page images
    (the app shows the PDF itself), plus sids, check results and the extended element fields."""
    work = Path(work)
    doc, guide = load_work(work)
    errors, warns, comp = run_checks(doc, guide, density)
    e2, w2 = biomed_checks.run(doc, guide)
    sources = load_json(work / "sources.json") if (work / "sources.json").exists() else None
    crops = {pid: str((work / rel).resolve()) for pid, rel in (doc.get("crops") or {}).items() if (work / rel).exists()}
    data = render.build_data(doc, guide, comp, sources, {}, lang, crops=crops)
    _enrich(data["guide"], guide, comp["primary"])
    sids = {it["id"]: it.get("sid") for it in doc["items"]}
    for iid, it in data["items"].items():
        if sids.get(iid):
            it["sid"] = sids[iid]
    data["doc_rev"] = doc.get("doc_rev")
    data["source_path"] = doc.get("source_path")
    data["check"] = {"errors": errors + e2, "warns": warns + w2, "stats": comp["stats"]}
    return data


def export_html(work, out_path, lang=None, force=True):
    work = Path(work)
    doc, guide = load_work(work)
    sources = work / "sources.json"
    args = types.SimpleNamespace(density=None, force=force, sources=str(sources) if sources.exists() else None,
                                 pdf=None, no_page_images=False, lang=lang)
    render.render(doc, guide, out_path, args, work_dir=work)
    return str(out_path)


def write_json(obj, path):
    Path(path).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
