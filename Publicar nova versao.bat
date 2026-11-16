@echo off
chcp 65001 >nul
setlocal
title Publicar nova versao do StreamHub
cd /d "%~dp0"
set REPO=leozinwf/streamhub
echo.
echo  ==============================================
echo    Publicar nova versao do StreamHub no GitHub
echo  ==============================================
echo.

rem --- Token do GitHub (pedido so na primeira vez, salvo em .gh-token) ---
if exist ".gh-token" set /p GH_TOKEN=<".gh-token"
if not "%GH_TOKEN%"=="" goto versao
echo  Na primeira vez e preciso um token do GitHub para publicar.
echo  1. Vai abrir a pagina de criacao do token no navegador.
echo  2. Em "Expiration" escolha "No expiration" e clique em "Generate token" no fim da pagina.
echo  3. Copie o token (comeca com ghp_) e cole aqui.
echo.
start "" "https://github.com/settings/tokens/new?scopes=public_repo&description=StreamHub%%20releases"
set /p GH_TOKEN= Cole o token e aperte Enter: 
if "%GH_TOKEN%"=="" goto erro
>".gh-token" echo %GH_TOKEN%
echo  Token salvo. Ele fica so neste computador (arquivo .gh-token, fora do Git).
echo.

:versao
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set ATUAL=%%v
echo  Versao atual: %ATUAL%
echo.
echo  O que voce quer fazer?
echo    [1] Correcao / ajuste pequeno   (ex.: 0.2.0 para 0.2.1)
echo    [2] Novidade / recurso novo     (ex.: 0.2.0 para 0.3.0)
echo    [3] Republicar a versao atual (%ATUAL%) - use se a ultima publicacao falhou
choice /c 123 /n /m " Escolha 1, 2 ou 3: "
set OPCAO=%errorlevel%
echo.
echo  [1/4] Instalando dependencias...
call npm install --no-audit --no-fund
if errorlevel 1 goto erro
echo.
echo  [2/4] Versao...
if "%OPCAO%"=="3" goto lerversao
set TIPO=patch
if "%OPCAO%"=="2" set TIPO=minor
call npm version %TIPO% --no-git-tag-version
if errorlevel 1 goto erro
:lerversao
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSAO=%%v
echo  Publicando a versao %VERSAO%
echo.

echo  [3/4] Salvar o codigo no GitHub?
choice /c SN /n /m " Fazer commit e push das mudancas agora? (S/N): "
if errorlevel 2 goto release
git add -A
git commit -m "Versao %VERSAO%"
git push
if errorlevel 1 echo  Aviso: o push falhou. A versao sera publicada mesmo assim; resolva o Git depois.
echo.

:release
echo  Novidades desta versao (opcional). Separe os itens com ponto e virgula ";"
echo  Exemplo: Nova pagina inicial; Correcao no player
set "NOVIDADES="
set /p "NOVIDADES= Novidades: "
set "STREAMHUB_NEWS=%NOVIDADES%"
rem Cria (ou atualiza) a release com as notas antes de enviar os arquivos.
call node scripts\publish-release.mjs
if errorlevel 1 goto erro
echo.
echo  [4/4] Gerando o instalador e a versao portatil e enviando para o GitHub...
call npm run desktop:release
if errorlevel 1 goto erro
echo.
echo  Pronto! A versao %VERSAO% foi publicada.
echo  Quem tem o StreamHub instalado recebe a atualizacao ao abrir o programa.
start "" "https://github.com/%REPO%/releases"
pause
exit /b 0

:erro
echo.
echo  Algo deu errado. Copie as mensagens acima e envie para analise.
echo  Se o erro falar de token (401 / Bad credentials), apague o arquivo .gh-token e rode de novo.
echo  Para tentar de novo sem mudar o numero da versao, escolha a opcao [3].
pause
exit /b 1
