# Patches to the vendored literature-guide-read (v0.8.0)

`pdfx/vendor/lgr/` is a copy of `resources/` (without `docs/` and `assets/readme/`). Every change is listed here so an
upstream update can be merged again: copy the new upstream over `vendor/lgr/`, then re-apply the items below.
Search for `PATCH(pdfx)` in the code.

| File | Change |
| --- | --- |
| `scripts/common.py` | `LANGS` gains `"ko"`; Hangul counts as a script a number may touch in `NUM_TOKEN_RE` and the grouped-number regex; `load_elements()` reads Korean names from `references/elements_ko.md` |
| `scripts/check.py` | imports `ko_rules`; `DESCRIPTIVE["ko"]`, `STYLE` dict (zh/en/ko), Korean `TELLS` entry, `LIMITS`/`SHORT_NOTE` for ko; Korean number normalisation before the number check; ko measured in characters; error message lists all `LANGS` |
| `scripts/ko_rules.py` | **new**: Korean describe-detector, translationese rules, limits, number normalisation |
| `scripts/render.py` | `--lang` accepts `ko` |
| `assets/template.html` | `UI.ko` labels, Korean relation names in `REL`, `<html lang="ko">` |
| `references/elements.md` | new types `figx`, `outcome`, `design`, `stat`, `effect`, `bias`, `safety` |
| `references/elements_ko.md` | **new**: Korean element names |
| `references/genres.md` | biomedical genres (CONSORT, STROBE, PRISMA, STARD, ARRIVE, modelling) |
| `tests/unit/test_common.py` | element count 19 → 26 |
| `scripts/mineru_backend.py` | `_child_env()` drops `PYTHONPATH`/`PYTHONHOME` for the MinerU child processes (`_can_import`, `run`), so a uv-tool MinerU on another Python version does not load the engine's bundled packages; docstring says `uv tool install` |
