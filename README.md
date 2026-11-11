# Correctool

A browser app for practising spoken Italian at levels A1–C1. It transcribes speech, marks grammar mistakes, runs spoken role-play conversations, and generates exercises based on recurring mistakes.

## Run locally

Use Node.js 22.12+ (or a newer supported version) and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Under **Practice → Settings**, enter your own OpenAI API key. Your API account needs access to the selected transcription, chat, and speech models, with billing available. Requests incur API usage charges.

Microphone recording requires browser permission and a secure context: localhost works for development; deployed sites need HTTPS. Use a modern browser supporting AudioWorklet and AbortSignal.timeout/any. Headphones help prevent speaker audio from entering the microphone.

```sh
npm test        # regression tests using mocked browser storage, microphone, and network
npm run build  # strict TypeScript check and production assets in dist/
npm run preview
```

The test runner compiles the relevant TypeScript modules into a temporary directory and removes it afterward. It makes no network requests and requires no API key.

## Features and structure

- **Practice:** microphone samples → pause-based WAV clips → transcription → grammar correction → review.
- **Role-play:** level-specific situations and characters, generated replies, optional speech, and end-of-conversation review.
- **Exercises:** multiple choice, fill-in-the-blank, and word ordering, using speaking mistakes and exercise results to identify weak areas.
- **My mistakes / Saved:** local progress totals, recurring mistakes, and explicitly saved sessions (up to 50).

`src/main.ts` connects the tabs and practice workflow. `transcriber.ts` and `segmenter.ts` capture and split audio; `pipeline.ts` processes each clip. `openai.ts` defines API requests and prompts; `request.ts` adds a 45-second request/body timeout and cancellation support. Role-play and exercises live in their own modules. Rendering uses DOM text rather than interpreting model output as HTML.

There is no server or user account. Deploy the generated `dist/` directory to a static HTTPS host.

## Data and credentials

Audio clips and text are sent directly from the browser to OpenAI. Saved sessions and progress are stored in this browser's local storage, without cloud sync. Clearing browser/site data removes them. Storage failures are reported when saving sessions or progress.

API keys use session storage by default. **Remember key on this device** explicitly enables local storage. Previously persisted keys migrate to session storage unless remembering was explicitly selected. Browser storage is accessible to scripts on the same origin; only use a trusted deployment and device. The key remains in the settings input if browser storage is unavailable.

Recordings share a microphone lock, including while permission is pending. Stop an active practice session or conversation before starting another. Failed audio clips remain visible in the review, and partial results are labeled incomplete. Only successfully corrected text contributes to speaking progress. Ending role-play cancels pending AI replies and speech; already captured audio is allowed to finish processing within the request timeout.

Transcription can smooth over spoken grammar mistakes, and AI corrections or exercise answers can be imperfect. The regression tests use mocks; they do not establish live microphone or model quality.

## Optional background audio

Background sound requires your own licensed recordings in `public/ambient/`; none are bundled. The app works without them and reports unavailable recordings when noise is enabled. See [the recording instructions](public/ambient/README.txt) for filenames, formats, fallbacks, and licensing guidance.
