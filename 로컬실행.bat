@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 송쌤과학 GIF 스튜디오 - 로컬 실행
echo 송쌤과학 GIF 스튜디오를 이 컴퓨터에서 열어요.
echo 실행 창을 닫거나 Ctrl+C를 누르면 서버가 종료돼요.
echo.
py -3 --version >nul 2>&1
if not errorlevel 1 goto :run_py
python -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >nul 2>&1
if not errorlevel 1 goto :run_python
echo Python 3를 찾지 못했어요.
echo Python 3를 설치한 뒤 다시 실행해 주세요.
echo 설치 안내: https://www.python.org/downloads/windows/
pause
exit /b 1

:run_py
py -3 "%~dp0_작업자료\serve.py"
goto :finished

:run_python
python "%~dp0_작업자료\serve.py"
goto :finished

:finished
if errorlevel 1 goto :failed
endlocal
exit /b 0

:failed
echo.
echo 로컬 서버를 시작하지 못했어요. 위 오류와 Python 3 설치를 확인해 주세요.
pause
endlocal
exit /b 1
