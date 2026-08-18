@echo off
rem omdsh: dsh-omp-tui 启动器（Windows 薄包装）。
rem 实际逻辑在 scripts\omdsh.js 中，以便与 bin 入口保持一致。
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo omdsh: 需要 Node.js，但未在 PATH 中找到 node。 1>&2
  exit /b 1
)

node "%~dp0omdsh.js" %*
exit /b %errorlevel%
