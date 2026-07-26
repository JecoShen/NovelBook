@echo off
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..\..\..\..") do set "PRODUCT_ROOT=%%~fI"
set "PRODUCT_WORKSPACE_SCRIPT=%PRODUCT_ROOT%\.output\server\scripts\agent\workspace.ts"
set "PORTABLE_BUN=%PRODUCT_ROOT%\..\runtime\bun\bun.exe"

if exist "%PRODUCT_ROOT%\.output\server\scripts\agent\workspace.ts" (
    if exist "%PORTABLE_BUN%" (
        "%PORTABLE_BUN%" "%PRODUCT_WORKSPACE_SCRIPT%" %*
        exit /b %ERRORLEVEL%
    )
    if defined BUN (
        "%BUN%" "%PRODUCT_WORKSPACE_SCRIPT%" %*
        exit /b %ERRORLEVEL%
    )
    bun "%PRODUCT_WORKSPACE_SCRIPT%" %*
    exit /b %ERRORLEVEL%
) else (
    if defined BUN (
        "%BUN%" "%SCRIPT_DIR%..\scripts\workspace.ts" %*
        exit /b %ERRORLEVEL%
    )
    call bun "%SCRIPT_DIR%..\scripts\workspace.ts" %*
    exit /b %ERRORLEVEL%
)
