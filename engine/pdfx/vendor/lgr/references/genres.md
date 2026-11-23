# Genre adjustments

Decide the genre first and record it in `meta.genre`. If unsure, choose the closest and say so ("empirical paper (approx.)"). These are starting rules; revise them as you use the skill.

## Empirical paper
- Close reads are usually the research question and contribution, the design and its key assumptions, the main results, and the limitations the authors admit.
- Usually skimmable: paper-by-paper literature review, robustness details (unless the conclusion rests on them), data cleaning.
- Typical map: question → design → main results → mechanism → limits.

## Theory or argument (philosophy, political theory, social theory)
- Close reads: the thesis, key distinctions and definitions, each premise, the reply to the strongest objection.
- Usually skimmable: intellectual history, long reports of others' views unless they are rebutted point by point.
- Examples and thought experiments often carry the argument here, so do not skim them by default. Test: would the argument stand without this case?

## Review or survey
- Close reads: the organising framework, the author's own synthesis and judgments, the open problems.
- Usually skimmable: study-by-study summaries.
- A review's claim often sits in how it classifies the literature; read the framework closely.

## Textbook chapter
- Close reads: definitions, key models, theorems or procedures, the first worked example of a new method.
- Usually skimmable: motivating stories and sidebars.
- Map usually follows the chapter order.

## Book chapter or historical narrative
- Close reads: the chapter's argument (often at the start and the end), turning points, the evidence the argument rests on.
- Usually skimmable: narrative detail, biography, facts unrelated to the argument.
- Narrative chapters often leave the argument implicit; draw it from the opening, the close and recurring judgments.

## Commentary or policy report
- Close reads: conclusions and recommendations, the evidence behind them, replies to the other side.
- Usually skimmable: background and institutional history.

## Chinese readings
- Headings such as 第一章, 一、 and （一） mark levels; segment.py recognises them.
- Footnotes are often marked ①②; references sit under 参考文献.

## Biomedical genres (added by PDF Dissector)

Biomedical papers follow reporting guidelines. Use the checkpoint list of the matching guideline to choose close reads; tag them with the biomedical elements (`outcome`, `design`, `stat`, `effect`, `bias`, `safety`).

### Randomised controlled trial (CONSORT)
- Close reads: primary outcome definition, randomisation and allocation concealment, blinding, analysis population (ITT/PP), sample size rationale, the main effect size with its CI, adverse events, the limitations the authors admit.
- Usually skimmable: recruitment logistics, secondary outcomes that do not change the conclusion, trial registration boilerplate.

### Observational study: cohort, case-control, cross-sectional (STROBE)
- Close reads: exposure and outcome definitions, the confounders in the adjusted model, sensitivity analyses, discussion of reverse causation and residual confounding.

### Systematic review and meta-analysis (PRISMA)
- Close reads: search strategy, eligibility criteria, risk of bias assessment, pooled estimate with heterogeneity (I²), publication bias, certainty of evidence (GRADE).

### Diagnostic accuracy study (STARD)
- Close reads: the reference standard, the patient spectrum, sensitivity, specificity or AUC and the threshold used.

### Basic or translational study: wet lab, animal (ARRIVE)
- Close reads: validity of the model, n and the number of independent replicates, the statistical unit (cells versus animals), the key figure panels.

### Computational or modelling study (neuroscience, pharmacokinetics)
- Close reads: model assumptions, the core equations, parameter estimation, how the model was validated.

### Narrative review, case report, methods or protocol
- Narrative review: as Review or survey above.
- Case report: the presentation, the diagnostic reasoning and the take-home lesson.
- Methods or protocol: the procedure's critical steps and its validation.
