# AI Interview Assistant

Windows desktop floating interview assistant built with Electron + React.

It captures microphone audio, transcribes interviewer questions, lets the user manually stop twice, then shows a fast short answer first and a streaming deep answer afterward.

## Features

- Windows floating desktop window with always-on-top behavior.
- Microphone-only ASR for MVP simplicity.
- Two-step manual interview flow:
  - First stop: send the current question to the fast answer model.
  - Second stop: send the full question to the deep answer model.
- Fast answer modes:
  - Zero-context mode.
  - Context mode with one `.md` or `.txt` file, trimmed to about 10k characters.
- Deep answer modes:
  - Long-context mode with one `.md` or `.txt` file, trimmed to about 256k characters.
  - Codebase mode with read-only repository scanning.
- OpenAI-compatible chat completion API for fast and deep models.
- Volcengine LAS ASR and experimental Volcengine streaming ASR support.
- Streaming deep answer output through Electron IPC.

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- OpenAI-compatible SDK
- Volcengine ASR integrations

## Quick Start

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run typecheck
npm test
npm run build
npm run package
```

`npm run build` builds the Electron main process and renderer. `npm run package` creates a local Windows app directory with `electron-builder`.

## Configuration

You can configure providers in the app settings panel. Local settings are saved under Electron's user data directory, not in this repository.

You can also provide credentials with environment variables. Local settings take priority; environment variables are used only when a field is empty.

### Fast Model

```bash
AI_INTERVIEW_FAST_MODEL_BASE_URL=https://api.deepseek.com
AI_INTERVIEW_FAST_MODEL_API_KEY=
AI_INTERVIEW_FAST_MODEL_NAME=deepseek-v4-flash
```

### Deep Model

```bash
AI_INTERVIEW_DEEP_MODEL_BASE_URL=https://api.openai.com/v1
AI_INTERVIEW_DEEP_MODEL_API_KEY=
AI_INTERVIEW_DEEP_MODEL_NAME=gpt-4.1
```

### OpenAI-Compatible ASR

```bash
AI_INTERVIEW_ASR_OPENAI_BASE_URL=https://api.openai.com/v1
AI_INTERVIEW_ASR_OPENAI_API_KEY=
AI_INTERVIEW_ASR_OPENAI_MODEL=whisper-1
```

### Volcengine LAS ASR

```bash
AI_INTERVIEW_VOLCENGINE_LAS_ENDPOINT=https://operator.las.cn-beijing.volces.com/api/v1
AI_INTERVIEW_VOLCENGINE_LAS_API_KEY=
AI_INTERVIEW_VOLCENGINE_LAS_APP_KEY=
AI_INTERVIEW_VOLCENGINE_LAS_ACCESS_KEY=
AI_INTERVIEW_VOLCENGINE_LAS_RESOURCE_ID=las_asr
AI_INTERVIEW_VOLCENGINE_LAS_MODEL_NAME=bigmodel
```

### Volcengine Streaming ASR

```bash
AI_INTERVIEW_VOLCENGINE_SAUC_ENDPOINT=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
AI_INTERVIEW_VOLCENGINE_SAUC_API_KEY=
AI_INTERVIEW_VOLCENGINE_SAUC_APP_KEY=
AI_INTERVIEW_VOLCENGINE_SAUC_ACCESS_KEY=
AI_INTERVIEW_VOLCENGINE_SAUC_RESOURCE_ID=volc.seedasr.sauc.duration
AI_INTERVIEW_VOLCENGINE_SAUC_MODEL_NAME=bigmodel
```

## Context Files

Context modes intentionally accept only a single `.md` or `.txt` file:

- Fast context: resumes, JD notes, project summaries, common Q&A.
- Deep context: longer project notes or architecture documents.

This keeps reads predictable and avoids accidentally sending unrelated files to an AI provider.

## Security

- Do not commit real API keys.
- `.env*`, build outputs, release outputs, local configs, and logs are ignored.
- Default source config uses empty API key fields.
- The deep codebase agent is read-only. It does not execute commands, modify files, or run tests.

Before publishing, run:

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!release/**' "sk-|apiKey|accessKey|Bearer|token|secret|password|X-Api-Key" .
```

Review any matches manually. Field names are expected; real secrets are not.

## MVP Limits

- No system audio capture.
- No account system.
- No cloud sync.
- No vector database.
- ASR quality depends on microphone input and provider behavior.

