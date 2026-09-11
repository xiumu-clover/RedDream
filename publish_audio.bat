@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

:prompt
set "CHAPTER="
set /p "CHAPTER=请输入要发布到 Pages 的回目编号（当前仅 81）："

call npm run --silent audio:publish -- "%CHAPTER%" --check
set "RESULT=%ERRORLEVEL%"

if "%RESULT%"=="2" (
  echo.
  goto prompt
)

if not "%RESULT%"=="0" (
  echo.
  echo 发布检查失败，请根据上面的错误提示处理后重试。
  pause
  exit /b %RESULT%
)

echo.
set "CONFIRM="
set /p "CONFIRM=确认将以上男女音轨发布到 public/audio 吗？输入 Y 确认："
if /I not "%CONFIRM%"=="Y" (
  echo 已取消，未修改公开音频。
  pause
  exit /b 0
)

call npm run --silent audio:publish -- "%CHAPTER%" --yes
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo 发布失败，请根据上面的错误提示处理后重试。
pause
exit /b %RESULT%
