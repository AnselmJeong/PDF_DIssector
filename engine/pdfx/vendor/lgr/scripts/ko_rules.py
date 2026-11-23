"""Korean (ko) style and number rules for check.py. Added by PDF Dissector (pdfx); not part of upstream.

The upstream checker knows zh and en. Korean notes are measured in characters like zh, and get their own
describe-the-paragraph detector, translationese rules and number normalisation.
"""
import re

# "이 문단은 ...을 소개한다" describes the paragraph instead of restating it
DESCRIPTIVE = re.compile(
    r"^(?:(?:이|본|해당|위)\s?(?:문단|단락|절|부분|섹션|대목)|(?:저자(?:들)?은|저자(?:들)?는)\s?(?:이|본)\s?(?:문단|단락|절)|"
    r"(?:문단|단락)에서는|여기(?:서|에서)는)"
    r"|^[^.。]{0,40}(?:을|를)\s?(?:소개|설명|서술|기술|논의|다루|제시|정리|요약)(?:한다|하고 있다|했다)\.?$")

STYLE = [
    (re.compile(r"에\s?대(?:해|하여)\s?[^.,]{0,15}(?:을|를)\s?(?:진행|실시|수행)(?:한다|했다|하였다)"),
     "번역투 “~에 대해 ~를 진행하다”: 동사를 바로 쓰세요"),
    (re.compile(r"(?:하는|한)\s?역할을\s?(?:한다|했다|수행)"), "“~하는 역할을 하다”: 무엇을 하는지 바로 쓰세요"),
    (re.compile(r"(?:라고|다고)\s?할\s?수\s?있다"), "“~라고 할 수 있다”: 단정할 수 있으면 단정하세요"),
    (re.compile(r"주목할\s?(?:만한|점은)|흥미롭게도|중요한\s?점은|눈여겨볼"), "군더더기 도입구"),
    (re.compile(r"요컨대|결론적으로|종합하면|한마디로"), "요약 군더더기"),
    (re.compile(r"탁월|훌륭|인상적|강력한\s?근거|설득력\s?있"), "평가 형용사: 해설은 저자를 채점하지 않습니다"),
    (re.compile(r"(?:의\s[^\s.,]+){3,}"), "“의” 연쇄(과도한 명사화): 문장을 풀어 쓰세요"),
]

# "X가 아니라 Y이다": state what it is
TELL = (re.compile(r"(?:이|가)\s?아니라|뿐만\s?아니라|에\s?그치지\s?않고"), "대비 “~가 아니라 ~이다”: 부정 없이 무엇인지 쓰세요")

LIMITS = {"role": 30, "read": 120, "claim": 110, "thesis": 140}
SHORT_NOTE = 40

_KO_DIGIT = {"일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9}
_KO_DATE = re.compile(r"(?<!\d)(\d{4})\s*년\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?")
_KO_BIG = re.compile(r"(?<![\d.,])(\d+(?:\.\d+)?)\s*만(?:\s*(\d{1,4})\s*천)?(?:\s*(\d{1,3})\s*백)?(?=\s|[^\w]|$|[가-힣])")
_KO_THOUSAND = re.compile(r"(?<![\d.,])(\d+)\s*천(?:\s*(\d)\s*백)?(?=\s|[^\w]|$|[가-힣])")


def normalize_numbers(text):
    """Korean number forms written out to digits, so the number check compares like with like.

    "2023년 5월" -> "2023-5" (the checker's ISO date form), "1만 2천" -> "12000", "3천" -> "3000".
    """
    if not text:
        return text
    t = _KO_DATE.sub(lambda m: f"{m.group(1)}-{int(m.group(2))}" + (f"-{int(m.group(3))}" if m.group(3) else ""), text)

    def big(m):
        v = float(m.group(1)) * 10000 + int(m.group(2) or 0) * 1000 + int(m.group(3) or 0) * 100
        return str(int(v)) if v.is_integer() else str(v)
    t = _KO_BIG.sub(big, t)
    t = _KO_THOUSAND.sub(lambda m: str(int(m.group(1)) * 1000 + int(m.group(2) or 0) * 100), t)
    return t
