@echo off
chcp 65001 >nul
title Gerando o StreamHub.exe
cd /d "%~dp0"
echo.
echo  [1/2] Instalando dependencias (so demora na primeira vez)...
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
echo.
echo  [2/2] Gerando o instalador e a versao portatil do StreamHub (sem publicar)...
call npm run desktop:exe
if errorlevel 1 goto erro
echo.
echo  Pronto! O instalador e a versao portatil estao na pasta "release".
start "" "%~dp0release"
pause
exit /b 0

:erro
echo.
echo  Algo deu errado. Copie as mensagens acima e envie para analise.
pause
exit /b 1
