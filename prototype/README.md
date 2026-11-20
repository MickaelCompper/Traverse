# Traverse

Open `index.html` and choose **Start the investigation** to play the restaurant case. On an incorrect answer, **Request a cloud hint** previews the data before sending. A rejected or unavailable cloud hint is replaced by a written hint. The loopback build supports a temporary App Check token under **Local test settings**. For the original greenhouse and bus lesson, choose **Explore**. Traverse teaches a reasoning method in plant science, then asks players to apply it in urban policy. In the city exercise, choose **Use an example answer**, **Get a short hint**, then **Compare with deeper feedback**. The prepared example shows how the second hint can build on the player's comparison. Custom answers use the rule-based demo hint until Firebase is configured.

## Enable live tutors

1. Register a web app in a dedicated Firebase test project. Enable Firebase AI Logic with the Gemini Developer API backend, and register the app with App Check using reCAPTCHA Enterprise.
2. Copy the Firebase web configuration and public reCAPTCHA site key into `config.js`. Use the authorized domain of your test server. Keep secret keys, debug tokens and production project credentials outside the source.
3. Serve this directory over HTTP on localhost or HTTPS. Use desktop Chrome with the device and browser requirements from the Firebase guide. Prepare the device model before testing offline. This prototype loads the SDK from Google's CDN, so cold starts offline have no live tutor.
4. Try the example answer in both tutors. Confirm that the local label reads **Gemini Nano · on-device**, then open the preview and select **Send and analyze** to invoke the cloud path. Verify the device model version separately before claiming Gemini Nano 4 compatibility.

[Firebase on-device guide](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started) · [App Check setup](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)

## Compare the tutors

Serve this directory on loopback, for example from the repository root with `python -m http.server 8765 --bind 127.0.0.1 --directory prototype`. Open `http://127.0.0.1:8765/benchmark.html` in desktop Chrome and check the local model first. If a reCAPTCHA site key is absent, the benchmark accepts a temporary App Check debug token on this loopback address. Enter the token in the browser, keep it out of the source, and revoke it after testing.

The benchmark runs three consecutive requests per selected model and shows each raw output and elapsed time. The paired run sends the same prompt and learner data to both exclusive inference paths. Use the device-only option without a debug token, or the cloud-only option when the local model is unavailable.

For Restaurant and Maintenance, both models choose from the same written hints, scored in advance against the case rubric. The cloud uses Firebase AI Logic's plain-text enum schema with the candidate IDs and `NONE`. The local model receives the same instruction and returns text. The benchmark displays the chosen hint only when its ID is valid and it passes every criterion. Open **Validation** for the original model output and the checks. Rejected outputs and inference errors use a written fallback. The bus benchmark still uses free-text hints and manual review. The playable restaurant shares the same hint catalog and validation; the original greenhouse and bus lesson is available through Explore.
