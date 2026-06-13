# macOS Speech ASR Design

## Goal

Add a macOS-only ASR provider that uses Apple's Speech framework for local desktop speech recognition without requiring an external ASR API key.

## Current Gap

The app currently supports OpenAI-compatible Whisper, Volcengine LAS, and Volcengine SAUC. All of them require network credentials and add upload or WebSocket latency. The renderer already records microphone audio as short `audio/wav` chunks, so the missing part is a main-process provider that can pass those WAV chunks to a native macOS recognizer.

## Locked Decisions

- Add a new provider value: `macos-speech`.
- Keep existing renderer audio capture unchanged.
- Implement Speech framework access through a small Swift command-line helper.
- Compile the helper into `dist/helpers/macos-speech-recognizer` on macOS builds.
- Return a clear platform error when the provider is selected outside macOS.
- Keep OpenAI-compatible Whisper and Volcengine providers available as fallback options.

## Non-goals

- Do not replace the existing ASR providers.
- Do not implement Windows or Linux native speech recognition in this change.
- Do not add a long-running streaming helper yet; the first version recognizes the app's existing short WAV chunks.
- Do not guarantee offline recognition for every locale. Apple's on-device support depends on OS, installed language assets, and locale.

## State and Config Changes

- `AsrProvider` gains `macos-speech`.
- The existing `asr` config object keeps its current shape; no API key is needed for `macos-speech`.
- The settings panel shows an explanation block instead of endpoint fields for this provider.

## API and Page Impact

- IPC payloads stay unchanged: renderer still sends `AudioChunkPayload` to `audio:transcribe`.
- Main-process transcription dispatch routes `macos-speech` to the native helper.
- Settings UI adds one provider option.
- README documents the provider and build requirement.

## Acceptance Criteria

- `npm run build` succeeds on macOS when Swift tooling is available.
- If Swift tooling is unavailable, TypeScript/Vite build still succeeds and selecting `macos-speech` reports that the helper is missing.
- Selecting `macos-speech` does not require an API key in renderer validation.
- On non-macOS platforms, selecting `macos-speech` reports a platform-specific error.
- The Swift helper emits JSON with recognized text on success and nonzero exit status with a readable error on failure.
