#!/bin/zsh
set -e
if ! command -v python3 >/dev/null 2>&1; then
  print 'Python3가 필요해요. 이미지 제작은 index.html을 Chrome에서 직접 열어 사용할 수 있어요.'
  read -r '?Enter를 누르면 종료해요. '
  exit 1
fi
python3 "$(dirname -- "$0")/_작업자료/serve.py"
