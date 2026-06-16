@echo off
echo ============================================
echo  Pushing updates to GitHub...
echo ============================================
cd /d "%~dp0"
git add .
git commit -m "Update pricing: Team Package $499.99, Event Package $1,499.99"
git push origin main
echo.
echo ============================================
echo  Done! Vercel will auto-deploy in ~30 sec.
echo ============================================
pause
