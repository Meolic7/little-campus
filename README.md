# Pixel Campus - AI student study helper

A local Windows web app connecting timetable, todo, focus sessions, and lecture notes. The backend is FastAPI + SQLite and the frontend is React + Vite.

独立 Android 中英双语版见 [mobile/README.md](mobile/README.md)：无需电脑后端，使用手机本地数据和自定义云端模型接口。

## Quick start

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1                 # base app and cloud ASR support
.\setup.ps1 -WithASR       # additionally installs faster-whisper
.\start.ps1
```

Open `http://127.0.0.1:5173`. Data is stored in `data/`; API keys are encrypted with Windows DPAPI and are never placed in the browser storage.

The first local ASR use downloads the selected faster-whisper model into `data/models`. FFmpeg is required for non-WAV uploads; the setup environment includes `imageio-ffmpeg` as a fallback.

## Checks

```powershell
npm.cmd run build
$env:PYTHONPATH='.'; .venv\Scripts\python.exe -m compileall -q backend
```

Configure a text model using an OpenAI-compatible `/v1/chat/completions` endpoint. Vision imports need a vision-capable model. Cloud ASR uses an OpenAI-compatible `/v1/audio/transcriptions` endpoint. AI suggestions are always shown for confirmation before saving.

Knowledge base and research assistant integration points are reported by `/api/extension-status` and intentionally remain unimplemented in this first release.
