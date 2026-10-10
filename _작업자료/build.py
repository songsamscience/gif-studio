"""편집용 소스 4개를 배포용 단일 HTML로 조립합니다. 표준 Python만 사용합니다."""
from pathlib import Path

source = Path(__file__).resolve().parent
shell = (source / 'shell.html').read_text(encoding='utf-8')
scripts = []
for name in ['encoder.js', 'capture.js', 'app.js']:
    code = (source / name).read_text(encoding='utf-8')
    # HTML 파서가 문자열 내부의 종료 태그를 script 종료로 읽지 않게 합니다.
    code = code.replace('</script', '<\\/script')
    scripts.append('<script>\n' + code + '\n</script>')
assert shell.count('__APP_SCRIPTS__') == 1
target = source.parent / 'index.html'
target.write_text(shell.replace('__APP_SCRIPTS__', '\n'.join(scripts)), encoding='utf-8')
print(f'{target}\n{target.stat().st_size:,} bytes')
