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
echo Fetching the latest repository history...
git fetch origin
if errorlevel 1 goto :error

echo.
echo Staging portfolio files...
git add -A
if errorlevel 1 goto :error

git diff --cached --quiet
if errorlevel 1 (
  echo.
  echo New or changed files:
  git diff --cached --stat
  echo.
  set /p "CONFIRM_COMMIT=Commit these changes? (Y/N): "
  if /i not "%CONFIRM_COMMIT%"=="Y" (
    echo Cancelled. Staged files remain available in Git.
    pause
    exit /b 0
  )
  git commit -m "Update portfolio"
  if errorlevel 1 goto :error
) else (
  echo No uncommitted file changes.
)

git branch -M "%BRANCH%"
if errorlevel 1 goto :error

git show-ref --verify --quiet "refs/remotes/origin/%BRANCH%"
if errorlevel 1 (
  echo The remote branch does not exist yet; the first push will create it.
) else (
  git merge-base HEAD "origin/%BRANCH%" >nul 2>&1
  if errorlevel 1 (
    echo Combining the existing remote history with the local portfolio commit...
    git rebase --onto "origin/%BRANCH%" --root
  ) else (
    git pull --rebase origin "%BRANCH%"
  )
  if errorlevel 1 goto :error
)

set "AHEAD=0"
for /f %%C in ('git rev-list --count "origin/%BRANCH%..HEAD" 2^>nul') do set "AHEAD=%%C"
if "%AHEAD%"=="0" (
  echo The local branch is already up to date with origin/%BRANCH%.
  pause
  exit /b 0
)

echo.
echo Commits ready to push:
git log --oneline "origin/%BRANCH%..HEAD"
echo.
set /p "CONFIRM_PUSH=Push these commits to the repository? (Y/N): "
if /i not "%CONFIRM_PUSH%"=="Y" (
  echo Cancelled. Your commits remain local and can be pushed later.
  pause
  exit /b 0
)

git push -u origin "%BRANCH%"
if errorlevel 1 goto :error

echo.
echo Portfolio published successfully.
pause
exit /b 0

:error
echo.
echo Publishing stopped because a Git command failed.
echo Check the output above, the repository URL, and your Git sign-in.
pause
exit /b 1
