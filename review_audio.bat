@echo off
setlocal
cd /d "%~dp0"
title 红楼梦 - 对白审核台
node scripts\audio\review-server.js --chapter 081 --scene xiren-three-opera --port 4381 --open
if errorlevel 1 pause
