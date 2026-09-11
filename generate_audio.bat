@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

:prompt
set "CHAPTER="
set /p "CHAPTER=请输入癸酉本回目编号（81-108，例如 81 或 081）："

call npm run --silent audio:generate -- "%CHAPTER%"
set "RESULT=%ERRORLEVEL%"

if "%RESULT%"=="2" (
  echo.
  goto prompt
)

if "%RESULT%"=="3" (
  echo.
  echo 已生成 AI 标注任务。完成标注后请再次运行本脚本。
  pause
  exit /b 3
)

if not "%RESULT%"=="0" (
  echo.
  echo 生成失败，请根据上面的错误提示处理后重试。
  pause
  exit /b %RESULT%
)

echo.
pause
exit /b 0
