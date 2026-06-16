@echo off
echo ============================================
echo  Pushing Subject Medias site to GitHub...
echo ============================================

cd /d "%~dp0"

git init
git add .
git commit -m "Initial deploy: Subject Medias site"
git branch -M main
git remote add origin https://github.com/kcumby2-wq/subjectmedias-site.git
git push -u origin main

echo.
echo ============================================
echo  Done! Check GitHub to confirm upload.
echo ============================================
pause
