# PDF Dissector addendum: Korean notes for biomedical papers

These rules extend method.md, elements.md, schema.md and genres.md. Where they differ, these win.

## Language of the notes

- Write every guide field (role, read, note, why, thesis, overview, claim, flow steps, recall, element s/x/why, syms meanings, figure and formula explanations) in Korean, `meta.notes_lang: ["ko"]`. Anchors `a` stay verbatim English copied from the paragraph.
- Write plain, friendly Korean for a graduate student or clinician who is new to the field. Short sentences. Explain why something matters, not only what it is.
- Medical terms: the first time a term appears write `한국어(English)`, e.g. `무작위 배정(randomization)`, `위험비(hazard ratio)`; afterwards use one form consistently. Keep standard abbreviations in English: HR, OR, RR, CI, ITT, PP, AUC, SD, SE, BMI, RCT, IQR.
- Do not write translationese: avoid "~에 대해 ~를 진행하다", "~하는 역할을 하다", "~라고 할 수 있다", chains of "의", filler openers ("주목할 점은", "흥미롭게도"), "~가 아니라 ~이다" contrasts, and dashes as connectors.
- Never begin a note with "이 문단은 ...을 소개한다": restate the content itself (method.md section 4).
- Length guide (Korean characters): role under 30, read under 120, part claim under 110, thesis under 140.

## Numbers

- Every number in a field must appear in the source scope (method.md section 6). Write numbers as digits, exactly as the paper gives them (keep its decimals and units). Write "약" only for values read off a graph in a figure walkthrough with `approx: true`.
- The only exception is the formula element's `illustrative` field: a small worked example with made-up numbers to show how the formula behaves. Keep it clearly hypothetical ("예를 들어 ... 라고 하면"); the app labels it "설명용 가상 예시".

## Tiers for biomedical papers

- Follow the genre checkpoints in genres.md (CONSORT, STROBE, PRISMA, STARD, ARRIVE, modelling). The paragraphs that carry those checkpoints are close reads unless the reader's purpose says otherwise.
- Tag them with the biomedical elements: `outcome`, `design`, `stat`, `effect`, `bias`, `safety`. `effect` anchors the sentence with the effect size and its CI or p value.

## Formula deep-dive (formula element, optional fields)

Besides `tex`, `syms`, `x`, `why`:
- `steps`: the formula split into terms, `[{"part": "\\beta_1 X", "x": "..."}]`, each explained in one sentence.
- `intuition`: one or two sentences on what the formula means intuitively.
- `units`: units and dimensions of the quantities.
- `clinical`: how the formula is used to read the results (e.g. what an HR of the reported size means for patients).
- `illustrative`: optional made-up worked example (see Numbers).

## Figure and table walkthrough (element `figx`)

Attach a `figx` element to the paragraph that hosts the figure (the paragraph that first cites it):
`{"t": "figx", "cap": "C3", "what": "...", "panels": [{"label": "A", "x": "..."}], "axes": "...", "look_for": ["..."], "takeaway": "...", "caveat": "...", "approx": false}`
- `what`: the question the figure answers. `panels`: one entry per panel label that appears in the caption (A, B, ...). `axes`: what the axes, colours and error bars mean. `look_for`: two to four things to look at. `takeaway`: what the figure shows, in the authors' terms, no stronger. `caveat`: what it cannot show.
- Numbers come from the caption, the citing paragraphs or the table text. Values you read off the graph need "약" and `approx: true`.
