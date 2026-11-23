# PDF Dissector: 기술 사양 및 구현 계획서

- 작성일: 2026-11-20
- 상태: 계획 (구현 전)
- 기준 문서: `docs/Literature Guide Read.md`
- 출발 코드: `resources/` (literature-guide-read v0.8.0, MIT License)

---

## 0. 요약

PDF Dissector는 biomedical 논문 PDF를 받아 **읽기 순서가 복원된 HTML 문서**로 바꾸고, 문단마다 **정독(Study closely)** 과 **훑어보기(Skim)** 를 구분해 표시하며, 정독 문단에는 AI가 **친절한 한국어 해설**을 붙여 주는 데스크톱 앱이다. 해설은 특히 **수식**과 **Figure/Table** 에 집중한다.

핵심 설계 결정은 다음 다섯 가지다.

1. **파이프라인은 다시 만들지 않는다.** `resources/scripts/`의 segment, fix, crops, check, render 로직(약 8,000줄, 39개 테스트 파일)을 Python sidecar로 그대로 재사용하고, 앱은 이를 호출·조율한다.
2. **"Agent가 수행하던 워크플로"를 결정적(deterministic) 작업 파이프라인으로 바꾼다.** SKILL.md에서 사람이 대화로 하던 단계(브리핑, 시각적 보정, 가이드 작성, 검사, 2차 검토)를 앱의 Job Runner가 Claude API 호출로 자동 실행한다.
3. **biomedical에 맞게 방법론을 확장한다.** RCT, 관찰연구, 메타분석, 진단 정확도 연구, 기초실험, 계산/모델링 논문별 정독 기준(CONSORT, STROBE, PRISMA, STARD, ARRIVE 체크포인트)과, PMC JATS XML 원문 연동을 추가한다.
4. **해설 언어로 한국어(ko)를 1급 언어로 추가한다.** 현재 `common.py`의 `LANGS = ("zh", "en")`과 `check.py`의 문체 규칙은 한국어를 지원하지 않으므로 검사기부터 확장한다.
5. **UI는 Electrobun v2 + React + Vite + Tailwind v4 + shadcn/ui + ReUI(free)** 로 만든다. 독서 화면은 standalone HTML(`template.html`)을 iframe으로 띄우는 대신, 동일한 데이터 모델을 React로 다시 렌더링해 앱 수준의 상호작용(사용자 tier 변경, 해설 재생성, 사용자 annotation)을 가능하게 한다. Standalone HTML 내보내기는 기존 `render.py`로 유지한다.

---

## 1. 목표와 범위

### 1.1 사용자 시나리오

1. 사용자가 PDF를 앱 창에 끌어다 놓는다.
2. 앱이 짧은 브리핑을 묻는다: 읽는 목적(전체 논증 / 핵심 주장 / 방법론 / 인용할 근거 / 시험·저널클럽 준비), 분야 친숙도, 궁금한 질문. "알아서"를 누르면 기본값(전체 논증, 중간 밀도)을 쓴다.
3. 처리 진행 상황이 단계별로 보인다(추출 → 페이지 검수 → 논문 이해 → 해설 작성 → 검증 → 2차 검토).
4. 완료되면 Reader 화면이 열린다.
   - 상단: 논문의 한 문장 결론과 논증 지도(Argument map)
   - 좌측: 현재 섹션의 주장, 추론 단계, 용어
   - 본문: 원문(영문, 수정 없음). 정독 문단은 "무엇을 보며 읽을지" 안내와 접힌 요약, 훑어보기 문단은 한국어 요약이 먼저, 원문은 한 번 클릭
   - 수식: KaTeX 렌더링 + PDF crop + 기호표 + 단계별 해설
   - Figure/Table: crop 이미지 + 패널별 해설 + "이 그림에서 볼 것"
   - 우측(선택): 원본 PDF 페이지 뷰, 해당 문단 bbox 하이라이트
5. 사용자는 tier를 바꾸거나(Skim → Study), 특정 문단·수식·그림에 대해 "더 쉽게 설명", "다시 쓰기"를 요청하고, 직접 하이라이트와 메모를 남긴다.
6. 결과는 라이브러리에 저장되고, 오프라인 단일 HTML로 내보낼 수 있다.

### 1.2 Tier 정책

사용자의 요청은 두 범주(정독 / skim)이다. 원 코드의 3단계(close / skim / skip)는 데이터 모델에서 유지하되, UI에서는 다음처럼 2범주로 보여 준다.

| 데이터 tier | UI 표기 | 표시 방식 |
| --- | --- | --- |
| `close` | **Study closely** (정독) | 원문 펼침, read-for 안내, 해설 카드(수식/그림 포함), 접힌 요약 |
| `skim` | **Skim** | 한국어 요약 먼저, 원문 접힘 |
| `skip` | Skim 안의 "생략 가능" 하위 표기 | 한 줄 요약, 원문 접힘 |

이렇게 하면 기존 check.py와 render.py를 그대로 쓰면서 사용자가 원한 2분류 경험을 준다. 설정에서 "3단계로 보기"를 켤 수 있다.

### 1.3 범위 밖 (v1)

- 스캔 PDF의 완벽한 OCR (MinerU 선택 설치로만 지원)
- 원문 전체의 한국어 번역 (v2 후보: 문단 단위 번역 레이어)
- 클라우드 동기화, 다중 사용자 협업
- Windows 코드 서명 (Electrobun Hutch 파이프라인이 macOS만 지원)

---

## 2. 출발 코드 분석 (resources/)

### 2.1 구성

| 파일 | 줄 수 | 역할 | 재사용 방식 |
| --- | --- | --- | --- |
| `scripts/segment.py` | 5,148 | pdfplumber 기반 레이아웃 복원, 컬럼 감지(`choose_columns`, `layout_signals`), 폰트 인코딩 복구, 캡션/각주/fragment 분리 → `paragraphs.json` | **그대로** (sidecar) |
| `scripts/mineru_backend.py` | 394 | 선택적 MinerU 엔진(스캔, 표 구조, 수식 LaTeX) | 그대로, 설치 UI 추가 |
| `scripts/crops.py` | 104 | 수식·표 영역 PNG crop | 그대로 |
| `scripts/fix.py` | 376 | 페이지 overlay(bbox+ID 그리기), `fixes.json`(type/join/split/move/region) 적용 | 그대로, LLM이 fixes.json 작성 |
| `scripts/fix_crops.py` | 81 | 보정 후 crop 재배치 | 그대로 |
| `scripts/check.py` | 583 | 스키마·anchor 원문 일치·숫자 출처·밀도·문체 검사 | **확장**(ko, biomedical 규칙) |
| `scripts/common.py` | 419 | anchor 검색, 숫자 추출, 언어 처리 | **확장**(`LANGS`에 ko) |
| `scripts/render.py` | 395 | 데이터 병합 + standalone HTML 생성, `--dump` 복구 | 내보내기용 유지, `build_data()`를 JSON 출력 모드로 분리 |
| `scripts/sources.py` | 339 | arXiv HTML/TeX 원문 연동 | **확장**(PMC JATS, Europe PMC) |
| `assets/template.html` | 61.9 KB | 단일 HTML reader (vanilla JS) | 내보내기용 유지, React UI 설계 참고 |
| `references/*.md` | | method, elements, schema, genres, review | **프롬프트 자산**으로 이식·확장 |
| `tests/unit/*` | 39 파일 | pytest | 그대로 CI에 포함 |

### 2.2 데이터 계약 (변경 없이 유지)

- `paragraphs.json`: `{version: 2, source, source_path, mode, page_count, page_labels, title_guess, items: [...], crops: {id: path}}`
  - item: `id`(P1, H1, C1, N1, F1 …), `type`(para, heading, caption, note, frag), `text`, `page`, `pages`, `bbox`, `level`, `notes`, `ref`, `table`, `equation`, `has_math`, `tex`, `embedded_image`
- `guide.json`: `meta`(title, author, source, genre, notes_lang, density, language, purpose, familiarity), `questions`, `thesis`, `overview`, `parts[]`(id, title, range, role, claim, claim_p, rel, flow, recall, skip)
- `paras_NN.json`: `{paras: {Pid: {tier, role, read, note, why, els[]}}}`, `els[]`: `t, a(verbatim anchor), x, s, term, tex, syms, why`
- `fixes.json`, `fixes_log.json`, `paragraphs.orig.json`, `crops/*.png`, `pages/pNNN.png`

이 계약이 앱과 파이프라인 사이의 경계다. 앱은 이 JSON을 읽고 쓰기만 하고, 해석 규칙은 Python 쪽 check.py가 책임진다.

### 2.3 한계 (이 프로젝트에서 보완할 점)

1. 해설 언어가 zh/en으로 고정 (`common.LANGS`, `check.DESCRIPTIVE`, `ZH_STYLE`, `EN_STYLE`).
2. 장르 규칙이 경제학·통계·ML 중심 (`genres.md`). biomedical 연구 설계별 기준 없음.
3. 워크플로가 대화형 agent를 전제 (SKILL.md step 0~6). 앱에서는 자동화가 필요.
4. 그림 해설이 약함: `fig` element는 "그림이 보여 주는 바를 말하는 문장"에 anchor를 거는 수준. 그림 자체(패널, 축, 범례)를 읽어 주는 해설은 없음.
5. 수식 해설은 `tex`, `syms`, `x`, `why`까지. 단계별 직관, 단위, 의학적 해석이 없음.
6. 사용자 annotation 영속 저장 없음. ID(P30)가 재분할 시 바뀌는 문제.
7. 숫자 검사 규칙 때문에 "예시 숫자로 설명하기"가 막혀 있음 (모든 숫자는 원문에 있어야 함).

---

## 3. 시스템 아키텍처

```
┌────────────────────────────── Electrobun v2 App ──────────────────────────────┐
│                                                                               │
│  Main process (Bun, TypeScript)                Webview (React + Vite)         │
│  ┌─────────────────────────────┐   typed RPC   ┌──────────────────────────┐   │
│  │ LibraryService (bun:sqlite) │◄────────────►│ Library / Import         │   │
│  │ JobRunner (state machine)   │  requests +   │ Processing (Stepper)     │   │
│  │ LLMService (Claude API)     │  messages     │ Reader (React renderer)  │   │
│  │ PipelineBridge ─────────────┼──┐            │ PDF pane (pdf.js)        │   │
│  │ AnnotationService           │  │            │ Settings                 │   │
│  │ SecretStore (Keychain)      │  │            └──────────────────────────┘   │
│  └─────────────────────────────┘  │                                           │
│                                   │ Bun.spawn (JSON lines over stdio)         │
│                    ┌──────────────▼──────────────┐                            │
│                    │ Python sidecar (pdfx)       │                            │
│                    │ segment / fix / crops /     │                            │
│                    │ check / render / sources    │                            │
│                    │ (+ optional MinerU)         │                            │
│                    └─────────────────────────────┘                            │
│                                                                               │
│  userData/                                                                    │
│   ├─ library.sqlite      (문서, 작업 상태, 사용자 annotation, 설정)               │
│   └─ docs/<doc_id>/      (원본 PDF, WORK 폴더: paragraphs.json, crops/, pages/,   │
│                           guide.json, paras_*.json, llm_log/, export.html)      │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 기술 스택

| 영역 | 선택 | 비고 |
| --- | --- | --- |
| 데스크톱 셸 | **Electrobun 2.0.x** (문서 기준 최신 2.0.6), 빌드 도구 **Hutch** | `build.mainProcess: "bun"` (2.0.6 기본값). 실험적 Cottontail 런타임은 쓰지 않음 |
| 렌더러 | macOS: `native`(WKWebView) 기본, 문제 시 `bundleCEF: true` | KaTeX·pdf.js 렌더 차이를 M1에서 검증 후 결정 |
| Main 언어 | TypeScript on Bun | `import ... from "electrobun/main"` (`electrobun/bun`은 deprecated alias) |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4 | ReUI README는 React 18+ 요구 |
| UI 컴포넌트 | shadcn/ui + **ReUI free primitives/examples** (MIT) | Radix 버전 사용(shadcn 기본과 일치). Base UI 버전도 존재 |
| 상태 관리 | Zustand (UI 상태) + TanStack Query (RPC 캐시) | |
| 수식 | KaTeX 0.16.x (`resources/assets/katex` 재사용) | |
| PDF 뷰 | pdf.js (`pdfjs-dist`, `react-pdf`) | 문단 bbox 하이라이트 |
| DB | `bun:sqlite` | WAL 모드 |
| Python | python-build-standalone 3.12 + `uv` | 앱에 런타임 동봉, 의존성은 첫 실행 시 설치 또는 동봉 wheel |
| LLM | Anthropic Claude API (TS SDK `@anthropic-ai/sdk`, Bun main에서 호출) | 모델 ID는 설정에서 선택. 기본안: 해설 작성 `claude-opus-5-5`, 보정·2차 검토·짧은 작업 `claude-sonnet-5-5`, 분류 보조 `claude-haiku-5-5` (구현 시 최신 ID 재확인) |
| 테스트 | pytest(기존), `bun test`, Playwright(웹뷰 UI를 Vite dev 서버에서) | |

### 3.2 프로젝트 구조

```
PDF_DIssector/
├─ docs/                         # 기존 문서
├─ resources/                    # 원본 저장소 스냅샷 (읽기 전용 참조, 수정 금지)
├─ implementation_plan.md
├─ app/
│  ├─ electrobun.config.ts
│  ├─ hutch.config.ts
│  ├─ package.json
│  ├─ src/
│  │  ├─ bun/                    # main process
│  │  │  ├─ index.ts             # 창 생성, RPC 등록, 메뉴
│  │  │  ├─ rpc/schema.ts        # 공유 RPC 타입 (webview와 공유)
│  │  │  ├─ library/             # SQLite 저장소, 마이그레이션
│  │  │  ├─ jobs/                # JobRunner, 단계 정의, 재시도/재개
│  │  │  ├─ llm/                 # Claude 클라이언트, 프롬프트, tool schema, 비용 집계
│  │  │  ├─ pipeline/            # Python sidecar 브리지
│  │  │  ├─ annotations/         # W3C Web Annotation 저장·재연결
│  │  │  └─ secrets.ts           # macOS Keychain (security CLI) 래퍼
│  │  └─ mainview/               # Vite 프로젝트 (React)
│  │     ├─ index.html
│  │     ├─ main.tsx
│  │     ├─ components/ui/       # shadcn + ReUI 생성 소스 (copy-and-own)
│  │     ├─ features/library/
│  │     ├─ features/processing/
│  │     ├─ features/reader/
│  │     ├─ features/settings/
│  │     └─ lib/rpc.ts           # Electroview 래퍼
│  └─ tests/
├─ engine/                       # Python sidecar 패키지 (pdfx)
│  ├─ pyproject.toml
│  ├─ pdfx/
│  │  ├─ __main__.py             # JSON-lines 명령 서버
│  │  ├─ vendor/lgr/             # resources/scripts 복사본 + 최소 패치
│  │  ├─ ko.py                   # 한국어 검사 규칙
│  │  ├─ biomed_checks.py        # biomedical 검사 확장
│  │  ├─ jats.py                 # PMC JATS/BioC 파서
│  │  └─ export.py               # render.py 래핑, JSON 데이터 출력
│  ├─ references/                # method/elements/schema/genres/review 확장판 (프롬프트 자산)
│  └─ tests/                     # 기존 tests/unit + 신규
└─ corpus/                       # 평가용 CC BY biomedical PDF 목록과 기대값
```

`resources/`는 상류 원본으로 남겨 두고 `engine/pdfx/vendor/lgr/`로 복사해 패치한다. 패치는 `engine/PATCHES.md`에 기록해 상류 업데이트를 다시 병합할 수 있게 한다.

---

## 4. Python 엔진 (pdfx sidecar)

### 4.1 실행 모델

- Main process가 `Bun.spawn([python, "-m", "pdfx", "serve"], {stdin: "pipe", stdout: "pipe"})`로 장기 실행 프로세스를 띄운다. (Electrobun 문서에 spawn 전용 API는 없으나 main이 Bun이므로 `Bun.spawn` 사용. M0에서 패키징된 앱 안에서 동작 확인.)
- 프로토콜: 한 줄에 JSON 하나. 요청 `{id, cmd, args}`, 응답 `{id, ok, result | error}`, 진행 이벤트 `{id, event: "progress", stage, pct, msg}`.
- 무거운 작업(segment, MinerU)은 별도 일회성 프로세스로 실행해 취소(kill) 가능하게 한다.
- 기존 스크립트는 CLI 진입점을 그대로 두고, `pdfx`는 함수 단위로 import해 호출한다. stdout 출력(자기점검 `自检` 줄 등)은 캡처해서 구조화한다.

### 4.2 명령 목록

| cmd | 내부 호출 | 출력 |
| --- | --- | --- |
| `probe` | 텍스트 레이어 검사, `mineru_backend.available()` | 페이지 수, 스캔 여부, MinerU 가능 여부 |
| `segment` | `segment.py` main (`--engine`, `--columns`, `--pages`) | `paragraphs.json`, `crops/`, 자기점검 신호 |
| `overlay` | `fix.overlay(pages)` | `pages/pNNN.png` (bbox+ID) |
| `apply_fixes` | `fix.apply` | 새 `paragraphs.json`, `fixes_log.json` |
| `fetch_open` | `sources.py` + 신규 `jats.py` | `sources.json` (그림, 표, 수식, 누락 단어) |
| `check` | `check.run_checks` | `{errors[], warns[], computed}` 구조화 |
| `build_data` | `render.build_data` | Reader용 JSON (React 렌더용) |
| `export_html` | `render.render` | standalone HTML |
| `dump` | `render.py --dump` | HTML에서 데이터 복구 |

### 4.3 엔진 확장 작업

1. **한국어 지원**
   - `common.LANGS = ("zh", "en", "ko")`
   - `check.DESCRIPTIVE["ko"]`: "이 문단은 …을 소개한다/설명한다/다룬다" 같은 기술(describe)형 문장 탐지
   - `KO_STYLE`: 번역투("~에 대해 ~를 진행하다", "~하는 역할을 하다", "~라고 할 수 있다"), 과도한 명사화, 부정 후 긍정("~가 아니라 ~이다"), 대시 연결 경고
   - 길이 제한: role 30자, read 120자, thesis 140자, claim 110자 (한글 기준, 사용하면서 조정)
   - 숫자 추출: 한글 수사("세 번째", "두 배", "절반")와 단위(명, 례, %, mg/kg) 처리 테스트 추가
   - 용어 규칙: 의학 용어는 첫 등장 시 `한국어(English)`, 이후 한 형태로 통일. 약어(HR, OR, CI, ITT, AUC)는 영어 유지
2. **biomedical 장르와 element**
   - `genres.md` 확장: `RCT`, `Cohort/case-control/cross-sectional`, `Systematic review & meta-analysis`, `Diagnostic accuracy`, `Basic/translational (wet lab, animal)`, `Computational/modeling (neuro, pharmacokinetics)`, `Narrative review`, `Case report`, `Methods/protocol`
   - 장르별 정독 기준(예):
     - RCT: primary outcome 정의, randomization·allocation concealment·blinding, 분석 집단(ITT/PP), 표본 크기 근거, 주요 효과 크기와 CI, adverse events, 저자가 인정한 limitation (CONSORT 항목과 대응)
     - 관찰연구: 노출·결과 정의, confounder 조정 모델, 민감도 분석, reverse causation 논의 (STROBE)
     - 메타분석: 검색 전략, 선정 기준, risk of bias, heterogeneity(I²), publication bias, GRADE (PRISMA)
     - 진단 연구: reference standard, spectrum, sensitivity/specificity/AUC와 threshold (STARD)
     - 동물·기초: 모델의 타당성, n과 독립 반복 수, 통계 단위(세포 vs 동물), 핵심 figure 패널 (ARRIVE)
     - 계산·모델: 모델 가정, 핵심 방정식, 파라미터 추정, 검증 방법
   - `elements.md`에 biomedical element 추가 (형식 `### code | English | 中文 | level | colour` 유지, 한국어 이름은 별도 매핑 파일):
     - `outcome` (주요/부차 결과 정의, level 3)
     - `design` (무작위 배정·눈가림·대조군, level 2)
     - `stat` (통계 모형·검정, level 2)
     - `effect` (효과 크기와 CI/p, level 3)
     - `bias` (bias·confounding 관련 서술, level 2)
     - `safety` (부작용, level 2)
3. **수식 해설 확장** (`formula` element 확장 필드, 모두 선택)
   - `steps[]`: 수식을 항(term) 단위로 나눠 설명 `{part: "\\beta_1 X", x: "..."}`
   - `intuition`: 직관적 의미 한두 문장
   - `units`: 단위·차원 설명
   - `clinical`: 이 수식이 결과 해석에 어떻게 쓰이는지
   - `illustrative`: 예시 계산. **원문에 없는 숫자가 들어갈 수 있으므로** check.py에서 숫자 검사 대상에서 제외하되, UI에 "설명용 가상 예시" 배지를 반드시 표시하고 원문 수치와 섞지 않는다.
4. **Figure/Table 해설 확장** (새 element `figx`, 캡션 ID에 부착)
   - `{t: "figx", cap: "C3", what: "이 그림이 답하는 질문", panels: [{label: "A", x: "..."}], axes: "...", look_for: ["..."], takeaway: "...", caveat: "..."}`
   - LLM이 crop 이미지(vision)와 캡션, 그림을 인용한 문단을 함께 보고 작성
   - 검사: `panels[].label`은 캡션에 존재하는 패널 라벨이어야 함, 수치는 캡션·인용 문단·표 본문에 있어야 함 (그래프에서 눈으로 읽은 값은 "약 ~" 표기 + `approx: true` 플래그, 숫자 검사에서 별도 경고 레벨)
5. **PMC 원문 연동** (`jats.py`)
   - DOI/PMID/PMCID를 `paragraphs.json` 첫 페이지에서 검출
   - NCBI E-utilities / PMC OA Web Service 또는 Europe PMC REST로 JATS XML 획득 (OA subset만, 라이선스 표시)
   - JATS에서 `<disp-formula>`의 MathML/TeX, `<table-wrap>` 구조, `<fig>` 고해상도 이미지 URL, 섹션 구조를 얻어 `sources.json` 형식으로 변환
   - 원칙은 원 코드와 같다: **본문 텍스트와 페이지 정보의 기준은 PDF**, 오픈 버전은 그림·표·수식과 누락 단어 보고에만 사용
6. **안정 ID (annotation 재연결용)**
   - 각 item에 `sid` 추가: `sha1(normalized_text[:200] + page)`의 앞 12자. P-번호는 표시용, `sid`는 저장용
   - 문서 버전 `doc_rev`(segment+fixes 해시)를 기록

---

## 5. AI 파이프라인 (Job Runner)

SKILL.md의 단계를 앱의 상태 머신으로 옮긴다. 각 단계는 입력·출력 파일이 정해져 있어 **중간부터 재개**할 수 있고, 모든 LLM 호출의 요청·응답은 `llm_log/`에 저장한다.

```
IMPORTED → BRIEFED → SEGMENTED → INSPECTED → FIXED → (OPEN_FETCHED)
        → UNDERSTOOD → GUIDE_DRAFTED → CHECKED → REVIEWED → FINAL → RENDERED
```

| # | 단계 | 실행자 | 입력 | 출력 | 실패 시 |
| --- | --- | --- | --- | --- | --- |
| 0 | Brief | 사용자 (UI 폼) | | `meta.purpose`, `familiarity`, `questions`, density | 기본값 |
| 1 | Probe & Segment | pdfx | PDF | `paragraphs.json`, crops | 자기점검 신호에 따라 `--columns 1/2/3` 재시도 → MinerU(설치 시) → 사용자에게 페이지 범위 지정 요청 |
| 2 | Inspect (시각 검수) | LLM (vision) | 1쪽, 마지막 본문 쪽, 자기점검 지목 쪽의 overlay PNG + 해당 쪽 item 목록 | `fixes.json` (모든 op에 `why`) | fixes 적용 오류 시 오류 메시지 피드백 후 1회 재작성 |
| 3 | Apply fixes | pdfx | fixes.json | 새 paragraphs.json, log | |
| 4 | Open version | pdfx | DOI/PMCID | sources.json | 네트워크 불가 시 건너뜀 |
| 5 | Understand | LLM | 전체 문단(파트 파일), 장르 규칙 | 장르, 파트 분할, thesis, overview, 파트별 claim/rel/flow (= `guide.json` 골격) | |
| 6 | Annotate paragraphs | LLM, 파트 단위 병렬(동시 2~4) | 파트 문단 + guide 골격 + method/elements/schema | `paras_NN.json` | |
| 6b | Equation & figure deep-dive | LLM (vision) | 수식 crop, 그림/표 crop + 캡션 + 인용 문단 | formula 확장 필드, `figx` | |
| 7 | Check loop | pdfx check → LLM 수정 | errors/warns | 수정된 JSON | 최대 3회. 남은 error는 해당 필드를 비우고 "검증 실패" 배지 |
| 8 | Second read | **별도 LLM 호출** (작성 맥락 없이 review.md brief 사용) | paragraphs, crops, guide | findings 목록 (`misleading`/`minor`) | |
| 9 | Fix findings & confirm | LLM 작성자 → 검토자 재확인 | findings | 수정 JSON | 확인 1회 반복 후 남은 것은 UI에 표시 |
| 10 | Build data | pdfx build_data | 전체 | Reader JSON | |

### 5.1 LLM 호출 설계

- **구조화 출력**: 모든 단계는 tool use(JSON schema)로 출력을 강제한다. schema는 `schema.md`를 JSON Schema로 옮겨 `engine/references/schemas/*.json`에 두고, TS 쪽 타입은 여기서 생성한다.
- **프롬프트 자산**: `method.md`, `elements.md`, `genres.md`, `review.md`를 한국어 해설 기준으로 확장해 system prompt에 넣는다. 원문 문단 전체는 문서 단위로 고정되므로 **prompt caching** 대상(파트별 호출 6단계에서 크게 절약).
- **원문 고정 원칙**: 원문은 절대 수정·번역하지 않으며, anchor `a`는 원문에서 그대로 복사. check.py가 실패하면 가장 가까운 문장을 피드백해 재작성.
- **비용 관리**: 원 개발자 시험에서 6쪽 논문에 약 134k 토큰 + 2차 검토 추가 비용이 들었다. 문서당 토큰·비용을 단계별로 집계해 Processing 화면과 라이브러리에 표시하고, 설정에서 상한(예: 문서당 $N)을 둔다. "빠른 모드"(2차 검토를 Sonnet로, 6b 생략) 제공.
- **API 키**: 사용자가 설정에서 입력, macOS Keychain에 저장. webview로는 절대 전달하지 않는다(LLM 호출은 main에서만).
- **개인정보**: PDF 원문이 Anthropic API로 전송됨을 첫 실행 시 고지.

### 5.2 사용자 상호작용 재생성

Reader에서 가능한 동작과 내부 처리:

| 동작 | 처리 |
| --- | --- |
| Tier 변경 (Skim ↔ Study) | `paras` 항목의 tier 수정 → close로 올리면 read/note/els를 LLM으로 보강 → check → 해당 문단만 갱신. 밀도 초과 시 경고만 |
| "더 쉽게" / "더 자세히" | 해당 문단(또는 수식/그림) 단일 재생성, familiarity 일시 변경 |
| 해설에 대해 질문 | 채팅 Sheet. 원문 문단을 먼저 인용하고 설명, 저자 주장과 AI 설명을 구분 (SKILL.md "While the user reads" 규칙) |
| 방법론 피드백 ("이런 문단은 항상 정독") | 사용자 규칙으로 저장 → 이후 문서의 프롬프트에 추가 (SKILL.md의 "Improving this skill"을 앱 설정으로 구현) |

---

## 6. UI 사양 (Electrobun + React + ReUI)

### 6.1 Electrobun 구성

`electrobun.config.ts` 골격(필드 이름은 v2 문서 기준, 구현 시 재확인):

```ts
import type { ElectrobunConfig } from "electrobun";

export default {
  app: { name: "PDF Dissector", identifier: "dev.anselm.pdfdissector", version: "0.1.0" },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "src/bun/index.ts" },
    copy: {
      "src/mainview/dist/index.html": "views/main/index.html",
      "src/mainview/dist/assets": "views/main/assets",
      "engine-dist": "engine",          // Python 런타임 + pdfx
    },
    mac: { codesign: true, notarize: true, createDmg: true, defaultRenderer: "native", bundleCEF: false },
  },
  scripts: { preBuild: "scripts/build-frontend-and-engine.ts" },
  release: { baseUrl: "https://<release-host>/pdf-dissector/" },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig;
```

- Vite가 `src/mainview/dist`에 빌드 → `build.copy`로 `views/main/`에 복사 → `url: "views://main/index.html"`.
- 렌더링된 crop·페이지 이미지는 `Utils.paths.userData` 아래에 있으므로 `allowedProtocols: { views: true, appData: true }`로 `appdata://` 접근 허용.
- 파일 열기: `Utils.openFileDialog({ allowedFileTypes: "pdf", allowsMultipleSelection: true })`. 내보내기 저장 위치는 문서상 save dialog가 없으므로 디렉터리 선택(`canChooseDirectory: true`)으로 대체.
- 완료 알림: `Utils.showNotification`. 파일 위치 보기: `Utils.showItemInFolder`.
- 업데이트: Electrobun `Updater` (v1과 같은 API), `release.baseUrl`에 `artifacts/` 전체 게시.

### 6.2 RPC 스키마 (요약)

```ts
export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      importPdfs:   { params: { paths?: string[] }; response: { docIds: string[] } };
      setBrief:     { params: { docId: string; brief: Brief }; response: void };
      startJob:     { params: { docId: string; from?: Stage }; response: { jobId: string } };
      cancelJob:    { params: { jobId: string }; response: void };
      listDocs:     { params: { query?: string; filters?: DocFilter }; response: DocSummary[] };
      getReader:    { params: { docId: string }; response: ReaderData };
      setTier:      { params: { docId: string; pid: string; tier: Tier }; response: ParaEntry };
      regenerate:   { params: { docId: string; target: RegenTarget; style: "simpler" | "deeper" | "redo" }; response: ParaEntry };
      askAbout:     { params: { docId: string; pid: string; question: string }; response: { streamId: string } };
      saveAnnotation:{ params: { docId: string; anno: WebAnnotation }; response: { id: string } };
      exportHtml:   { params: { docId: string; dir: string }; response: { path: string } };
      getSettings / setSettings / setApiKey / installMinerU ...
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      jobProgress: { jobId: string; stage: Stage; pct: number; msg: string; tokens: number; costUsd: number };
      jobDone:     { jobId: string; ok: boolean; error?: string };
      chatDelta:   { streamId: string; text: string; done: boolean };
    };
  }>;
};
```

Main: `BrowserView.defineRPC<AppRPC>({ handlers: {...} })` → `new BrowserWindow({ url: "views://main/index.html", rpc })`.
Webview: `Electroview.defineRPC<AppRPC>(...)` + `new Electroview({ rpc })`. Webview 쪽 import 경로(`electrobun/view`)는 v2 문서에서 일관되지 않아 M0에서 확인한다.

### 6.3 화면별 구성과 컴포넌트

ReUI는 shadcn registry로 소스를 복사해 들여오는 방식이다(`npx shadcn@latest add @reui/<name>`). Free primitives 27종과 예제 1,265개가 MIT로 무료이고, Pro block(App Shell, Rich Text Editor 등)은 쓰지 않는다. ReUI는 Next.js 기준으로 문서화되어 있고 Vite 지원이 명시되어 있지 않으므로, M0에서 Vite + Tailwind v4 + shadcn 초기화 후 대표 컴포넌트(Data Grid, Scrollspy, Tree) 설치를 먼저 검증한다.

**공통 셸**
- shadcn `Sidebar`(라이브러리 / 처리 중 / 설정), `Command`(⌘K: 문서·문단 ID·용어 검색), `Sonner`(토스트), `Tooltip`, `Dialog`, `Sheet`, `Resizable`
- 다크 모드, 본문 serif(원문) / 해설 sans 구분은 원 template의 타이포 원칙 유지

**① Library**
- ReUI `Data Grid`(TanStack Table 기반): 제목, 저자, 저널, 연도, 장르, 상태, 정독 비율, 비용, 추가일
- ReUI `Filters`: 장르, 상태, 태그
- ReUI `File Upload` 패턴: 드래그 앤 드롭 영역
- ReUI `Badge`: 상태(처리 중 / 검토 필요 / 완료), 장르
- ReUI `Alert`: API 키 미설정, MinerU 미설치 안내

**② Import & Brief**
- ReUI `Stepper`: 1) 파일 확인(페이지 수, 스캔 여부) 2) 읽는 목적 3) 친숙도 4) 질문 5) 시작
- shadcn `RadioGroup`, `Textarea`, ReUI `Number Field`(페이지 범위), `Autocomplete`(장르 수동 지정)

**③ Processing**
- ReUI `Timeline`: 단계별 시작·종료 시각, 토큰, 자기점검 결과, 재시도 기록
- shadcn `Progress`, ReUI `Code Block`(자기점검·check 출력 원문 보기)
- 검수 단계 overlay 이미지와 LLM이 만든 fixes 목록을 나란히 보여 주고, 사용자가 개별 fix를 끄고 재적용 가능

**④ Reader (핵심 화면)**

```
┌──────────────┬──────────────────────────────────────────┬──────────────┐
│ 좌측 margin   │ 본문 스트림                                 │ 우측 패널(토글) │
│ - 파트 Tree   │ [결론 한 문장] [논증 지도] [내 질문과 답]        │ - PDF 페이지   │
│ - 현재 파트    │ ── Part 2: Methods ──                      │   (bbox 강조)  │
│   claim       │ P12 [Study] read-for ▸ 원문(serif)           │ - 해설 채팅     │
│ - flow steps  │   ▸ 하이라이트 hover → 유형+설명               │ - 내 메모       │
│ - 용어         │   ▸ 수식 카드: KaTeX | crop | 기호표 | 단계별  │              │
│ - 진행률       │   ▸ 그림 카드: crop | 패널별 | 볼 것 | 결론     │              │
│              │   ▸ 읽은 뒤 요약 (접힘)                         │              │
│              │ P13 [Skim] 한국어 요약 ▸ 원문 펼치기             │              │
└──────────────┴──────────────────────────────────────────┴──────────────┘
```

- ReUI `Scrollspy`: 스크롤 위치에 따라 좌측 파트·flow step 동기화 (`template.html`의 `syncNav`, `markStep` 대체)
- ReUI `Tree`: 파트 → flow step → 문단 계층 탐색
- 논증 지도: 노드는 thesis와 parts, 엣지는 `rel`(supports, explains, qualifies, challenges, answers; qualifies는 점선). React Flow 또는 SVG 자체 구현 (원 template의 `layoutMap` 로직 포팅)
- shadcn `Toggle Group`: 보기 모드(전체 / 정독만 / 요약만), 해설 언어(ko/en)
- shadcn `Collapsible`, `Accordion`: 접힌 요약, skim 원문, 기호표
- shadcn `Tabs`: 수식 카드(해설 / 단계별 / 원본 crop / LaTeX), 그림 카드(해설 / 패널별 / 원본)
- shadcn `HoverCard`: 용어 정의, 문단 ID hover 시 role과 페이지
- ReUI `Rating`(선택): 해설 품질 피드백(👍/👎 대신 별점) → 사용자 규칙 학습에 사용
- 텍스트 선택 시 floating toolbar(하이라이트 색, 메모, "AI에게 묻기")
- 단축키: `j/k` 다음·이전 정독 문단, `s` tier 전환, `e` 해설 펼치기, `p` PDF 패널

**⑤ Settings**
- API 키, 모델 선택(작성/검토/보조), 기본 밀도, 해설 언어, 비용 상한
- MinerU 설치(약 0.8GB, 설치 진행을 Timeline으로), 렌더러 선택(native/CEF는 빌드 옵션이므로 정보만 표시)
- 사용자 방법론 규칙 목록(추가·삭제)

### 6.4 렌더링 방식 결정

- Reader 데이터는 `render.build_data()`가 만드는 구조를 그대로 받는다(하이라이트 오프셋 `hl`이 UTF-16 code unit 기준으로 계산되어 있어 JS `String.slice`와 바로 호환).
- `template.html`의 vanilla JS 로직(`paraNode`, `cropNode`, `renderMap`, `glossary`, `annotateTerms`, `withMath`)은 React 컴포넌트로 포팅하며, 포팅 전후 동일 문서의 DOM 텍스트 스냅샷을 비교하는 회귀 테스트를 둔다.
- Standalone HTML 내보내기는 `render.py` 그대로 사용하되 ko 레이블과 확장 element(figx, formula 확장 필드)를 template에 추가한다.

---

## 7. 데이터 저장과 사용자 Annotation

### 7.1 SQLite 스키마

```sql
documents(id TEXT PK, title, authors, journal, year, doi, pmid, pmcid, genre,
          status, doc_rev, page_count, created_at, updated_at, tokens_in, tokens_out, cost_usd)
briefs(doc_id PK, purpose, familiarity, density, notes_lang, questions_json)
jobs(id PK, doc_id, stage, status, started_at, finished_at, error, attempts)
llm_calls(id PK, job_id, stage, model, tokens_in, tokens_out, cache_read, cost_usd, log_path, created_at)
tier_overrides(doc_id, sid, tier, created_at, PRIMARY KEY(doc_id, sid))
annotations(id PK, doc_id, sid, body_json, target_json, created_at, updated_at, orphaned INTEGER)
user_rules(id PK, scope, text, created_at)       -- 방법론 피드백
settings(key PK, value)
```

가이드 데이터 자체는 파일(`guide.json`, `paras_*.json`)이 원본이다. DB에는 색인과 사용자 데이터만 둔다. 이렇게 하면 기존 Python 도구가 수정 없이 작업 폴더를 읽는다.

### 7.2 W3C Web Annotation 모델

```json
{
  "type": "Annotation",
  "motivation": "highlighting | commenting | questioning",
  "body": [{"type": "TextualBody", "value": "메모", "format": "text/markdown"}],
  "target": {
    "source": "doc:<doc_id>",
    "selector": [
      {"type": "TextQuoteSelector", "exact": "...", "prefix": "...(32자)", "suffix": "...(32자)"},
      {"type": "TextPositionSelector", "start": 120, "end": 168},
      {"type": "FragmentSelector", "value": "sid=<sid>"},
      {"type": "PdfBoxSelector", "page": 4, "bbox": [0.12, 0.33, 0.48, 0.36]}
    ]
  },
  "docRev": "<doc_rev>"
}
```

재연결 순서: `sid`+position 일치 → `sid` 안에서 TextQuote 검색 → 문서 전체 TextQuote 검색(prefix/suffix로 동점 해소) → 실패 시 `orphaned=1`로 표시하고 "위치를 잃은 메모" 목록에 보관. 가이드를 재생성하거나 fixes를 다시 적용해도 사용자 메모는 유지된다.

---

## 8. 패키징과 배포

- Python: python-build-standalone(arm64/x64) + `uv pip install --target`로 pdfplumber, fonttools, pillow, beautifulsoup4, lxml을 미리 설치해 `engine/`로 동봉 (약 60~90MB 예상). MinerU는 동봉하지 않고 설정에서 선택 설치(`pip install "mineru>=4,<5"` + `mineru-kit models download --tier basic`).
- macOS: Hutch로 서명·공증 (`ELECTROBUN_DEVELOPER_ID`, App Store Connect API key 환경변수). 동봉 Python 바이너리와 `.so`까지 서명 대상에 포함되는지 M6에서 확인.
- Electrobun은 현재 호스트용으로만 빌드되므로, 배포 대상(macOS arm64 우선, 이후 Intel/Windows/Linux)마다 CI runner가 필요하다.
- 업데이트: Electrobun Updater와 delta patch(`release.generatePatch`).
- 라이선스: 상류 MIT 고지, KaTeX MIT, ReUI MIT, MinerU는 사용자 설치(라이선스 링크 표시)를 `THIRD_PARTY_NOTICES.md`에 통합.

---

## 9. 검증 계획

### 9.1 평가 코퍼스

PMC OA subset의 CC BY 논문 20~30편을 `corpus/manifest.json`에 등록(PDF는 저장소에 넣지 않고 스크립트로 내려받음). 구성:

- RCT 4, 코호트/사례대조 4, 메타분석 3, 진단 정확도 2, 동물·기초실험 4, 계산신경과학/모델링 4(수식 많음), narrative review 3, 2단·3단·Cell/Nature형 복잡 레이아웃 포함, 스캔 1~2

### 9.2 지표

| 영역 | 지표 | 목표(v1) |
| --- | --- | --- |
| 분할 | 문단 경계 F1(사람이 표시한 정답 대비), 러닝헤드 혼입 0 | F1 ≥ 0.95 |
| 캡션 | 그림/표 캡션 검출률, crop 완전성 | ≥ 95% |
| 수식 | crop 대비 LaTeX 일치(사람 검토) | ≥ 90% 문자 수준 일치 |
| 가이드 | check.py error 0, 2차 검토 misleading 0 | 100% 문서 |
| Tier | 연구자(사용자) 표시 정독 문단과의 일치(recall 우선) | recall ≥ 0.8 |
| Annotation | fixes 재적용 후 메모 재연결률 | ≥ 98% |
| 비용 | 10쪽 논문당 토큰·비용, 처리 시간 | 측정 후 기준 설정 |

### 9.3 테스트

- 기존 `tests/unit` 39개 파일을 그대로 CI에서 실행(벤더 패치가 회귀를 만들지 않음을 보장)
- 신규: ko 문체 검사, biomedical element 검사, `figx` 검사, JATS 파서, sid 안정성, sidecar 프로토콜
- TS: RPC 핸들러, JobRunner 재개, annotation 재연결(`bun test`)
- UI: Vite dev 서버 + mock RPC로 Playwright 스냅샷(Reader 핵심 상태)
- LLM 단계: 녹화된 응답(`llm_log`)으로 재생하는 결정적 테스트, 실제 API는 야간 소규모 평가로만

---

## 10. 마일스톤

각 마일스톤은 동작하는 결과물과 완료 기준을 갖는다.

### M0. 기술 검증 (스파이크)
- Electrobun 2.0.x + Hutch 초기화, Vite/React/Tailwind v4/shadcn 초기화, ReUI `data-grid`, `scrollspy`, `tree` 설치 확인
- `views://` 로드, typed RPC 왕복, `appdata://` 이미지 표시, native 렌더러에서 KaTeX·pdf.js 정상 표시
- 패키징된 앱에서 `Bun.spawn`으로 동봉 Python 실행, segment.py를 샘플 PDF에 실행
- Webview `Electroview` import 경로 확인
- **완료 기준**: 서명 안 된 dev 빌드에서 PDF → paragraphs.json → 문단 목록 표시

### M1. 엔진 sidecar
- `engine/pdfx` 패키지, 벤더 복사, JSON-lines 서버, 명령 9종
- `sid`, `doc_rev` 추가, 기존 테스트 통과
- **완료 기준**: 코퍼스 전체에 segment 실행, 자기점검 결과 수집 리포트

### M2. 앱 골격
- Library(Data Grid, Filters, File Upload), Import & Brief(Stepper), Settings(API 키 Keychain 저장)
- SQLite 스키마와 마이그레이션, JobRunner 상태 머신(단계 재개, 취소)
- Processing 화면(Timeline)
- **완료 기준**: PDF 가져오기 → 분할 → 결과 확인까지 UI로 완결

### M3. AI 파이프라인 v1 (기존 방법론 그대로, 한국어 해설)
- ko 언어 지원(common/check 확장), JSON Schema, 프롬프트 자산
- 단계 2(시각 검수)~9(2차 검토) 구현, prompt caching, 비용 집계
- **완료 기준**: 코퍼스 5편에서 check error 0, 2차 검토 수행, standalone HTML 내보내기 성공

### M4. Reader
- build_data 기반 React 렌더러: 논증 지도, 좌측 margin(Scrollspy+Tree), 문단 카드, 하이라이트, 용어 hover, recall 질문, 보기 모드 전환
- 수식 카드(KaTeX + crop + 기호표), 그림 카드(crop), PDF 패널(bbox 강조)
- **완료 기준**: template.html과 동일 문서에서 텍스트 스냅샷 일치, 주요 상호작용 Playwright 통과

### M5. Biomedical 확장과 수식·그림 해설 심화
- genres/elements 확장, biomedical 검사, 수식 확장 필드(steps, intuition, units, clinical, illustrative), `figx`
- JATS/Europe PMC 연동
- **완료 기준**: 코퍼스 전체에서 장르 분류 정확, RCT·메타분석의 체크포인트 문단이 정독으로 선택(사람 검토), 그림 해설 패널 라벨 검사 통과

### M6. 사용자 상호작용과 annotation
- Tier 변경과 부분 재생성, "더 쉽게/더 자세히", 문단 질문 채팅(스트리밍)
- W3C annotation 저장·재연결, 사용자 방법론 규칙
- **완료 기준**: fixes 재적용 후 메모 재연결률 ≥ 98%, tier 변경 후 check 통과

### M7. 배포
- python-build-standalone 동봉, MinerU 선택 설치 UI, 서명·공증, DMG, Updater
- 첫 실행 안내(데이터 전송 고지, API 키), 오류 보고(로컬 로그 내보내기)
- **완료 기준**: 깨끗한 macOS에서 DMG 설치 후 코퍼스 논문 1편 처리 완료

### 이후 후보 (v2)
- 문단 단위 한국어 번역 레이어(원문 옆 병렬), 번역 교체 시 annotation 유지
- Supplementary material 연결, 참고문헌 클릭 시 PubMed 조회
- Zotero 연동(가져오기·메모 내보내기)
- 사용자 tier 수정 이력으로 개인화된 정독 기준 학습

---

## 11. 위험과 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| Electrobun v2는 출시 직후이고 문서가 일부 불일치(Electroview import 경로, views 폴더 명명) | 초기 개발 지연 | M0에서 가장 먼저 검증, Electrobun 버전을 `hutch.config.ts`에 고정 |
| ReUI의 Vite 지원 미명시, Tailwind v3/v4 표기 혼재 | 컴포넌트 설치 실패 | M0 검증. 실패 시 해당 컴포넌트만 shadcn 기본 + 자체 구현 |
| WKWebView에서 KaTeX/pdf.js 렌더 차이 | 수식·PDF 표시 품질 | 문제 시 `bundleCEF: true`로 전환(앱 크기 증가 감수) |
| LLM 비용과 처리 시간(논문당 수십만 토큰) | 사용성 | prompt caching, 파트 병렬, 빠른 모드, 비용 상한, 단계 재개 |
| 숫자 검사 규칙과 "친절한 예시 설명"의 충돌 | 해설 품질 | `illustrative` 필드 분리 + UI 배지 + 원문 수치와 분리 표시 |
| 그림을 눈으로 읽은 수치의 부정확성 | 오해 유발 | `approx` 플래그, "약" 표기, 2차 검토 항목에 그림 수치 추가 |
| segment.py가 biomedical 특유 레이아웃(Cell형 사이드바, 그림 사이 본문)에서 실패 | 문단 오류 | 시각 검수 단계 강화, MinerU 권장 안내, JATS 원문 있으면 구조 비교로 경고 |
| 동봉 Python의 서명·공증 문제 | 배포 실패 | M0에서 서명된 테스트 빌드로 조기 확인 |
| 저작권: 논문 원문을 외부 API로 전송, 내보낸 HTML에 원문 포함 | 법적·개인정보 | 첫 실행 고지, 내보내기 시 "개인 학습용" 안내, OA 라이선스 정보 표시 |
| 상류 저장소의 빠른 변경(v0.8.0, 규칙 자주 변경) | 병합 비용 | 벤더 패치를 최소화하고 `PATCHES.md`로 관리, 확장은 별도 모듈(ko.py, biomed_checks.py) |

---

## 12. 구현 착수 전 결정이 필요한 사항

1. **LLM 제공자**: Claude API 직접 호출(사용자 API 키)로 설계했다. Claude Code/Agent SDK를 로컬에서 실행하는 방식(구독 사용)도 가능하지만, 앱 배포 시 사용자 환경 의존성이 커져 기본안에서 제외했다.
2. **해설 언어**: 기본 한국어, 영어 병기는 선택. 원문 번역은 v2.
3. **Tier 표시**: 2범주(정독/Skim, skip은 Skim의 하위 표기)로 설계했다. 3단계를 그대로 보여 주길 원하면 설정 기본값만 바꾸면 된다.
4. **배포 대상**: macOS arm64를 1차 대상으로 했다.
5. **번들 식별자**: 예시로 `dev.anselm.pdfdissector`를 적었다. 실제 값은 정해 주면 반영한다.

---

## 부록 A. 참고한 자료

- `docs/Literature Guide Read.md` (본 프로젝트 기준 문서)
- `resources/SKILL.md`, `references/method.md`, `schema.md`, `elements.md`, `genres.md`, `review.md`, `CHANGELOG.md` (v0.8.0)
- Electrobun v2: 블로그 "Electrobun 2.0", Migrating to v2, Changelog v2.x, BrowserView, Electroview, Build configuration, Utils, Paths, Code signing (docs.electrobun.dev, 2026-11-20 확인)
- ReUI: reui.io/components, reui.io/docs, reui.io/llms.txt, github.com/keenthemes/reui README (2026-11-20 확인)
- W3C Web Annotation Data Model (TextQuoteSelector, TextPositionSelector)
- 보고 지침: CONSORT, STROBE, PRISMA, STARD, ARRIVE
