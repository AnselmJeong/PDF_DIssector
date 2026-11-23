"""Open version from PubMed Central: JATS XML via Europe PMC, turned into sources.json.

As with sources.py, the PDF stays the source of the text and page numbers; the JATS version only adds figures,
tables (as rows), display formulas (TeX when the XML has it) and a report of words the PDF text layer dropped.
Only open-access articles have full text; the licence is recorded in sources.json.
"""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from . import lgr  # noqa: F401
import sources  # noqa: E402

PMCID_RE = re.compile(r"\bPMC\s?(\d{5,9})\b")
PMID_RE = re.compile(r"\bPMID:?\s*(\d{6,9})\b", re.I)
DOI_RE = sources.DOI_RE
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
UA = {"User-Agent": "pdf-dissector/0.1 (open-version fetch)"}


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def detect_ids(doc):
    """DOI, PMID and PMCID from the first items of paragraphs.json and the PDF's first page."""
    text = " ".join(i.get("text", "") for i in doc.get("items", [])[:120])
    title_meta = None
    src = doc.get("source_path")
    if src and Path(src).exists() and src.lower().endswith(".pdf"):
        try:
            import pdfplumber
            with pdfplumber.open(src) as pdf:
                meta = pdf.metadata or {}
                text += " " + " ".join(str(v) for v in meta.values())
                if isinstance(meta.get("Title"), str) and len(meta["Title"]) > 20:
                    title_meta = meta["Title"]
                text += " " + (pdf.pages[0].extract_text() or "")
        except Exception:
            pass
    found = {"doi": None, "pmid": None, "pmcid": None}
    dois = sorted({m.group(1).rstrip(".,;)") for m in DOI_RE.finditer(text)}, key=len, reverse=True)
    if dois:  # a DOI broken across lines shows up as a prefix of the whole one; keep the longest
        found["doi"] = dois[0]
    m = PMCID_RE.search(text)
    if m:
        found["pmcid"] = "PMC" + m.group(1)
    m = PMID_RE.search(text)
    if m:
        found["pmid"] = m.group(1)
    found["title_meta"] = title_meta
    return found


def resolve(ids, get=_get):
    """Ask Europe PMC for the record; returns {pmcid, pmid, doi, title, journal, year, authors, oa, license}."""
    q = None
    if ids.get("pmcid"):
        q = f"PMCID:{ids['pmcid']}"
    elif ids.get("doi"):
        q = f'DOI:"{ids["doi"]}"'
    elif ids.get("pmid"):
        q = f"EXT_ID:{ids['pmid']} AND SRC:MED"
    if not q and ids.get("title"):
        q = f'TITLE:"{ids["title"][:200]}"'
    if not q:
        return None
    url = f"{EPMC}/search?query={urllib.parse.quote(q)}&format=json&resultType=core&pageSize=1"
    d = json.loads(get(url))
    res = (d.get("resultList") or {}).get("result") or []
    if not res:
        return None
    r = res[0]
    return {"pmcid": r.get("pmcid"), "pmid": r.get("pmid"), "doi": r.get("doi"), "title": r.get("title"),
            "journal": (r.get("journalInfo") or {}).get("journal", {}).get("title") or r.get("journalTitle"),
            "year": r.get("pubYear"), "authors": r.get("authorString"),
            "oa": r.get("isOpenAccess") == "Y", "license": r.get("license")}


def _text(el):
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)) if el is not None else ""


def parse_jats(xml, pmcid=None):
    """sources.json content from a JATS article: figures, tables, formulas, open paragraphs."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(xml, "xml")
    figs = []
    for f in soup.find_all(["fig", "table-wrap"]):
        kind = "table" if f.name == "table-wrap" else "fig"
        label = _text(f.find("label"))
        cap = _text(f.find("caption"))
        full = (label + " " + cap).strip()
        k2, num = sources.cap_key(full)
        if num is None:
            m = re.search(r"(\d+)", label)
            num = int(m.group(1)) if m else None
        entry = {"kind": kind, "num": num, "caption": full}
        if kind == "table":
            tbl = f.find("table")
            if tbl is not None:
                entry["rows"] = [[_text(c) for c in tr.find_all(["td", "th"])] for tr in tbl.find_all("tr")]
        g = f.find("graphic")
        href = g and (g.get("xlink:href") or g.get("href"))
        if href and pmcid:
            entry["img_url"] = f"https://europepmc.org/articles/{pmcid}/bin/{href}" + ("" if "." in href else ".jpg")
        figs.append(entry)
    eqs = []
    for d in soup.find_all("disp-formula"):
        tex = d.find("tex-math")
        if tex is not None:
            t = _text(tex)
            t = re.sub(r"^.*\\begin\{document\}|\\end\{document\}.*$", "", t, flags=re.S).strip().strip("$")
            eqs.append({"tex": t})
        else:
            alt = d.find("alternatives")
            m = d.find(re.compile("math$"))
            if m is not None and m.get("alttext"):
                eqs.append({"tex": m.get("alttext")})
            elif alt is not None:
                eqs.append({"tex": None, "text": _text(alt)})
    body = soup.find("body")
    paras = [_text(p) for p in (body.find_all("p") if body is not None else [])]
    lic = soup.find("license")
    return {"kind": "jats", "figures": figs, "equations": eqs, "license": _text(lic) if lic is not None else None}, paras


def fetch(work, ids=None, get=_get, images=True):
    """Detect ids, fetch the JATS full text and write WORK/sources.json. Returns a summary dict."""
    work = Path(work)
    doc = json.loads((work / "paragraphs.json").read_text(encoding="utf-8"))
    ids = ids or detect_ids(doc)
    try:
        rec = resolve(ids, get) if any(ids.values()) else None
        if (not rec or not rec.get("pmcid")) and ids.get("title_meta"):
            rec = resolve({"title": ids["title_meta"]}, get) or rec
    except Exception as e:  # offline or the service is slow: the open version is optional
        return {"ids": ids, "record": None, "written": False, "reason": f"Europe PMC unreachable: {e}"}
    summary = {"ids": ids, "record": rec, "written": False}
    if not rec or not rec.get("pmcid"):
        summary["reason"] = "no PMC record" if any(ids.values()) else "no DOI/PMID/PMCID found"
        return summary
    try:
        xml = get(f"{EPMC}/{rec['pmcid']}/fullTextXML")
    except Exception as e:  # not in the OA subset, or offline
        summary["reason"] = f"no open full text: {e}"
        return summary
    result, open_paras = parse_jats(xml, rec["pmcid"])
    if images:
        for f in result["figures"]:
            url = f.pop("img_url", None)
            if url:
                try:
                    raw = get(url)
                    if len(raw) <= sources.MAX_IMG:
                        f["img"] = sources.data_uri(raw, Path(urllib.parse.urlparse(url).path).suffix or ".jpg")
                except Exception:
                    pass
    else:
        for f in result["figures"]:
            f.pop("img_url", None)
    result["source"] = f"https://europepmc.org/article/PMC/{rec['pmcid']}"
    result["record"] = rec
    result["text_check"] = sources.compare_text(work / "paragraphs.json", open_paras)
    (work / "sources.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    summary.update(written=True, figures=len(result["figures"]), equations=len(result["equations"]))
    return summary
