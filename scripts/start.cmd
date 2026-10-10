@echo off
setlocal

if exist "%~dp0build\server\index.js" (
  set "ROOT_DIR=%~dp0"
) else (
  set "ROOT_DIR=%~dp0..\"
)
if not defined PORT set "PORT=8787"

if exist "%ROOT_DIR%runtime\node.exe" (
  set "NODE_EXE=%ROOT_DIR%runtime\node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Node.js。请安装 Node.js 20.19+ 后重试。
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

"%NODE_EXE%" -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 20 || (major === 20 && minor >= 19) ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 版本过低，需要 20.19+。
  pause
  exit /b 1
)

set "NODE_ENV=production"
set "SKILL_MANAGER_ROOT=%ROOT_DIR%"
start "Skill Manager" /b "%NODE_EXE%" "%ROOT_DIR%build\server\index.js"
timeout /t 1 /nobreak >nul
if not "%SKILL_MANAGER_NO_BROWSER%"=="1" start "" "http://127.0.0.1:%PORT%"
echo Skill 管理器已启动：http://127.0.0.1:%PORT%
echo 关闭此窗口不会停止服务，请在任务管理器中结束 node.exe 进程。
endlocal
