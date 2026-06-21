# OpenAI Realtime ASR Design

## Goal

Add an `openai-realtime` ASR provider for system audio so interviewer audio can be transcribed continuously through the OpenAI Realtime transcription WebSocket instead of Whisper-style file slices.

## Current Gap

System audio currently follows the file transcription path: audiotee captures PCM, local VAD groups speech, the app writes a WAV payload, and `transcribeAudio()` dispatches to the selected file-oriented ASR provider. That path can miss or duplicate text around slice boundaries. Realtime transcription needs a separate long-lived session that receives PCM chunks continuously and returns completed utterances from server-side VAD.

## Locked Decisions

- Add provider value `openai-realtime`.
- Scope the new provider to system audio capture only.
- Keep microphone capture, microphone transcription, and all existing non-realtime ASR providers unchanged.
- Use `wss://api.openai.com/v1/realtime?intent=transcription` derived from `asr.openaiRealtime.baseURL`.
- Send `transcription_session.update` after connect with `input_audio_format: "pcm16"`, model from config, optional language, server VAD, and near-field noise reduction.
- Stream `input_audio_buffer.append` messages containing base64 16-bit PCM mono at 24 kHz.
- Emit only completed transcripts into the existing question flow to avoid renderer-side merge duplication.

## Non-goals

- Do not show interim Realtime deltas in the transcript UI in this change.
- Do not manually commit audio buffers; server VAD owns utterance boundaries.
- Do not change OpenAI-compatible Whisper, Volcengine, or macOS Speech behavior.
- Do not change answer generation, prompt construction, or microphone routing.

## State and Config Changes

- `AsrProvider` gains `openai-realtime`.
- `AsrConfig` gains `openaiRealtime: ModelEndpointConfig`.
- Defaults use `https://api.openai.com/v1`, empty `apiKey`, and `gpt-4o-transcribe`.
- Config schema must include `openaiRealtime` so stored settings are not stripped.
- Environment overrides use `AI_INTERVIEW_OPENAI_REALTIME_BASE_URL`, `AI_INTERVIEW_OPENAI_REALTIME_API_KEY`, and `AI_INTERVIEW_OPENAI_REALTIME_MODEL`.

## API and Page Impact

- Main process adds `startRealtimeTranscription()` in `src/main/services/openaiRealtimeAsr.ts`.
- `systemAudioCapture` branches by provider:
  - `openai-realtime`: audiotee captures 24 kHz PCM and streams directly to the Realtime WebSocket.
  - all other providers: keep the existing 16 kHz VAD and file transcription flow.
- Settings UI adds the provider option and endpoint fields for `asr.openaiRealtime`.
- Renderer validation requires an OpenAI Realtime API key only when this provider is selected.

## Acceptance Criteria

- `npx tsc -p tsconfig.node.json --noEmit` passes.
- `npx tsc -p tsconfig.json --noEmit` passes.
- `npm test` passes.
- `openaiRealtime` survives config schema parsing and config merging.
- Non-realtime providers still use the existing VAD/file transcription path.
- Realtime mode streams 24 kHz PCM to WebSocket and uses completed transcripts to drive question capture.
