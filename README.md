# Traverse

Learn to identify a bottleneck at a restaurant and apply the same reasoning to a print shop. [Play the hosted app](https://traverse-59b13.web.app/) or [watch the English-captioned demo](https://youtu.be/6lKAgw4UwP8).

## Run locally

    python -m http.server 8765 --bind 127.0.0.1 --directory prototype

Open http://127.0.0.1:8765/ in desktop Chrome. To enable live hints and account sync on your own deployment, register a Firebase Web app, enable Firebase AI Logic with the Gemini Developer API backend, set up App Check with reCAPTCHA Enterprise, and enable Google sign-in and Cloud Firestore. Fill in prototype/config.js with your Firebase web configuration and public site key. Deploy the supplied Firestore rules and authorize your hosting domain for Firebase Authentication and reCAPTCHA.

## Test the hosted demo

1. In desktop Chrome with Gemini Nano ready, load the demo and wait for the offline-ready message.
2. Go offline, start the restaurant exercise, choose a wrong answer and look for the validated on-device hint.
3. Reconnect and request the cloud hint. It builds on the prior hint without revealing the answer. Written hints cover unavailable or rejected model output.
4. Solve the restaurant and try the print shop. Sign in under Progress, save a draft and resume from another browser with the same account.

Firebase AI Logic runs both inference paths in prototype/firebase-tutor.mjs. A service worker caches the app and Firestore syncs signed-in progress.

Licensed under [Apache 2.0](LICENSE).
