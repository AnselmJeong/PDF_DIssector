# **Literature Guide Read: PDF 논문을 지능형 HTML Reader로 만드는 기술 분석**

분석 대상: [Liangzhen-Chen/literature-guide-read (GitHub)](https://github.com/Liangzhen-Chen/literature-guide-read?utm_source=chatgpt.com)

이 저장소는 우리가 그동안 논의했던 **PDF 논문을 HTML로 변환하고, 본문의 특정 위치에 AI 해설을 연결하는 문제**에 상당히 실용적인 해답을 제시한다.

특히 주목할 부분은 단순한 PDF 변환 성능보다 **문서를 재구성하는 방식 자체를 바꾸었다는 점**이다.

기존 접근은 PDF의 복잡한 레이아웃을 HTML에서 얼마나 정확하게 재현하느냐에 집중했다. 이 프로젝트는 반대로 원문의 읽기 순서와 의미 구조를 복원하고, 각 문단에 고유한 식별자를 붙인 다음, AI가 그 구조를 해석하여 독서 지침을 추가한다.

또한 문단별 중요도를 세 단계로 분류한다.

- **Close read:** 원문을 반드시 읽어야 하는 문단. 핵심 주장, 방법론, 결정적인 근거, 중요한 제한점 등이 해당한다.
- **Skim:** AI가 제공하는 축약 설명을 읽고 지나가도 되는 문단.
- **Skip:** 반복, 단순한 연결 문장 등 생략해도 되는 문단. 원문은 삭제하지 않고 접어둔다.

실제 프로젝트의 HTML 결과물

[GitHub - alienzhou/web-highlighter: ✨ A no-runtime dependency lib for text highlighting & persistence on any website ✨🖍️](https://images.openai.com/static-rsc-4/e2wRICwj_NnAziCNppic9GT4mMz21RPmdBuI0FuPjcLJ2jGejaJq6BPgg64g-GQb3NXnYTIMzK7A3-b0VltVF_xI-mi_tHYFdkkVMtVo8N8Tioc7MIV-oYyP2Djar8WC6G_Kb4qEvFD6g_I7_GhJO791M-3HT28lP6OwnGbNNS4?purpose=inline)

[Ioannidis 논문 예제](https://liangzhen-chen.github.io/literature-guide-read/?utm_source=chatgpt.com)

[How to use this website - Zhenyu Ren's Website](https://images.openai.com/static-rsc-4/HWUGuVa-caxLPcERqneAIiqEjbZU3rAYQCrPUEnIWkZlvXrxOlViY4aWcIn1LlG1RIksuOw8igD6BaLYFa0NEVmd-FOcnRpdinfWZLTmPN5Nx2JhBocBMjbhqsWXdBHVmqYh9w10q30xAgPicxHWrVB3rCaftzsCsUv-qn66aUY?purpose=inline)

논문별 논증 구조와 문단별 가이드

원문은 유지하면서 AI 설명을 시각적으로 구분하고, 논증 지도(argument map), 수식 해설, 주요 용어, 복습 질문을 함께 표시한다. 

GitHub+1



**초기 판단:** 이것은 새로운 PDF 파싱 알고리즘의 발견이라기보다, 기존 PDF 추출 기술과 LLM을 결합하는 수준에서 이루어진 중요한 *workflow-level innovation*이다. 특히 원문과 AI 해설을 동일한 문단 ID에 연결하는 구조는 기존 PDF reader에 도입할 가치가 높다.

다만 여기서 말하는 annotation은 주로 AI가 생성한 독서 가이드다. 사용자가 밑줄을 긋거나 코멘트를 작성하고 영속적으로 저장하는 annotation 시스템까지 완성된 것은 별도로 구분해야 한다.

## **1. PDF를 어떻게 HTML로 변환하는가?**

실제 코드를 확인해 보니, 예상했던 것보다 PDF 처리 부분이 훨씬 정교하다.

핵심은 `scripts/segment.py`이다. 약 5,100줄의 Python 코드로, 단순히 pdfplumber에서 텍스트를 추출하는 수준을 넘어 상당한 양의 자체 레이아웃 처리 로직을 구현하고 있다.

저장소에서 확인한 실제 처리 구조

**원본 PDF**

논문 원문 및 페이지 좌표

**pdfplumber**

기본 엔진. 문자, 폰트, 좌표, 컬럼

**MinerU**

선택적 엔진. OCR, 표, 수식, 복잡한 배치

**Segmentation + Visual Correction**

읽기 순서 복원 · 문단 구분 · 위치 검증

**paragraphs.json**

P1, P2, P3 … · 본문 · 페이지 · bbox

**LLM + Reading Skill**

논증 분석 · 중요도 분류 · 근거 연결 · 검증

**guide.json**

논증 구조, 핵심 주장

**paras****_*********.json**

문단별 해설, 중요도

**Standalone HTML Reader**

원문 · AI 가이드 · 강조 · 그림 · 수식 · 탐색

### **A. 레이아웃 복원은 어떻게 해결하는가?**

`segment.py`는 PDF의 실제 문자 좌표와 폰트 특성을 조사한다. 이후 컬럼 경계를 추정하고, 제목·본문·각주·표·캡션을 분리한다.

특히 흥미로운 것은 자동 컬럼 감지에 실패했을 때의 처리다.

코드의 `choose_columns()` 함수는 레이아웃 이상 신호가 발견되면 1단, 2단, 3단 구성을 다시 시도한다. 그리고 `layout_signals()`로 문단 분리 오류, 비정상적으로 긴 문단, 잘못 배치된 각주 등을 평가해 상대적으로 나은 결과를 선택한다.

또한 폰트 인코딩이 잘못된 PDF에서 대소문자, 합자(ligature), 하이픈, 특수 문자 등이 깨지는 문제까지 자체적으로 보정한다.

이러한 기능은 별도의 학습 모델에만 의존하는 것이 아니라 상당 부분 규칙 기반의 분석이다.

더 중요한 것은 **문단 추출 결과를 AI가 시각적으로 다시 검토한다는 점**이다.

`fix.py`는 PDF 페이지 이미지에 문단별 bounding box와 ID를 표시한다. Agent는 실제 페이지를 보고 잘못 분리된 문단, 누락된 캡션, 본문에 섞인 머리말 등을 찾아 명시적인 수정 지시를 작성한다.

그 수정 작업은 `type`, `join`, `split`, `move`, `region` 등의 연산으로 기록되므로 재현할 수 있다.

즉, 일회성 PDF 변환이 아니라 *추출 → 시각적 검사 → 구조 보정*의 반복 가능한 과정이다.

### **B. 표와 수식은 어떻게 처리하는가?**

기본 모드에서는 표와 수식을 완벽한 HTML로 재구성하려 하지 않는다. 필요한 부분을 PDF에서 이미지로 잘라 보관한다. 수식은 AI가 LaTeX로 전사하여 KaTeX로 표시하고, 원본 수식 이미지를 함께 보여준다.

MinerU를 사용하면 복잡한 표의 구조적 추출과 수식 인식, 스캔 OCR을 추가할 수 있다. 개발자가 명시적으로 제공하는 두 단계의 추출 방식이다. 

GitHub+1



또 한 가지 눈에 띄는 것은 `sources.py`이다. arXiv에 HTML 또는 TeX 원본이 존재한다면 해당 원본에서 정돈된 그림, 표, 수식을 얻는다. PDF는 여전히 본문과 페이지 정보의 기준으로 유지한다.

이 접근은 의학 논문에도 응용할 수 있다. 다만 arXiv보다 PubMed Central의 JATS XML이나 BioC 형식이 더 유용하다. 적법하게 이용할 수 있는 XML 원문이 있으면 PDF 추출 오류를 상당 부분 피할 수 있다. 

ncbi.nlm.nih.gov+1



여기서 한 가지 분명히 해야 한다. 이 저장소는 **원본 PDF의 시각적 조판을 완벽하게 HTML로 복제하는 기술은 아니다.** 읽기 좋은 흐름형 HTML로 재조판하고, 복잡한 자료는 원본 crop 또는 페이지 이미지로 보완한다.

이것이 우리가 추구했던 논문 독서 방식에는 오히려 더 적합하다.

## **2. 진짜 차별점: 문단별 AI 독서 가이드**

프로젝트의 핵심은 `references/method.md`에 정의되어 있다.

중요한 것은 AI에게 무작정 "핵심 문단을 골라라"라고 지시하지 않는다는 사실이다. 구체적인 **분류 규칙, 사용 목적, 논문의 종류, 독서 밀도**를 모두 정의하고 있다.

| 구분      | Close read로 선택하는 기준                 |
| --------- | ------------------------------------------ |
| 핵심 주장 | 논문의 중심 주제나 각 부분의 결론          |
| 개념      | 이후 논증에 필요한 정의와 구별             |
| 방법      | 연구 설계, 모델, 주요 가정                 |
| 근거      | 중심 주장에 대한 결정적인 실험·관찰 결과   |
| 제한점    | 결과의 적용 범위를 바꾸는 조건, 예외, 반론 |
| 수식      | 논증에 필수적인 모델과 추정식              |

특히 중요한 것은 limitations와 반론을 Close read 대상으로 취급한다는 점이다. 단순히 결론의 강한 문장만 강조하지 않는다.

사용 목적에 따라 판단 기준도 달라진다. 논문의 전체 논증을 이해하려는 독자에게는 이론과 근거를 모두 중요하게 취급하지만, 방법론만 조사하는 독자에게는 설계와 통계적 가정을 우선시한다.

또한 처음 읽는 사람에게는 용어 정의를 더 많이 제공하고, 전문가에게는 불필요한 설명을 줄인다.

**읽기 밀도(density)**는 세 가지로 설정된다.

Low

15%

Medium

25%

High

40%

전체 문단 중 Close read 권장 상한. 실제 `check.py`는 초과 시 오류가 아니라 경고를 발생시키므로 강제 제한은 아니다.

이 설계가 독창적이다. AI가 논문의 중요도를 평가하면서도 **사용자의 독서 목적에 따라 한정된 주의 자원을 분배하도록** 만든다.

다만 이 숫자 자체가 과학적으로 검증된 최적 비율이라는 의미는 아니다. 개발자가 선택한 독서 가이드 설계값이다.

### **논문의 논증 구조까지 추적한다**

개별 문단의 중요도 평가에서 끝나지 않는다.

`guide.json`에는 각 부분의 주장(`claim`), 논증 단계(`flow`), 다른 부분과의 논리 관계(`rel`)가 기록된다.

논리 관계에는 `supports`, `explains`, `qualifies`, `challenges`, `answers` 등이 사용된다.

예를 들어 어떤 연구의 결과가 중심 주장을 뒷받침한다면 `supports`, 특정 결과가 설명의 적용 범위를 좁힌다면 `qualifies`로 연결하는 식이다.

이 덕분에 화면 왼쪽의 탐색 패널은 단순 목차가 아니라 **논문의 argument graph**를 보여줄 수 있다.

여기서 논문을 단지 정보의 집합으로 보지 않고, 주장과 근거가 연결된 지적 구조로 해석한다는 점이 중요하다.

## **3. Annotation이 가능한 이유: Verbatim anchoring**

우리가 기존 PDF→HTML 프로젝트에서 겪었던 가장 어려운 문제 중 하나는 AI 해설이나 사용자 annotation을 원문의 정확한 위치에 연결하는 것이었다.

이 프로젝트는 매우 직관적인 방법을 사용한다.

먼저 원문 문단마다 `P1`, `P2`, `P3` 같은 ID를 부여한다. 이후 AI는 각 문단에 대한 해설 데이터를 별도로 작성하되, 필요한 강조 구절은 원문에서 정확히 복사하도록 한다.

실제 데이터 구조를 단순화하면 다음과 같다.

```
{
  "P30": {
    "tier": "close",
    "role": "Main finding",
    "read": "Examine the comparison between groups.",
    "note": "Summary of the reported result.",
    "els": [
      {
        "t": "claim",
        "a": "Exact phrase copied from the paper",
        "x": "Explanation of this claim"
      }
    ]
  }
}
```

여기서 `a`는 anchor이다. `check.py`는 해당 문자열이 실제 원문에 존재하는지 검사한다. 존재하지 않는 인용구를 AI가 작성하면 오류가 발생한다.

또한 AI 해설에 등장하는 숫자가 관련 원문에 존재하는지도 검사한다. 이것은 단순한 JSON schema 검증보다 한 단계 발전한 source-grounded validation이다.

이후 `render.py`는 원문을 그대로 보여주는 영역과 AI가 작성한 설명을 분리하고, anchor에 해당하는 문자열에 시각적 강조를 적용한다.

따라서 HTML 문서를 만든 뒤 AI가 DOM을 임의로 조작하는 방식보다 훨씬 통제하기 쉽다.

### **다만 영속적 annotation에는 한 단계가 더 필요하다**

실제 `assets/template.html`을 조사해 보니 사용자 텍스트 선택을 저장하는 `localStorage`, `IndexedDB`, 사용자 코멘트 편집 기능은 구현되어 있지 않다.

즉, **AI가 문단에 자동으로 부착하는 annotation은 구현되었지만, 사용자가 지속적으로 축적하는 연구용 annotation은 아직 개발 대상**이다.

이를 확장할 때는 W3C Web Annotation Data Model을 적용하는 것이 좋다.

특히 `TextQuoteSelector`는 선택한 문자열과 그 앞뒤 문맥을 함께 저장한다. 문서가 재조판되어도 원문 위치를 다시 찾는 데 유용하다. 

w3.org+1



원래 저장소의 `P30`처럼 순서에 의존하는 ID만 저장하면, 문단 추출을 다시 실행했을 때 기존 annotation이 다른 문단으로 옮겨갈 위험이 있다. 따라서 문서 버전, 고유 문단 ID, 원문 인용구, 문자 위치, PDF 좌표를 함께 관리해야 한다.

## **4. 기술적 breakthrough를 어떻게 평가해야 하는가?**

| 기술 요소              | 평가                | 이유                                             |
| ---------------------- | ------------------- | ------------------------------------------------ |
| PDF 레이아웃 분석      | 상당한 자체 구현    | 대규모 휴리스틱 파서, 시각적 보정, 선택적 MinerU |
| PDF→HTML 조판          | 실용적인 구현       | 고정 레이아웃 복제 대신 의미 중심 재조판         |
| 문단별 중요도 구분     | 가장 가치 있는 부분 | 명시적 분류 기준과 사용자 목적별 우선순위        |
| 논증 구조 복원         | 중요한 차별점       | 주장·근거·반론·제한점의 연결                     |
| AI 해설의 원문 연결    | 강점                | 문단 ID 및 원문 인용구 검증                      |
| 정확성 검증            | 비교적 정교함       | 숫자 검사, 인용구 검사, 독립적인 second read     |
| 사용자 annotation 저장 | 미구현              | 영속 저장과 재연결 기능이 별도로 필요            |
| 한국어 번역 Reader     | 미구현              | 영어·중국어 가이드 중심, 원문 번역 기능은 없음   |

특히 `references/review.md`는 상당히 중요한 장치다. 별도의 agent가 작성된 가이드를 다시 읽으면서 통계적 방향, 결과의 유의성, 과장된 인과관계, 저자의 유보적 표현이 누락되었는지 검토하도록 한다.

그러나 자동화된 숫자 일치 검사는 통계적 의미까지 검증하지 못한다. 논문에 실제로 등장하는 숫자라도 잘못된 그룹에 배정할 수 있기 때문이다. 그래서 두 번째 검토가 여전히 필요하다.

또한 저장소가 제공하는 것은 주로 개발자 사례와 테스트이지, 다양한 의학 논문에서 Docling 또는 MinerU보다 정확하다는 독립적인 성능 평가가 아니다.

## **5. 기존에 검토했던 Docling과 어떻게 결합할 것인가?**

현재의 Docling은 이미 계층적 문서 구조, provenance, bounding box 등을 포함하는 `DoclingDocument`를 제공하고, HTML로도 내보낼 수 있다. 

Docling+1



최근 PyMuPDF4LLM도 문단과 표·그림의 요소 ID, 위치, 구조적 청크를 제공한다. 따라서 **굳이 Literature Guide Read의 5,000줄 이상 되는 PDF 파서를 통째로 가져올 필요는 없다.** 

GitHub+1



기존 Reader를 확장한다면 다음 구조를 권장한다.

**PDF / PMC JATS XML**

가능하면 구조화된 학술 원문 우선

**Docling 또는 MinerU**

OCR · reading order · tables · formulas

**Canonical Article Model**

sections · paragraphs · figures · tables · stable IDs · provenance

**Translation**

원문 문단에 연결된 한국어 번역

**Reading Skill**

중요도, 논증 지도, 방법론 해설

**Interactive HTML Reader**

Original / Translation / Guided Reading

**Persistent Annotation Database**

User highlights · comments · AI notes · source anchors

이 구조에서는 원문 PDF, 논문의 의미 구조, 한국어 번역, AI 해설, 사용자의 annotation이 별도의 계층으로 관리된다.

장점은 어느 한 계층을 수정하더라도 다른 데이터를 다시 생성하지 않아도 된다는 것이다.

예를 들어 AI 가이드가 마음에 들지 않아 다시 작성하더라도 사용자의 annotation은 유지된다. 번역 엔진을 변경해도 원문에 부착된 코멘트를 보존할 수 있다.

## **6. 의학 논문에 적용하려면 무엇을 보완해야 하는가?**

여기에는 한 가지 중요한 문제가 있다.

Literature Guide Read의 분류 규칙은 주로 경제학, 통계학, 머신러닝 논문을 대상으로 개발되었다. 정신의학이나 임상시험 논문에서는 중요한 문단을 선택하는 기준을 다르게 정의해야 한다.

예를 들어 무작위 임상시험에서는 Introduction의 주요 주장보다 연구의 primary outcome, randomization, allocation concealment, 분석 집단, effect size와 confidence interval, adverse events가 더 중요한 경우가 많다.

체계적 문헌고찰에서는 개별 연구의 설명보다 검색 전략, 선정 기준, risk of bias, 이질성, publication bias, certainty of evidence가 중요해진다.

가설적·이론적 논문에서는 다시 논증의 전제, 실증적 근거와 이론적 추론의 구별, 반증 가능성 등이 중심이 된다.

따라서 기존 `genres.md`와 `method.md`를 확장하여 **임상시험, 관찰연구, 메타분석, narrative review, theoretical paper별 독서 프로파일**을 만드는 것이 좋겠다.

또한 중요도 분류에 사용자가 개입할 수 있어야 한다. AI가 Skim이라고 판단한 방법론 문단을 사용자가 Close로 변경할 수 있고, 이후 사용자 선호에 맞춰 가이드를 다시 생성할 수 있어야 한다.

한국어 번역도 별도 기능으로 구현해야 한다. 현재 저장소의 가이드 언어 검증과 UI는 영어·중국어를 기준으로 작성되었으므로, 한국어 지원은 프롬프트만 바꿔서 완성되는 문제가 아니다.

## **7. 구현 우선순위와 예상되는 어려움**

기술적으로 가장 빠른 경로는 기존 HTML reader 위에 이 저장소의 skill 구조를 먼저 연결하는 것이다.

PDF를 직접 다시 파싱하는 대신 Docling이나 기존 변환 파이프라인에서 얻은 문단 데이터를 Literature Guide Read가 요구하는 형태로 변환하면 된다.

그다음 `method.md`, `genres.md`, `schema.md`를 기반으로 한국어 의학 논문용 `guide.json`을 생성하고, 이를 HTML에 표현한다.

이 단계만으로 Close / Skim / Skip, 문단별 AI 해설, 논증 지도 등 핵심 기능의 상당 부분을 재현할 수 있다.

두 번째 단계에서는 사용자의 텍스트 선택, comment, highlight 등을 별도 데이터베이스에 보관하는 영속적 annotation 계층을 추가해야 한다.

세 번째 단계에서 원문과 번역문의 동일 문단을 연결하고 PDF 원본 위치로 이동하는 기능을 추가하면, 우리가 원했던 **PDF 원문과 번역 HTML을 함께 사용하는 연구용 Reader**가 완성된다.

검증에는 실제 의학 논문을 활용해야 한다. 특히 다단 편집, 복잡한 결과표, supplementary material, 수식과 그림이 많은 논문에서 파싱 정확도와 annotation 재연결 성공률을 별도로 평가하는 것이 필요하다.

운영비용도 고려해야 한다. 개발자가 공개한 초기 시험에서는 6쪽 논문 한 편을 가이드로 만드는 데 약 134,000토큰을 사용했으며, 독립적인 두 번째 검토에도 상당한 추가 토큰이 소비되었다. 이 수치는 최신 구현의 확정적인 성능 측정이 아니지만, 단순한 PDF 변환보다 AI 검토 비용이 훨씬 클 수 있음을 보여준다. 

GitHub



## **최종 판단**

이 저장소에서 우리가 가져와야 할 것은 HTML renderer보다도 **PDF 원문을 검증 가능한 문단 구조로 정리하고, AI가 논문의 논증을 분석하여 그 문단 구조에 지식을 부착하는 설계**다.

예전에는 PDF를 얼마나 완벽하게 HTML로 변환할 수 있는지가 가장 큰 문제라고 생각했지만, 실제 연구용 Reader에서는 적절한 원문 구조와 위치 정보가 확보되면 그다음 단계의 가능성이 훨씬 커진다.

현재 기술로 충분히 실현 가능한 조합은 다음과 같다.

**Docling/MinerU의 문서 파싱 + Literature Guide Read의 논증 분석 skill + 한국어 번역 + W3C 방식의 영속적 annotation.**

기존 PDF reader를 이 구조로 확장한다면 단순히 논문을 읽고 번역하는 앱을 넘어, **AI가 읽기를 안내하고 연구자의 해석과 주석을 지속적으로 축적하는 학술 독서 환경**으로 발전시킬 수 있다.

가장 먼저 시험할 부분은 기존 PDF→HTML 결과에 이 저장소의 `guide.json`을 연결하는 것이다. PDF 파서를 다시 개발하는 것보다 구현 범위가 작고, 독서 경험이 얼마나 개선되는지도 곧바로 비교할 수 있다.

검토한 주요 소스: [SKILL.md](https://github.com/Liangzhen-Chen/literature-guide-read/blob/main/SKILL.md?utm_source=chatgpt.com), [method.md](https://github.com/Liangzhen-Chen/literature-guide-read/blob/main/references/method.md?utm_source=chatgpt.com), [segment.py](https://github.com/Liangzhen-Chen/literature-guide-read/blob/main/scripts/segment.py?utm_source=chatgpt.com), [check.py](https://github.com/Liangzhen-Chen/literature-guide-read/blob/main/scripts/check.py?utm_source=chatgpt.com).