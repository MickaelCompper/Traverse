"use strict";

const get = (id) => document.getElementById(id);
const settings = window.tutorSettings;
const hasFirebase = Boolean(settings?.firebase?.apiKey && settings.firebase.projectId
  && settings.firebase.appId);
const debugMode = hasFirebase && !settings.appCheckSiteKey && location.hostname === "127.0.0.1";
const tokenField = get("debug-token");
const localButton = get("run-local");
const cloudButton = get("run-cloud");
const pairedButton = get("run");
const cloudAvailable = hasFirebase && Boolean(settings.appCheckSiteKey || debugMode);
const cases = {
  ...validatedCases,
  bus: {
    context: "A bus route opens, downtown counts fall, and a major downtown road closes the same week. Other factor: the road closure.",
    reason: "The road closure may divert cars onto other streets.",
    plan: "I would count cars on neighboring streets too and compare the total before and after.",
    rubric: [
      "Recognizes that counting nearby streets can help detect diversion.",
      "Names both the bus route and the closure as explanations a change in total counts cannot separate.",
      "Asks one question that helps the learner test the missing distinction.",
    ],
  },
};
const caseField = get("case");
const resultCache = new Map();
function showValidatedHint(item, raw, exercise, seconds) {
  const { proposed, accepted, text } = validateHint(exercise, raw);
  item.textContent = (accepted ? "Accepted model choice: " : "Written fallback: ")
    + text + " (" + seconds + " s)";
  const audit = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = accepted ? "Validation · accepted" : "Validation · rejected";
  audit.append(summary);
  const evidence = document.createElement("p");
  evidence.textContent = "Model output: " + (raw || "(empty)") + (proposed ? " · " + proposed.text : "");
  audit.append(evidence);
  if (!proposed) {
    const failure = document.createElement("p");
    failure.textContent = "No valid hint ID.";
    audit.append(failure);
  } else {
    const failures = document.createElement("ul");
    for (const [index, criterion] of exercise.rubric.entries()) {
      const row = document.createElement("li");
      row.textContent = (proposed.failed.includes(index) ? "Fail · " : "Pass · ") + criterion;
      failures.append(row);
    }
    audit.append(failures);
  }
  item.append(audit);
}
function showReview(item, rubric) {
  const review = document.createElement("details");
  const label = document.createElement("summary");
  label.textContent = "Review · not assessed";
  review.append(label);
  const checks = rubric.map((criterion) => {
    const row = document.createElement("label");
    row.className = "option";
    const check = document.createElement("input");
    check.type = "checkbox";
    row.append(check, criterion);
    review.append(row);
    return check;
  });
  const verdict = document.createElement("button");
  verdict.type = "button";
  verdict.className = "secondary";
  verdict.textContent = "Record verdict";
  verdict.addEventListener("click", () => {
    const passed = checks.filter((check) => check.checked).length;
    label.textContent = `Review · ${passed === checks.length ? "accepted" : "rejected"} (${passed}/${checks.length})`;
  });
  checks.forEach((check) => check.addEventListener("change", () => {
    label.textContent = "Review · not assessed";
  }));
  review.append(verdict);
  item.append(review);
}
function showCase() {
  const exercise = cases[caseField.value];
  get("case-facts").textContent = exercise.context;
  get("reason").value = exercise.reason;
  get("plan").value = exercise.plan;
  get("rubric").replaceChildren(...exercise.rubric.map((criterion) => {
    const item = document.createElement("li");
    item.textContent = criterion;
    return item;
  }));
  const cached = resultCache.get(caseField.value);
  get("results").hidden = !cached;
  for (const mode of ["local", "cloud"]) {
    get(mode).replaceChildren(...(cached?.[mode] || []));
  }
}
caseField.addEventListener("change", showCase);
showCase();
const deviceOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};
const prepareDevice = get("prepare-device");

get("debug-field").hidden = !debugMode;
pairedButton.disabled = !cloudAvailable;
cloudButton.disabled = !cloudAvailable;
localButton.disabled = !hasFirebase;
if (get("run").disabled) {
  get("setup").textContent = "Set up the test project and App Check in config.js to run both models.";
}

get("check-device").addEventListener("click", async () => {
  try {
    const api = globalThis.LanguageModel;
    const status = api ? await api.availability(deviceOptions) : "Prompt API unavailable";
    prepareDevice.hidden = status !== "downloadable" && status !== "downloading";
    get("device").textContent = "Chrome reports: " + status;
  } catch (error) {
    get("device").textContent = "Device check failed: " + error.name;
  }
});

prepareDevice.addEventListener("click", async () => {
  prepareDevice.disabled = true;
  get("device").textContent = "Preparing Chrome’s local model…";
  try {
    const session = await globalThis.LanguageModel.create({
      ...deviceOptions,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          get("device").textContent = "Downloading: " + Math.round(event.loaded * 100) + "%";
        });
      },
    });
    session.destroy();
    prepareDevice.hidden = true;
    get("device").textContent = "Chrome reports: available";
  } catch (error) {
    get("device").textContent = "Model preparation failed: " + error.name;
  } finally {
    prepareDevice.disabled = false;
  }
});

get("comparison").addEventListener("submit", async (event) => {
  event.preventDefault();
  const localOnly = event.submitter === localButton;
  const cloudOnly = event.submitter === cloudButton;
  const modes = localOnly ? ["local"] : cloudOnly ? ["cloud"] : ["local", "cloud"];
  if ((event.submitter || pairedButton).disabled) return;
  const reason = get("reason").value.trim();
  const plan = get("plan").value.trim();
  const caseId = caseField.value;
  const exercise = cases[caseId];
  const { context, rubric } = exercise;
  if (!plan) {
    get("setup").textContent = "Enter a comparison plan first.";
    return;
  }
  if (debugMode && !localOnly) {
    const token = tokenField.value.trim();
    if (!token && !globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN) {
      get("setup").textContent = "Enter a temporary App Check debug token.";
      return;
    }
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN ||= token;
    tokenField.value = "";
  }
  get("setup").textContent = "";
  pairedButton.disabled = true;
  cloudButton.disabled = true;
  localButton.disabled = true;
  caseField.disabled = true;
  get("results").hidden = false;
  try {
    const { comparePlan, selectValidatedHint } = await import("./firebase-tutor.mjs?v=6");
    await Promise.all(modes.map(async (mode) => {
      const results = get(mode);
      results.replaceChildren();
      for (let trial = 0; trial < 3; trial += 1) {
        const item = document.createElement("li");
        item.textContent = "Running…";
        results.append(item);
        const start = performance.now();
        try {
          const hint = exercise.hints
            ? await selectValidatedHint(mode, context, reason, plan, exercise.hints)
            : await comparePlan(mode, context, reason, plan);
          const seconds = ((performance.now() - start) / 1000).toFixed(2);
          if (exercise.hints) showValidatedHint(item, hint, exercise, seconds);
          else {
            item.textContent = hint + " (" + seconds + " s)";
            showReview(item, rubric);
          }
        } catch (error) {
          const failure = "Inference failed: " + (error.code || error.name);
          if (exercise.hints) showValidatedHint(item, failure, exercise, ((performance.now() - start) / 1000).toFixed(2));
          else item.textContent = failure;
        }
      }
    }));
    resultCache.set(caseId, {
      local: Array.from(get("local").children),
      cloud: Array.from(get("cloud").children),
    });
  } catch (error) {
    get("setup").textContent = "Firebase initialization failed: " + (error.code || error.name);
    get("results").hidden = true;
  } finally {
    const reloadForDebug = localOnly && debugMode && !globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN;
    pairedButton.disabled = !cloudAvailable || reloadForDebug;
    cloudButton.disabled = pairedButton.disabled;
    if (reloadForDebug && !get("results").hidden) {
      get("setup").textContent = "Reload this page before starting a paired run with a debug token.";
    }
    localButton.disabled = false;
    caseField.disabled = false;
  }
});
