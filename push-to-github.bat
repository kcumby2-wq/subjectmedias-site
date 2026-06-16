@echo off
echo ============================================
echo  Pushing updates to GitHub...
echo ============================================
cd /d "%~dp0"
git add .
git commit -m "Add all site images: event-photos, athlete-photos, crew-photos"
git push origin main
echo.
echo ============================================
echo  Done! Vercel will auto-deploy in ~30 sec.
echo ============================================
pause
