@echo off
rem Abre a equipe de agentes na pasta arrastada sobre este arquivo (ou na pasta atual).
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0IniciarSessoes.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0IniciarSessoes.ps1" -Pasta "%~1"
)
