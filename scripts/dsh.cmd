@echo off
rem dsh wrapper: a bare `dsh` boots the omp-styled tui profile by default.
rem Real dsh invocations (web/plugin/--profile/--patch/--dump*/help/version)
rem pass through unchanged. Put this directory first on PATH.
setlocal
set "FIRST=%~1"
if "%FIRST%"=="web" goto pass
if "%FIRST%"=="plugin" goto pass
if "%FIRST%"=="--profile" goto pass
if "%FIRST%"=="--patch" goto pass
if "%FIRST%"=="--dump-config" goto pass
if "%FIRST%"=="--dump-default-config" goto pass
if "%FIRST%"=="-V" goto pass
if "%FIRST%"=="--version" goto pass
if "%FIRST%"=="-h" goto pass
if "%FIRST%"=="--help" goto pass
npx --yes @deepseek-ai/dsh --profile tui %*
exit /b %errorlevel%
:pass
npx --yes @deepseek-ai/dsh %*
exit /b %errorlevel%
