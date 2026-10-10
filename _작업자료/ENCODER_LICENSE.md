# GIF 인코더와 오픈 소스 고지

- 라이브러리: **gifenc 1.0.3** (MIT), 런타임 외부 의존성 없음.
- 공식 저장소: https://github.com/mattdesl/gifenc
- 고정 소스 커밋: https://github.com/mattdesl/gifenc/tree/15e2c3e65ed03c977b42fec48de59b05ee9b9f54
- 공식 npm 버전: https://www.npmjs.com/package/gifenc/v/1.0.3
- 다운로드: https://registry.npmjs.org/gifenc/-/gifenc-1.0.3.tgz
- 내려받은 패키지 SHA-512는 공식 npm metadata integrity와 완전히 일치함.
- SHA-256: `29470c10132cd66ecac3b4da025b57ab9ec35df6e40215947f22eb2f14a128d4`

## 선택 이유

PNN 팔레트 양자화, 최대 256색 매핑, GIF89a + LZW 인코딩, 지연·반복 메타데이터를 제공하는 의존성 없는 구현이다. Worker는 단일 HTML 안의 소스를 Blob URL로 실행한다. 원본 라이브러리 dist/gifenc.js를 포함하며 sourceMappingURL만 제거했다. 색 양자화와 매핑은 공식 지원 옵션인 `rgb444`를 함께 사용한다. 1.0.3의 rgb565 색 패킹 관련 공개 이슈 https://github.com/mattdesl/gifenc/issues/20 을 피하는 선택으로, 라이브러리 소스 자체는 수정하지 않았다. 팔레트당 색수는 사용자 설정 64·128·256색에 따른다.

## API

```js
const exporter = new GifExport({ onProgress: value => console.log(value) });
await exporter.start({ width: 800, height: 600, colors: 128, repeat: 0, dedupe: true, total: 20, signal });
for (const frame of frames) await exporter.addFrame(frame.rgba, frame.delay);
const { blob, frameCount, sourceFrameCount, duration } = await exporter.finish();
// exporter.cancel();
```

`addFrame`은 단일 프레임의 RGBA ArrayBuffer 소유권을 Worker로 옮기고 처리 응답을 기다린다. 전달 후 원래 버퍼는 사용할 수 없으므로 Canvas에서 매 프레임 새로 얻은 data를 전달한다. 전체 프레임 배열을 동시에 보내지 않는다. 이전 최종 합성 RGBA와 현재 입력 두 장으로 연속 동일 프레임을 확인한 뒤 처리한다. 압축 GIF 바이트는 종료 때까지 보관한다. onProgress의 `encoding.done`은 처리한 실제 입력 프레임 수, `written`은 작성한 실제 출력 프레임 수다.

불투명 RGBA 입력을 전제로 한다. 반투명 픽셀은 호출 전에 Canvas에서 선택한 배경색으로 합성한다. 최소 프레임 지연은 20ms다. GIF의 10ms 단위는 누적 총 시간을 반올림하여 15FPS 등의 오차가 쌓이지 않도록 한다. 연속 RGBA가 hash와 모든 바이트 비교에 모두 일치할 때만 표시 시간을 합친다. 655350ms보다 긴 프레임은 GIF 지연 필드 한도 안에서 나눈다.

반복값: `-1` = Netscape 확장 생략하여 한 번, `0` = 무한, 양수 = 추가 반복 수. 화면에서 총 N회라면 N=1일 때 -1, N>1일 때 N-1을 전달한다. Worker 취소·오류·완료 시 terminate하고 URL을 해제한다. AbortSignal을 지원한다. 최대 600 입력 프레임, 1280×1280px 이내로 제한한다.

## 원본 라이선스

```text
The MIT License (MIT)
Copyright (c) 2017 Matt DesLauriers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.

```
