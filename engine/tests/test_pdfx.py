import copy
import io
import json

import pytest

from pdfx import lgr  # noqa: F401
import check  # noqa: E402
import ko_rules  # noqa: E402
from pdfx import biomed_checks, jats, sid
from pdfx.__main__ import serve


def ko_case():
    doc = {"items": [
        {"id": "P1", "type": "para", "page": 1, "text": "We enrolled 120 patients; 60 received drug A. The hazard ratio was 0.72 (95% CI 0.55-0.94)."},
        {"id": "C1", "type": "caption", "page": 2, "text": "Figure 1. (A) Survival curves. (B) Hazard ratios by subgroup; 24 months of follow-up."},
        {"id": "P2", "type": "para", "page": 2, "text": "Figure 1 shows survival by arm over 24 months."},
    ], "page_count": 2}
    guide = {"meta": {"title": "Trial", "notes_lang": ["ko"], "purpose": "전체 논증", "density": "high"},
             "thesis": "약물 A가 사망 위험을 낮춘다.", "overview": "환자 120명을 무작위 배정했다.",
             "parts": [{"id": "S1", "range": "P1-P2", "title": "결과", "role": "근거", "claim": "위험비 0.72로 위험이 낮다.",
                        "claim_p": "P1", "recall": [{"q": "몇 명이 약을 받았나?", "a": "60명."}]}],
             "paras": {"P1": {"tier": "close", "role": "주요 효과", "read": "위험비와 신뢰구간을 보세요.",
                              "note": "환자 120명 중 60명이 약물 A를 받았고 위험비는 0.72였다.",
                              "els": [{"t": "effect", "a": "The hazard ratio was 0.72", "s": "위험비 0.72"}]},
                       "P2": {"tier": "skim", "role": "생존 곡선", "note": "24개월 동안 두 군의 생존을 비교한 그림이다."}}}
    return doc, guide


def test_ko_language_accepted_and_numbers_checked():
    doc, guide = ko_case()
    errors, warns, comp = check.run_checks(doc, guide)
    assert not errors, errors
    assert comp["stats"]["langs"] == ["ko"]
    guide["paras"]["P1"]["note"] = "환자 130명 중 60명이 약을 받았다."
    errors, _, _ = check.run_checks(doc, guide)
    assert any("130" in e for e in errors)


def test_ko_style_and_descriptive_warnings():
    doc, guide = ko_case()
    guide["paras"]["P2"]["note"] = "이 문단은 생존 곡선을 소개한다."
    _, warns, _ = check.run_checks(doc, guide)
    assert any("describes the paragraph" in w for w in warns)
    guide["paras"]["P2"]["note"] = "생존에 대해 비교를 진행했다. 효과가 아니라 경향이다."
    _, warns, _ = check.run_checks(doc, guide)
    assert any("번역투" in w for w in warns) and any("아니라" in w for w in warns)


def test_ko_number_normalisation():
    assert ko_rules.normalize_numbers("2023년 5월에 1만 2천 명") == "2023-5에 12000 명"
    assert ko_rules.normalize_numbers("3천 명") == "3000 명"


def test_biomed_formula_and_figx():
    doc, guide = ko_case()
    guide["paras"]["P2"]["els"] = [{"t": "figx", "cap": "C1", "what": "어느 군이 오래 사는가",
                                   "panels": [{"label": "A", "x": "생존 곡선"}, {"label": "C", "x": "없는 패널"}],
                                   "takeaway": "24개월 동안 약물군 생존이 높다."}]
    guide["paras"]["P1"]["els"].append({"t": "formula", "a": "The hazard ratio was 0.72", "tex": "HR = h_1/h_0",
                                        "steps": [{"part": "h_1", "x": "약물군 위험 999"}],
                                        "illustrative": "예: 위험이 10%에서 7.2%로"})
    errors, warns = biomed_checks.run(doc, guide)
    assert any("panel 2" in e and "'C'" in e for e in errors)
    assert any("999" in e for e in errors)
    assert not any("illustrative" in e for e in errors)  # made-up examples are exempt


def test_figx_approx_is_a_warning():
    doc, guide = ko_case()
    guide["paras"]["P2"]["els"] = [{"t": "figx", "cap": "C1", "takeaway": "약 80%가 생존", "approx": True}]
    errors, warns = biomed_checks.run(doc, guide)
    assert not errors and any("80" in w for w in warns)


def test_sid_stable_and_unique():
    doc, _ = ko_case()
    d1 = sid.add_sids(copy.deepcopy(doc))
    d2 = sid.add_sids(copy.deepcopy(doc))
    assert [i["sid"] for i in d1["items"]] == [i["sid"] for i in d2["items"]]
    dup = copy.deepcopy(doc)
    dup["items"].append(dict(dup["items"][0], id="P3"))
    d3 = sid.add_sids(dup)
    assert d3["items"][0]["sid"] != d3["items"][-1]["sid"]
    assert d1["doc_rev"] != d3["doc_rev"]


JATS = b"""<?xml version="1.0"?><article xmlns:xlink="http://www.w3.org/1999/xlink"><body>
<p>We enrolled one hundred and twenty patients in the trial and followed them for two years.</p>
<fig id="f1"><label>Fig 1</label><caption><p>Survival by arm.</p></caption><graphic xlink:href="pone.0001.g001"/></fig>
<table-wrap><label>Table 1</label><caption><p>Baseline.</p></caption><table><tr><th>Arm</th><th>n</th></tr><tr><td>A</td><td>60</td></tr></table></table-wrap>
<disp-formula><tex-math>\\mathrm{HR} = h_1/h_0</tex-math></disp-formula>
</body><back><license><p>CC BY 4.0</p></license></back></article>"""


def test_parse_jats():
    res, paras = jats.parse_jats(JATS, "PMC1")
    kinds = [(f["kind"], f["num"]) for f in res["figures"]]
    assert ("fig", 1) in kinds and ("table", 1) in kinds
    table = next(f for f in res["figures"] if f["kind"] == "table")
    assert table["rows"][1] == ["A", "60"]
    assert res["equations"][0]["tex"].startswith("\\mathrm{HR}")
    assert "CC BY" in res["license"]
    assert paras and "patients" in paras[0]


def test_detect_ids_prefers_whole_doi():
    doc = {"items": [{"text": "https://doi.org/10.1371/journal."}, {"text": "https://doi.org/10.1371/journal.pone.0293623 PMC1234567"}]}
    ids = jats.detect_ids(doc)
    assert ids["doi"] == "10.1371/journal.pone.0293623" and ids["pmcid"] == "PMC1234567"


def test_serve_protocol(tmp_path):
    inp = io.StringIO('{"id": 1, "cmd": "ping"}\nnot json\n{"id": 2, "cmd": "nope"}\n')
    out = io.StringIO()
    serve(inp, out)
    lines = [json.loads(x) for x in out.getvalue().splitlines()]
    assert lines[0]["event"] == "ready"
    assert lines[1]["id"] == 1 and lines[1]["ok"]
    assert not lines[2]["ok"] and "bad JSON" in lines[2]["error"]
    assert lines[3]["id"] == 2 and not lines[3]["ok"]


def test_segment_and_reader_data(tmp_path, sample_pdf):
    from pdfx.__main__ import call
    from pdfx import export
    work = tmp_path / "w"
    res = call("segment", {"pdf": str(sample_pdf), "work": str(work)}, lambda *a: None)
    assert res["counts"]["para"] > 0 and res["doc_rev"]
    doc = json.loads((work / "paragraphs.json").read_text())
    assert all(it.get("sid") for it in doc["items"])
    paras = [it["id"] for it in doc["items"] if it["type"] == "para"]
    guide = {"meta": {"title": "Normal", "notes_lang": ["ko"], "purpose": "전체"}, "thesis": "정규분포 설명.", "overview": "평균과 표준편차.",
             "parts": [{"id": "S1", "range": f"P1-P{len(paras)}", "title": "전체", "role": "설명", "claim": "정규분포는 두 모수를 가진다.", "claim_p": "P1",
                        "recall": [{"q": "모수는?", "a": "평균과 표준편차."}]}]}
    (work / "guide.json").write_text(json.dumps(guide, ensure_ascii=False))
    (work / "paras_01.json").write_text(json.dumps({"paras": {p: {"tier": "skim", "role": f"문단 {p}", "note": "평균과 표준편차를 쓴다."} for p in paras}}, ensure_ascii=False))
    data = export.reader_data(work)
    assert data["check"]["errors"] == []
    assert data["default_lang"] == "ko"
    assert all("sid" in it for it in data["items"].values())
    out = export.export_html(work, tmp_path / "out.html")
    assert "guide-data" in (tmp_path / "out.html").read_text()
