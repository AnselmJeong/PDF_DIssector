# PDF Dissector 작업 규칙

## macOS DMG 패키징 (반드시 지킬 것)

- DMG에는 **`PDF Dissector.app` 하나와 `/Applications` 심볼릭 링크만** 들어간다. 사용자는 앱을 Applications로 끌어다 놓아 설치한다.
- DMG에 Setup/Installer 창을 띄우는 프로그램, 자가 압축 해제 래퍼(wrapper), 설치 스크립트를 절대 넣지 않는다.
- 앱은 어느 폴더에 두어도(`/Applications`가 아니어도) 바로 실행되어야 한다. 첫 실행 때 따로 "설치" 단계를 거치면 안 된다.

### 왜 이런 문제가 생겼나

`electrobun build --env=stable`은 `build/stable-macos-<arch>/PDF Dissector.app` 자리에 진짜 앱이 아니라
**자가 압축 해제 래퍼**(`Contents/MacOS/launcher` + `Contents/Resources/<hash>.tar.zst`)를 만들고,
`artifacts/*.dmg`와 `build/.../*-stable.dmg`도 이 래퍼를 담는다. 이 래퍼는 처음 실행할 때 "PDF Dissector Setup" 창을 띄우고
"Installation failed"로 실패할 수 있다. **Electrobun이 만든 DMG는 배포하지 않는다.**

### 올바른 빌드 방법

```bash
cd app && hutch run build
```

`build` 스크립트의 마지막 단계인 `bun scripts/make-dmg.ts stable`이 다음을 한다.

1. 래퍼 안의 `.tar.zst` payload를 풀어 진짜 `.app`을 꺼낸다(`Contents/Resources/app`이 있고 `.tar.zst`가 없는 것).
2. 번들 전체를 ad-hoc 서명하고 `codesign --verify --deep --strict`로 검증한다.
3. 앱 + `Applications` 링크만으로 `release/PDF-Dissector-<version>-<arch>.dmg`를 만든다.
4. Electrobun이 만든 래퍼 DMG들은 지운다.

배포 전 확인: DMG를 마운트해서 `ls`로 `PDF Dissector.app`과 `Applications`만 있는지, `Contents/Resources`에 `.tar.zst`가 없는지 본다.
그리고 앱을 `/Applications`가 아닌 임의 폴더에 복사해서 실행해 본다.
