@echo off
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..\..\..\..") do set "PRODUCT_ROOT=%%~fI"
set "PRODUCT_VARIABLE_SCRIPT=%PRODUCT_ROOT%\.output\server\scripts\build\variable.ts"
set "PORTABLE_BUN=%PRODUCT_ROOT%\..\runtime\bun\bun.exe"

if exist "%PRODUCT_VARIABLE_SCRIPT%" (
    if exist "%PORTABLE_BUN%" (
        "%PORTABLE_BUN%" "%PRODUCT_VARIABLE_SCRIPT%" %*
        exit /b %ERRORLEVEL%
    )
    if defined BUN (
        "%BUN%" "%PRODUCT_VARIABLE_SCRIPT%" %*
        exit /b %ERRORLEVEL%
    )
    bun "%PRODUCT_VARIABLE_SCRIPT%" %*
    exit /b %ERRORLEVEL%
) else (
    if defined BUN (
        "%BUN%" "%SCRIPT_DIR%..\scripts\variable.ts" %*
        exit /b %ERRORLEVEL%
    )
    call bun "%SCRIPT_DIR%..\scripts\variable.ts" %*
    exit /b %ERRORLEVEL%
)
