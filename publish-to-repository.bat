@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Publish Subrata Portfolio

where git >nul 2>&1
if errorlevel 1 (
  echo Git was not found. Install Git for Windows, then run this file again.
  pause
  exit /b 1
)

if not exist ".git" (
  echo Initializing a Git repository in:
  echo %CD%
  git init -b main
  if errorlevel 1 goto :error
)

set "REMOTE_URL=https://github.com/ApurboPodder/Subrata_Portfolio.git"
set "BRANCH=main"

set "CURRENT_REMOTE="
for /f "delims=" %%R in ('git remote get-url origin 2^>nul') do set "CURRENT_REMOTE=%%R"
if defined CURRENT_REMOTE (
  git remote set-url origin "%REMOTE_URL%"
) else (
  git remote add origin "%REMOTE_URL%"
)
if errorlevel 1 goto :error

echo.
echo Staging portfolio files...
git add -A
if errorlevel 1 goto :error
git diff --cached --quiet
if not errorlevel 1 (
  echo There are no new changes to publish.
  pause
  exit /b 0
)

echo.
echo Files prepared for publishing:
git diff --cached --stat
echo.
set /p "CONFIRM=Commit and push these files to %BRANCH%? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
  echo Cancelled. Staged files remain available in Git.
  pause
  exit /b 0
)

git commit -m "Update portfolio"
if errorlevel 1 goto :error
git branch -M "%BRANCH%"
if errorlevel 1 goto :error
git push -u origin "%BRANCH%"
if errorlevel 1 goto :error

echo.
echo Portfolio published successfully.
pause
exit /b 0

:error
echo.
echo Publishing stopped because a Git command failed.
echo Check the output above, your repository URL, and your Git sign-in.
pause
exit /b 1
