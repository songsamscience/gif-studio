"""GIF 스튜디오 폴더를 localhost에서 여는 선택 실행 도우미."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
import webbrowser


def main():
    folder = Path(__file__).resolve().parent.parent
    handler = partial(SimpleHTTPRequestHandler, directory=str(folder))
    server = None
    for port in range(8768, 8779):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), handler)
            break
        except OSError:
            continue
    if server is None:
        print('로컬 서버를 열 수 없어요. 8768~8778 포트를 확인한 뒤 다시 실행해 주세요.')
        raise SystemExit(1)
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'송쌤과학 GIF 스튜디오\n{url}\n종료: 이 터미널에서 Ctrl+C', flush=True)
    timer = Timer(0.5, lambda: webbrowser.open(url))
    timer.daemon = True
    timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n로컬 서버를 종료했어요.')
    finally:
        timer.cancel()
        server.server_close()


if __name__ == '__main__':
    main()
