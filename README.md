# PDF Dissector

Biomedical 논문 PDF를 읽기 순서가 복원된 문서로 바꾸고, 문단마다 **정독 / Skim**을 나눈 뒤 정독 문단에 한국어 해설(수식·그림 해설 포함)을 붙이는 macOS 데스크톱 앱입니다. 설계는 [implementation_plan.md](implementation_plan.md)를 따릅니다.

## 구성

| 폴더 | 내용 |
| --- | --- |
| `resources/` | 상류 원본 literature-guide-read v0.8.0 (수정하지 않음) |
| `engine/` | Python sidecar `pdfx`. `pdfx/vendor/lgr/`에 상류 복사본 + 최소 패치([engine/PATCHES.md](engine/PATCHES.md)), 한국어 검사(`ko_rules.py`), biomedical 검사(`biomed_checks.py`), PMC JATS 연동(`jats.py`), 안정 ID(`sid.py`), JSON-lines 서버(`__main__.py`) |
| `engine/references/` | 프롬프트 addendum (한국어 해설·biomedical 규칙) |
| `app/` | Electrobun 2.0.7 앱. `src/bun/` 메인 프로세스(SQLite 라이브러리, JobRunner, Claude 클라이언트, 엔진 브리지, Keychain), `src/mainview/` React UI(라이브러리, 브리핑, 처리 과정, Reader, 설정), `src/shared/` RPC 타입 |
| `corpus/` | 평가용 CC BY 논문 목록 (`bun corpus/fetch.ts`로 내려받기) |

## 개발

```bash
cd engine && uv sync                 # Python 엔진 환경 (.venv)
cd app && bun install && hutch electrobun prepare
```

```bash
cd app && hutch run dev:hmr          # Electrobun 창 + Vite HMR
```

브라우저에서 UI만 개발할 때는 백엔드를 HTTP로 띄웁니다.

```bash
cd app && bun src/bun/devServer.ts --port 5174   # RPC + 파일 서버 (token: dev)
cd app && bunx vite                               # http://localhost:5173
```

API 비용 없이 화면을 채워 보려면 `bun scripts/demo-seed.ts <pdf> --data <폴더>`로 데모 문서를 만든 뒤 같은 `--data`로 devServer를 띄웁니다.

## 테스트

```bash
cd engine && .venv/bin/python -m pytest      # 상류 테스트 + pdfx 테스트
cd app && bun test tests && bunx tsc --noEmit
```

`app/tests/pipeline.test.ts`는 실제 엔진에 녹화형(Replay) LLM을 붙여 가져오기 → 처리 10단계 → Reader → tier 변경 → 메모 → HTML 내보내기를 끝까지 돌립니다.

## 빌드

```bash
cd app && hutch run build:canary    # vite build + engine 동봉(scripts/build-engine.ts) + electrobun build
```

`scripts/build-engine.ts`는 uv가 설치한 python-build-standalone 3.12와 의존성(pdfplumber 등)을 `engine-dist/`에 모읍니다(약 107MB). 서명·공증은 `ELECTROBUN_DEVELOPER_ID` 등 환경변수가 있어야 합니다.

## 사용

1. 설정에서 Anthropic API 키를 넣습니다 (macOS 키체인에 저장).
2. 라이브러리에 PDF를 끌어다 놓고, 읽는 목적·친숙도·질문을 답합니다.
3. 처리 화면에서 단계별 진행·비용·검수 결과를 봅니다. 실패하면 그 단계부터 다시 돌릴 수 있습니다.
4. Reader: 논증 지도, 좌측 margin(파트·추론 단계·용어), 정독/Skim 문단, 수식 카드(KaTeX·crop·기호표·단계별), 그림 카드, PDF 패널(문단 위치 표시), 질문 채팅, 하이라이트·메모. 단축키 `j/k` 다음·이전 정독, `s` 정독 전환, `e` 원문 펼치기, `p` PDF.
