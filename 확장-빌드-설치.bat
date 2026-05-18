@echo off
powershell.exe -ExecutionPolicy Bypass -File "%~dp0scripts\sync-and-rebuild.ps1" -SkipMarketplace -NoPull
pause
