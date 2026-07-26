@echo off
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..\..\..\..") do set "PRODUCT_ROOT=%%~fI"
set "PRODUCT_PROFILE_SCRIPT=%PRODUCT_ROOT%\.output\server\scripts\build\profile.ts"
set "PRODUCT_ROOT_PACKAGE=%PRODUCT_ROOT%\package.json"
set "PRODUCT_OUTPUT_PACKAGE=%PRODUCT_ROOT%\.output\server\package.json"
set "PRODUCT_NODE_MODULES=%PRODUCT_ROOT%\node_modules"
set "PORTABLE_BUN=%PRODUCT_ROOT%\..\runtime\bun\bun.exe"
set "IS_PRODUCT_RUNTIME=0"

call :detect_product_runtime

if exist "%PRODUCT_PROFILE_SCRIPT%" (
    if "%IS_PRODUCT_RUNTIME%"=="1" (
        pushd "%PRODUCT_ROOT%" || exit /b 1
        if exist "%PORTABLE_BUN%" (
            "%PORTABLE_BUN%" "%PRODUCT_PROFILE_SCRIPT%" %*
            exit /b %ERRORLEVEL%
        )
        if defined BUN (
            "%BUN%" "%PRODUCT_PROFILE_SCRIPT%" %*
            exit /b %ERRORLEVEL%
        )
        bun "%PRODUCT_PROFILE_SCRIPT%" %*
        exit /b %ERRORLEVEL%
    )
)

if defined BUN (
    "%BUN%" "%SCRIPT_DIR%..\scripts\profile.ts" %*
    exit /b %ERRORLEVEL%
)

call bun "%SCRIPT_DIR%..\scripts\profile.ts" %*
exit /b %ERRORLEVEL%

:detect_product_runtime
if not exist "%PRODUCT_ROOT%\.output\server\index.mjs" exit /b 0
if exist "%PRODUCT_ROOT_PACKAGE%" (
    findstr /C:"neuro-book-product" "%PRODUCT_ROOT_PACKAGE%" >nul
    if not errorlevel 1 (
        set "IS_PRODUCT_RUNTIME=1"
        exit /b 0
    )
)
if exist "%PRODUCT_NODE_MODULES%" exit /b 0
if exist "%PRODUCT_OUTPUT_PACKAGE%" (
    findstr /C:"neuro-book-output" "%PRODUCT_OUTPUT_PACKAGE%" >nul
    if not errorlevel 1 set "IS_PRODUCT_RUNTIME=1"
)
exit /b 0
