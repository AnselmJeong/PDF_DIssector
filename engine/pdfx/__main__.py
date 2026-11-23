"""pdfx command server.

  python -m pdfx serve                       # JSON lines on stdin/stdout
  python -m pdfx run <cmd> '<json args>'     # one command, one JSON line on stdout (cancellable by kill)
  python -m pdfx cmds                        # list commands

Protocol (serve): request {"id", "cmd", "args"} -> response {"id", "ok": true, "result"} or {"id", "ok": false, "error"};
progress events {"id", "event": "progress", "stage", "pct", "msg"} may come before the response.
Anything the vendored scripts print is captured and returned as result["log"], never mixed into the protocol.
"""
import contextlib
import io
import json
import os
import re
import subprocess
import sys
import traceback
from pathlib import Path

from . import lgr
from . import sid as sidmod

COMMANDS = {}


def command(fn):
    COMMANDS[fn.__name__] = fn
    return fn


def _paras(work):
    return Path(work) / "paragraphs.json"


@command
def ping(args, emit):
    from . import __version__
    return {"version": __version__, "python": sys.version.split()[0], "vendor": str(lgr.VENDOR)}


@command
def probe(args, emit):
    """Page count, text layer per page, scan guess and MinerU availability."""
    import pdfplumber
    import mineru_backend
    pdf_path = args["pdf"]
    pages, chars = 0, []
    meta = {}
    with pdfplumber.open(pdf_path) as pdf:
        pages = len(pdf.pages)
        meta = {k: str(v) for k, v in (pdf.metadata or {}).items() if isinstance(v, (str, int, float))}
        for p in pdf.pages[: min(pages, 40)]:
            chars.append(len(p.chars))
    image_only = sum(1 for c in chars if c < 30)
    try:
        mineru = mineru_backend.available()
    except Exception:
        mineru = None
    return {"pages": pages, "chars_per_page": chars, "scanned": bool(chars) and image_only > 0.6 * len(chars),
            "image_only_pages": image_only, "mineru": mineru, "meta": meta}


SELF_CHECK_RE = re.compile(r"^(?:自检|Self-check)[：:]\s*(.*)$", re.M)
COUNT_RE = re.compile(r"段落 P (\d+)，标题 H (\d+)，图表说明 C (\d+)，脚注 N (\d+)，碎片 F (\d+)")


@command
def segment(args, emit):
    """Run segment.py as a child process (so a kill cancels it), then add sids."""
    work = Path(args["work"])
    work.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, str(lgr.SCRIPTS / "segment.py"), args["pdf"], "--out", str(work)]
    for opt in ("pages", "columns", "engine"):
        if args.get(opt):
            cmd += [f"--{opt}", str(args[opt])]
    emit("segment", 5, "segmenting")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env, encoding="utf-8", errors="replace")
    log = proc.stdout + ("\n" + proc.stderr if proc.stderr.strip() else "")
    if proc.returncode != 0 or not _paras(work).exists():
        raise RuntimeError(f"segment.py failed ({proc.returncode}):\n{log[-4000:]}")
    doc = sidmod.stamp(_paras(work))
    m = SELF_CHECK_RE.search(log)
    counts = {}
    for t in ("para", "heading", "caption", "note", "frag"):
        counts[t] = sum(1 for it in doc["items"] if it["type"] == t)
    return {"log": log, "self_check": m.group(1) if m else None, "counts": counts,
            "page_count": doc.get("page_count"), "title_guess": doc.get("title_guess"),
            "doc_rev": doc.get("doc_rev"), "crops": len(doc.get("crops") or {})}


@command
def items(args, emit):
    """Items of paragraphs.json, optionally only some pages and types, for prompts and the UI."""
    doc = json.loads(_paras(args["work"]).read_text(encoding="utf-8"))
    pages = set(args.get("pages") or [])
    types = set(args.get("types") or [])
    out = [it for it in doc["items"] if (not pages or it.get("page") in pages) and (not types or it["type"] in types)]
    return {"items": out, "page_count": doc.get("page_count"), "title_guess": doc.get("title_guess"),
            "crops": doc.get("crops") or {}, "doc_rev": doc.get("doc_rev"), "source_path": doc.get("source_path")}


@command
def overlay(args, emit):
    import fix
    pages = args.get("pages")
    if isinstance(pages, list):
        pages = ",".join(str(p) for p in pages)
    written = fix.overlay(_paras(args["work"]), pages, Path(args["out"]) if args.get("out") else None, bool(args.get("orig")))
    return {"pages": [str(p) for p in written]}


@command
def apply_fixes(args, emit):
    """Write fixes.json (if given) and apply it; sids are recomputed afterwards."""
    import fix
    work = Path(args["work"])
    fixes = work / "fixes.json"
    if args.get("fixes") is not None:
        fixes.write_text(json.dumps(args["fixes"], ensure_ascii=False, indent=1), encoding="utf-8")
    doc = fix.apply(fixes, _paras(work))
    doc = sidmod.stamp(_paras(work))
    log = json.loads((work / "fixes_log.json").read_text(encoding="utf-8"))
    return {"id_map": log.get("id_map"), "doc_rev": doc.get("doc_rev"),
            "counts": {t: sum(1 for it in doc["items"] if it["type"] == t) for t in ("para", "heading", "caption", "note", "frag")}}


@command
def stamp(args, emit):
    doc = sidmod.stamp(_paras(args["work"]))
    return {"doc_rev": doc.get("doc_rev")}


@command
def fetch_open(args, emit):
    from . import jats
    return jats.fetch(args["work"], args.get("ids"), images=args.get("images", True))


@command
def check(args, emit):
    from . import export
    return export.checks(args["work"], args.get("density"))


@command
def build_data(args, emit):
    from . import export
    data = export.reader_data(args["work"], args.get("lang"), args.get("density"))
    if args.get("out"):
        export.write_json(data, args["out"])
        return {"path": args["out"], "errors": len(data["check"]["errors"])}
    return data


@command
def export_html(args, emit):
    from . import export
    return {"path": export.export_html(args["work"], args["out"], args.get("lang"), args.get("force", True))}


@command
def dump(args, emit):
    import render
    render.dump(args["html"], args["out"])
    return {"out": args["out"]}


@command
def page_image(args, emit):
    """Render one PDF page (or a normalised bbox region of it) to PNG, cached by name."""
    import pdfplumber
    out = Path(args["out"])
    if out.exists() and not args.get("force"):
        return {"path": str(out), "cached": True}
    out.parent.mkdir(parents=True, exist_ok=True)
    res = int(args.get("dpi") or 110)
    with pdfplumber.open(args["pdf"]) as pdf:
        page = pdf.pages[int(args["page"]) - 1]
        img = page.to_image(resolution=res).original.convert("RGB")
        box = args.get("bbox")
        if box:
            pad = float(args.get("pad") or 0.01)
            w, h = img.size
            x0, y0, x1, y1 = box
            img = img.crop((max(0, (x0 - pad) * w), max(0, (y0 - pad) * h), min(w, (x1 + pad) * w), min(h, (y1 + pad) * h)))
        max_side = int(args.get("max_side") or 1600)
        img.thumbnail((max_side, max_side))
        img.save(out, "PNG", optimize=True)
    return {"path": str(out), "cached": False, "size": list(img.size)}


@command
def references(args, emit):
    """Prompt assets: method, elements, schema, genres, review (+ Korean addenda), as text."""
    out = {}
    for name in ("method", "elements", "elements_ko", "schema", "genres", "review"):
        p = lgr.REFERENCES / f"{name}.md"
        if p.exists():
            out[name] = p.read_text(encoding="utf-8")
    extra = Path(__file__).resolve().parent.parent / "references"
    for p in sorted(extra.glob("*.md")) if extra.exists() else []:
        out[p.stem] = p.read_text(encoding="utf-8")
    return out


def call(cmd, args, emit):
    if cmd not in COMMANDS:
        raise KeyError(f"unknown command {cmd!r}; known: {', '.join(sorted(COMMANDS))}")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            result = COMMANDS[cmd](args or {}, emit)
        except SystemExit as e:  # the vendored scripts sys.exit() with a message
            raise RuntimeError(f"{e.code}\n{buf.getvalue()[-3000:]}") from None
    printed = buf.getvalue()
    if printed and isinstance(result, dict) and "log" not in result:
        result["log"] = printed
    return result


def serve(stdin=sys.stdin, stdout=sys.stdout):
    out = stdout

    def write(obj):
        out.write(json.dumps(obj, ensure_ascii=False) + "\n")
        out.flush()

    write({"event": "ready", "commands": sorted(COMMANDS)})
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            write({"id": None, "ok": False, "error": f"bad JSON: {e}"})
            continue
        rid = req.get("id")

        def emit(stage, pct, msg, rid=rid):
            write({"id": rid, "event": "progress", "stage": stage, "pct": pct, "msg": msg})
        try:
            write({"id": rid, "ok": True, "result": call(req.get("cmd"), req.get("args"), emit)})
        except Exception as e:
            write({"id": rid, "ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-2000:]})


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8", errors="replace")
    if not argv or argv[0] == "serve":
        serve()
        return 0
    if argv[0] == "cmds":
        print("\n".join(sorted(COMMANDS)))
        return 0
    if argv[0] == "run":
        cmd = argv[1]
        args = json.loads(argv[2]) if len(argv) > 2 else {}
        real = sys.stdout

        def emit(stage, pct, msg):
            real.write(json.dumps({"event": "progress", "stage": stage, "pct": pct, "msg": msg}, ensure_ascii=False) + "\n")
            real.flush()
        try:
            res = call(cmd, args, emit)
            real.write(json.dumps({"ok": True, "result": res}, ensure_ascii=False) + "\n")
            return 0
        except Exception as e:
            real.write(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False) + "\n")
            return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
