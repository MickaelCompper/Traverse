"use strict";

const byId = (id) => document.getElementById(id);
const settings = window.tutorSettings;
const configured = Boolean(settings?.firebase.apiKey && settings.firebase.projectId
  && settings.firebase.appId && settings.appCheckSiteKey);
const localDebug = !configured && Boolean(settings?.firebase?.apiKey
  && settings.firebase.projectId && settings.firebase.appId) && location.hostname === "127.0.0.1";
const exampleReason = "The road closure may divert cars onto other streets.";
const examplePlan = "I would count cars on neighboring streets too and compare the total before and after.";
const cases = {
  greenhouse: {
    factor: /\b(sun(?:light)?|light|shade)\b/i,
    context: "Fertilized plants grew faster and were the only plants in direct sunlight. Other factor: light exposure.",
    hints: {
      ASK_CAUSE: "What else differed between the two groups?",
      ASK_EFFECT: "How could the difference in light affect the result?",
      ASK_COMPARISON: "How could you compare the plants while keeping light constant?",
      UNCERTAIN: "Look again at where each group of plants was kept.",
    },
  },
  city: {
    factor: /\b(clos(?:ed|ure|ing)|shut|block(?:ed|age))\b/i,
    context: "A bus route opens, downtown counts fall, and a major downtown road closes the same week. Other factor: the road closure.",
    hints: {
      ASK_CAUSE: "What else changed that week?",
      ASK_EFFECT: "How could the closure change the count?",
      ASK_COMPARISON: "Where else would you count cars to check that idea?",
      UNCERTAIN: "Think about what changed besides the bus route.",
    },
  },
};

let tutorPromise;
const progressKey = "traverse-progress-v1";
const ownerKey = "traverse-sync-owner";
function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
let owner = readLocal(ownerKey) || "";
const keyFor = (uid) => uid ? progressKey + ":" + uid : progressKey;
const stored = readLocal(keyFor(owner)) || {};
const emptyLearning = { attempt: null, completed: false, restaurantCompleted: false, bottleneckTransferred: false };
let learning = { ...emptyLearning, ...stored.learning };
let session = stored.session;
let sessionUpdatedAt = stored.sessionUpdatedAt || (session ? 1 : 0);

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private or full storage can leave progress available only in this tab.
  }
}
function snapshot() {
  return { learning: { ...learning }, session: session || null, sessionUpdatedAt };
}

function persistProgress() {
  writeLocal(keyFor(owner), snapshot());
  queueSync();
}

function comparable(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, comparable(value[key])]));
}

function mergeProgress(local, remote) {
  const latest = (remote.sessionUpdatedAt || 0) >= (local.sessionUpdatedAt || 0) ? remote : local;
  return {
    learning: {
      attempt: remote.learning?.attempt || local.learning?.attempt || null,
      completed: Boolean(local.learning?.completed || remote.learning?.completed),
      restaurantCompleted: Boolean(local.learning?.restaurantCompleted || remote.learning?.restaurantCompleted),
      bottleneckTransferred: Boolean(local.learning?.bottleneckTransferred || remote.learning?.bottleneckTransferred),
    },
    session: latest.session || null,
    sessionUpdatedAt: latest.sessionUpdatedAt || 0,
  };
}

let syncModule;
let syncInit;
let signedInUid = "";
let syncTimer;
let syncing = false;
let syncAgain = false;
let syncStatus = "";
let retryDelay = 1000;
const transientSyncErrors = new Set(["aborted", "cancelled", "deadline-exceeded", "internal", "unavailable", "unknown"]);
const accountSyncEnabled = Boolean(settings?.appCheckSiteKey);

function updateSyncPanel() {
  const button = byId("sync-account");
  if (!button) return;
  button.disabled = !navigator.onLine || !accountSyncEnabled;
  button.textContent = owner ? "Sign out" : "Sign in with Google";
  byId("sync-status").textContent = !accountSyncEnabled ? "Sync is available on the hosted site."
    : !navigator.onLine ? "Offline. Progress is saved in this browser."
      : syncStatus || (owner ? "Waiting to sync…" : "Progress is saved in this browser.");
}

function applyProgress(data, redraw) {
  learning = { ...emptyLearning, ...data.learning };
  session = data.session;
  sessionUpdatedAt = data.sessionUpdatedAt || 0;
  writeLocal(keyFor(owner), snapshot());
  if (redraw) {
    const resume = resumeHandler();
    if (byId("sync-status")) progress();
    else if (resume) resume(session);
    else welcome();
  }
}

function startSync() {
  if (!accountSyncEnabled || !navigator.onLine) return;
  syncInit ??= import("./progress-sync.mjs?v=4").then((module) => {
    syncModule = module;
    module.watchAccount((uid) => {
      signedInUid = uid;
      syncStatus = "";
      if (uid !== owner) {
        const previous = owner;
        const guest = previous ? null : snapshot();
        owner = uid;
        writeLocal(ownerKey, uid);
        const account = readLocal(keyFor(uid)) || {};
        applyProgress(guest ? mergeProgress(guest, account) : account, true);
      }
      updateSyncPanel();
      queueSync();
    });
    return module;
  }).catch((error) => {
    syncInit = undefined;
    throw error;
  });
  return syncInit;
}

function queueSync(delay = 600) {
  if (!owner || owner !== signedInUid || !syncModule || !navigator.onLine) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, delay);
}

async function flushSync() {
  const uid = owner;
  if (!uid || uid !== signedInUid || !navigator.onLine || syncing) return;
  syncing = true;
  let retry = false;
  let deadline;
  const abort = new AbortController();
  syncStatus = "Syncing…";
  updateSyncPanel();
  try {
    const cutoff = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        reject(Object.assign(new Error("Sync timed out"), { code: "deadline-exceeded" }));
        abort.abort();
      }, 12000);
    });
    const result = await Promise.race([syncModule.syncProgress(uid, snapshot(), mergeProgress, abort.signal), cutoff]);
    if (owner !== uid) return;
    const current = snapshot();
    const merged = mergeProgress(current, result);
    const changed = comparable(current) !== comparable(merged);
    applyProgress(merged, changed);
    syncStatus = "Synced to your Google account.";
    retryDelay = 1000;
  } catch (error) {
    if (owner === uid) {
      const code = typeof error.code === "string" ? error.code : "unknown";
      retry = transientSyncErrors.has(code);
      syncStatus = retry ? "Sync interrupted (" + code + "). Retrying; progress is saved in this browser."
        : "Sync unavailable (" + code + "). Your progress is saved in this browser.";
    }
  } finally {
    clearTimeout(deadline);
    syncing = false;
    updateSyncPanel();
    if (syncAgain || retry) {
      syncAgain = false;
      queueSync(retry ? retryDelay : 600);
      if (retry) retryDelay = Math.min(retryDelay * 2, 16000);
    }
  }
}

function bindExercise(stage, form, restored) {
  const fields = [...form.querySelectorAll("input:not([type]), input[type=radio], textarea")];
  const saved = restored?.stage === stage ? restored : null;
  function save(status = "draft", feedback = null) {
    if (!form.isConnected) return;
    const answers = {};
    for (const field of fields) {
      if (field.type === "radio") {
        if (field.checked) answers[field.name] = field.value;
      } else {
        answers[field.id] = field.value;
      }
    }
    const next = { stage, status, answers, feedback };
    if (comparable(next) !== comparable(session)) {
      sessionUpdatedAt = Math.max(sessionUpdatedAt + 1, Date.now() * 1024 + Math.floor(Math.random() * 1024));
    }
    session = next;
    persistProgress();
  }
  if (saved) {
    for (const field of fields) {
      const value = saved.answers?.[field.type === "radio" ? field.name : field.id];
      if (field.type === "radio") field.checked = field.value === value;
      else if (typeof value === "string") field.value = value;
    }
  }
  form.addEventListener("input", () => save());
  save(saved?.status, saved?.feedback);
  return { saved, save };
}
function loadTutor() {
  tutorPromise ??= import("./firebase-tutor.mjs?v=7").catch((error) => {
    tutorPromise = undefined;
    throw error;
  });
  return tutorPromise;
}

async function shortHint(exercise, reason) {
  if (reason && configured) {
    try {
      const tutor = await loadTutor();
      const code = await tutor.chooseHint(exercise.context, reason);
      if (Object.hasOwn(exercise.hints, code)) {
        return { label: "Gemini Nano · on-device", text: exercise.hints[code] };
      }
    } catch {
      // The written hint keeps the exercise usable if the on-device model is unavailable.
    }
    return { label: "Written hint · on-device tutor unavailable", text: exercise.hints.UNCERTAIN };
  }
  if (!reason) return { label: "Written hint", text: exercise.hints.UNCERTAIN };
  const code = !exercise.factor.test(reason) ? "ASK_CAUSE"
    : reason.trim().split(/\s+/).length <= 5 ? "ASK_EFFECT" : "ASK_COMPARISON";
  return { label: "Demo hint · simple rules", text: exercise.hints[code] };
}

function showStep(id, step) {
  byId("exercise").replaceChildren(byId(id).content.cloneNode(true));
  byId("session-nav").hidden = step < 0;
  byId("exercise").closest("main").classList.toggle("is-home", step < 0);
  Array.from(byId("progress").children).forEach((item, index) => {
    if (index === step) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  if (step >= 0) byId("heading").focus();
}

function welcome() {
  selectTab("today");
  showStep("welcome", -1);
  const start = byId("start");
  const resume = resumeHandler();
  if (resume) start.textContent = "Resume investigation";
  start.addEventListener("click", () => resume ? resume(session) : restaurant());
  const restart = byId("start-new");
  restart.hidden = !resume;
  restart.addEventListener("click", () => restaurant());
}

function selectTab(active) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    if (button.dataset.tab === active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function explore() {
  selectTab("explore");
  showStep("explore", -1);
  byId("heading").focus();
  byId("explore-restaurant").addEventListener("click", restaurant);
  byId("explore-lesson").addEventListener("click", garden);
}

function progress() {
  selectTab("progress");
  showStep("learning-progress", -1);
  byId("heading").focus();
  byId("progress-result").textContent = learning.completed
    ? "You applied the same method in plant science and urban policy."
    : "Finish the investigation to see which skill you practised.";
  byId("restaurant-progress").textContent = learning.bottleneckTransferred
    ? "You found what limits throughput in a restaurant and a print shop."
    : learning.restaurantCompleted
      ? "You investigated what limits restaurant service. Next, try the print shop."
      : "The restaurant exercise is ready to try.";
  const attempt = learning.attempt;
  byId("confidence-result").textContent = attempt?.confidence
    ? `You reported ${attempt.confidence}% confidence on your first greenhouse attempt. Your answer was ${attempt.correct ? "correct" : "incorrect"}.`
    : "Choose a confidence level on your first greenhouse attempt to see it here.";
  const account = byId("sync-account");
  account.addEventListener("click", async () => {
    account.disabled = true;
    try {
      const module = await startSync();
      if (!module) return;
      if (owner) await module.disconnectAccount();
      else await module.connectAccount();
    } catch {
      syncStatus = "Could not change the sign-in status. Your progress is saved in this browser.";
    } finally {
      updateSyncPanel();
    }
  });
  updateSyncPanel();
}

function attachValidatedTutor(mountId, review, exercise, save) {
  byId(mountId).append(byId("validated-cloud-controls").content.cloneNode(true));
  const cloud = byId("case-cloud");
  const audit = byId("case-audit");
  const send = byId("case-send");
  const cloudResult = byId("case-cloud-result");
  const localLabel = byId("case-local-label");
  const localHint = byId("case-local-hint");
  const hintLabel = byId("case-hint-label");
  const hint = byId("case-hint");
  const tokenField = byId("case-token");
  byId("case-debug").hidden = !localDebug;
  let draft;
  let revision = 0;
  let firstOutput;
  let followUp;

  function resetReview() {
    revision += 1;
    draft = undefined;
    firstOutput = undefined;
    followUp = undefined;
    review.hidden = true;
    cloud.open = false;
    cloudResult.hidden = true;
    audit.open = false;
    audit.hidden = true;
    send.disabled = false;
  }

  function showReview(answer, writtenHint, restored) {
    resetReview();
    draft = answer;
    send.disabled = true;
    byId("case-share").textContent = "Waiting for the first hint…";
    localLabel.textContent = "On-device tutor";
    localHint.textContent = "Choosing a hint…";
    review.hidden = false;
    review.scrollIntoView({ block: "nearest" });
    if (restored) {
      showFirstHint(answer, writtenHint, restored.firstOutput || "", false);
      if (restored.followUp) showCloudHint(restored.followUp, false);
    } else {
      save("review", {});
      void showLocalHint(answer, writtenHint, revision);
    }
  }

  async function showLocalHint(answer, writtenHint, current) {
    let raw = "";
    try {
      if (await globalThis.LanguageModel?.availability({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      }) === "available") {
        const tutor = await loadTutor();
        const candidates = exercise.hints.filter(({ failed }) => failed.length === 0);
        raw = await tutor.selectValidatedHint("local", exercise.context, answer.reason, answer.plan, candidates);
      }
    } catch {
      // A local model or SDK failure leaves the written hint available.
    }
    if (!review.isConnected || revision !== current) return;
    showFirstHint(answer, writtenHint, raw);
  }

  function showFirstHint(answer, writtenHint, raw, shouldSave = true) {
    const result = validateHint(exercise, raw);
    firstOutput = result.accepted ? result.proposed.id : "";
    const firstHint = result.accepted ? result.text : writtenHint;
    localLabel.textContent = result.accepted ? "Validated Gemini Nano hint · on-device" : "Written first hint";
    localHint.textContent = firstHint;
    draft = { ...answer, firstHint, continuation: continuationFor(exercise, result.accepted ? result.proposed.id : "written") };
    byId("case-share").textContent = exercise.context + "\n\n"
      + "Your explanation: " + draft.reason + "\nYour test plan: " + (draft.plan || "(none)")
      + "\nFirst hint already shown: " + firstHint;
    send.disabled = false;
    if (shouldSave) save("review", { firstOutput });
  }

  send.addEventListener("click", async () => {
    if (!draft?.continuation || send.disabled) return;
    const current = revision;
    const { reason: explanation, plan: comparison, firstHint, continuation } = draft;
    const token = tokenField.value.trim();
    tokenField.value = "";
    send.disabled = true;
    audit.hidden = true;
    cloudResult.hidden = false;
    hintLabel.textContent = "Cloud tutor";
    hint.textContent = "Choosing a hint…";
    let raw = "";
    let unavailable = false;
    let deadline;
    let onOffline;
    try {
      if (!navigator.onLine) throw new Error("Offline");
      if (!configured && !(localDebug && (token || globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN))) {
        throw new Error("Cloud tutor is not configured");
      }
      if (localDebug && token) globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN ||= token;
      const cutoff = new Promise((_, reject) => {
        onOffline = () => reject(new Error("Offline"));
        window.addEventListener("offline", onOffline, { once: true });
        deadline = setTimeout(() => reject(new Error("Cloud hint timed out")), 8000);
      });
      raw = await Promise.race([
        loadTutor().then((tutor) => tutor.selectValidatedHint(
          "cloud", exercise.context, explanation, comparison, continuation.hints, firstHint,
        )),
        cutoff,
      ]);
    } catch {
      unavailable = true;
    } finally {
      clearTimeout(deadline);
      if (onOffline) window.removeEventListener("offline", onOffline);
    }
    if (!review.isConnected || revision !== current) return;
    showCloudHint({ raw, unavailable, offline: !navigator.onLine });
  });

  function showCloudHint(response, shouldSave = true) {
    followUp = response;
    cloud.open = true;
    cloudResult.hidden = false;
    const { continuation } = draft;
    const result = validateHint(continuation, response.raw);
    hintLabel.textContent = result.accepted ? "Validated Gemini cloud hint" : "Written fallback";
    hint.textContent = result.text;
    const checks = byId("case-checks");
    const criteria = result.proposed
      ? continuation.rubric.map((criterion, index) =>
        (result.proposed.failed.includes(index) ? "Failed · " : "Passed · ") + criterion)
      : [response.unavailable
        ? (response.offline ? "You’re offline. This follow-up is available without a connection." : "The cloud did not return a hint.")
        : "The cloud did not select a valid hint."];
    checks.replaceChildren(...criteria.map((criterion) => {
      const item = document.createElement("li");
      item.textContent = criterion;
      return item;
    }));
    audit.hidden = false;
    send.disabled = false;
    if (shouldSave) save("review", { firstOutput, followUp });
  }
  return { resetReview, showReview };
}

function restaurant(restored) {
  selectTab("today");
  showStep("restaurant", -1);
  byId("heading").focus();
  const exercise = validatedCases.restaurant;
  const form = byId("restaurant-form");
  const { saved, save } = bindExercise("restaurant", form, restored);
  const review = byId("restaurant-review");
  const reason = byId("restaurant-reason");
  const plan = byId("restaurant-plan");
  const solution = byId("restaurant-solution");
  const { resetReview, showReview } = attachValidatedTutor("restaurant-cloud-mount", review, exercise, save);

  function showSolution() {
    resetReview();
    form.hidden = true;
    solution.hidden = false;
    learning.restaurantCompleted = true;
    save("solved");
    byId("restaurant-solution-title").focus();
  }

  form.addEventListener("input", resetReview);
  byId("restaurant-example").addEventListener("click", () => {
    reason.value = exercise.reason;
    plan.value = exercise.plan;
    resetReview();
    save();
  });
  function reviewAnswer(answer, feedback) {
    showReview({
      reason: reason.value.trim() || (answer === "tables"
        ? "I would add more tables." : "I would spread customers across more tables."),
      plan: plan.value.trim(),
    }, "More seats change how many people can sit down. What would tell you how fast their orders can be prepared?", feedback);
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const answer = new FormData(form).get("answer");
    if (answer === "kitchen") {
      showSolution();
      return;
    }
    reviewAnswer(answer);
  });

  byId("restaurant-retry").addEventListener("click", () => {
    resetReview();
    save();
    form.querySelector("input:checked")?.focus();
  });
  byId("restaurant-reveal").addEventListener("click", showSolution);
  byId("restaurant-transfer").addEventListener("click", printShop);
  if (saved?.status === "solved") showSolution();
  if (saved?.status === "review") reviewAnswer(saved.answers?.answer, saved.feedback || {});
}

function printShop(restored) {
  showStep("print-shop", -1);
  byId("heading").focus();
  const form = byId("print-form");
  const { saved, save } = bindExercise("print-shop", form, restored);
  const { resetReview, showReview } = attachValidatedTutor(
    "print-cloud-mount", byId("print-feedback"), validatedCases.printShop, save,
  );
  function reviewAnswer(station, feedback) {
    showReview({
      reason: station === "print" ? "I would improve printing." : "I would improve packing.",
      plan: byId("print-plan").value.trim(),
    }, "Every poster still has to pass through all three stations. Which station would set the pace if your chosen one worked faster?", feedback);
  }
  function showSolution() {
    resetReview();
    form.hidden = true;
    byId("print-takeaway").hidden = false;
    learning.bottleneckTransferred = true;
    save("solved");
    byId("print-takeaway-title").focus();
  }
  form.addEventListener("input", resetReview);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const station = new FormData(form).get("station");
    if (station !== "trim") {
      reviewAnswer(station);
      return;
    }
    showSolution();
  });
  byId("print-progress").addEventListener("click", progress);
  if (saved?.status === "solved") showSolution();
  if (saved?.status === "review") reviewAnswer(saved.answers?.station, saved.feedback || {});
}

function garden(restored) {
  selectTab("today");
  showStep("greenhouse", 0);
  const form = byId("garden-form");
  const { saved, save } = bindExercise("greenhouse", form, restored);
  const feedback = byId("garden-feedback");
  let revision = 0;
  form.addEventListener("input", () => { revision += 1; });
  function showCorrect() {
    feedback.hidden = false;
    feedback.textContent = "Yes. With the same light, differences in growth are easier to attribute to the fertilizer.";
    byId("go-city").hidden = false;
    form.querySelectorAll("input, button").forEach((input) => { input.disabled = true; });
    save("solved");
  }
  if (saved?.status === "solved") showCorrect();
  else if (saved?.feedback?.text) {
    feedback.hidden = false;
    feedback.textContent = saved.feedback.text;
  }
  byId("go-city").addEventListener("click", city);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const answer = data.get("garden");
    learning.attempt ??= { confidence: data.get("confidence"), correct: answer === "same" };
    const reason = byId("garden-reason").value.trim();
    feedback.hidden = false;
    if (answer === "same") {
      showCorrect();
      return;
    }
    save();
    const submit = form.querySelector("button");
    const current = revision;
    submit.disabled = true;
    feedback.textContent = "Preparing a hint…";
    const hint = await shortHint(cases.greenhouse, reason);
    if (!feedback.isConnected) return;
    submit.disabled = false;
    if (revision !== current) {
      feedback.hidden = true;
      return;
    }
    feedback.textContent = hint.label + " — " + hint.text;
    save("review", { text: feedback.textContent });
  });
}

function city(restored) {
  showStep("city", 1);
  const reasonField = byId("reason");
  const planField = byId("plan");
  const form = byId("city-form");
  const { saved, save } = bindExercise("city", form, restored);
  const submit = form.querySelector("[type=submit]");
  const sample = byId("sample");
  const review = byId("review");
  const status = byId("city-status");
  const send = byId("send-cloud");
  let draft;
  let firstHint;
  let revision = 0;

  function invalidateReview() {
    revision += 1;
    draft = undefined;
    firstHint = undefined;
    review.hidden = true;
    byId("advanced").open = false;
    byId("cloud-result").hidden = true;
    status.textContent = "";
    send.disabled = false;
  }
  form.addEventListener("input", invalidateReview);
  sample.addEventListener("click", () => {
    reasonField.value = exampleReason;
    planField.value = examplePlan;
    invalidateReview();
    save();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    invalidateReview();
    save();
    const version = revision;
    const reason = reasonField.value.trim();
    const plan = planField.value.trim();
    submit.disabled = true;
    status.textContent = "Preparing a hint…";
    const hint = await shortHint(cases.city, reason);
    submit.disabled = false;
    if (revision !== version || !review.isConnected) return;
    renderReview(reason, plan, hint);
    save("review", { firstHint });
  });
  function renderReview(reason, plan, hint) {
    status.textContent = "";
    draft = { reason, plan };
    firstHint = hint;
    byId("local-label").textContent = hint.label;
    byId("local-text").textContent = hint.text;
    const canSend = configured && Boolean(plan);
    const isExample = reason === exampleReason && plan === examplePlan;
    byId("cloud-options").hidden = !canSend;
    byId("example-note").hidden = configured;
    byId("example-note").textContent = isExample
      ? "This example uses prepared feedback. Live analysis requires Firebase configuration."
      : "Live analysis requires Firebase configuration. Use the example answer to try the prepared comparison.";
    byId("show-example").hidden = configured || !isExample;
    byId("advanced").hidden = configured && !plan;
    if (canSend) {
      byId("share-preview").textContent = cases.city.context + "\n\n"
        + JSON.stringify(draft, null, 2);
    }
    review.hidden = false;
  }
  function showFeedback(label, feedback) {
    if (!review.isConnected) return;
    byId("cloud-label").textContent = label;
    byId("cloud-text").textContent = feedback;
    byId("cloud-result").hidden = false;
  }
  byId("show-example").addEventListener("click", () => {
    showFeedback("Prepared cloud example",
      "Counting nearby streets helps you check whether cars were diverted. "
      + "If the total still fell, what comparison would separate the bus effect from the closure effect?");
    saveCloudFeedback();
  });
  function saveCloudFeedback() {
    if (!review.isConnected) return;
    save("review", { firstHint, cloud: {
      label: byId("cloud-label").textContent,
      text: byId("cloud-text").textContent,
    } });
  }
  send.addEventListener("click", async () => {
    if (!configured || !draft?.plan || send.disabled) return;
    const { reason, plan } = draft;
    const version = revision;
    send.disabled = true;
    showFeedback("Cloud tutor", "Analyzing your plan…");
    try {
      const tutor = await loadTutor();
      const feedback = await tutor.analyzePlan(cases.city.context, reason, plan);
      if (revision === version) showFeedback("Gemini · cloud", feedback);
    } catch {
      if (revision === version) showFeedback("Cloud tutor unavailable",
        "Try again or continue to the final comparison.");
    } finally {
      if (revision === version && review.isConnected) {
        send.disabled = false;
        saveCloudFeedback();
      }
    }
  });
  byId("go-final").addEventListener("click", () => {
    revision += 1;
    conclusion();
  });
  if (saved?.status === "review" && saved.feedback?.firstHint) {
    renderReview(reasonField.value.trim(), planField.value.trim(), saved.feedback.firstHint);
    if (saved.feedback.cloud) {
      byId("advanced").open = true;
      showFeedback(saved.feedback.cloud.label, saved.feedback.cloud.text);
    }
  }
}

function conclusion(restored) {
  showStep("conclusion", 2);
  const form = byId("final-form");
  const { saved, save } = bindExercise("conclusion", form, restored);
  const explanations = {
    downtown: "Both changes happened at the same time. The downtown count alone cannot tell you which change mattered.",
    nearby: "Counting neighboring streets helps detect diverted traffic. Both the bus and the closure could still explain a change in the total.",
    matched: "This is the strongest of the three. Compare the change in each area, with similar closures and only one new bus route. As with light in the greenhouse, you account for the competing explanation before attributing the effect.",
  };
  function showAnswer(answer) {
    const feedback = byId("final-feedback");
    feedback.textContent = explanations[answer] || "";
    feedback.hidden = false;
    if (answer === "matched") {
      learning.completed = true;
      form.querySelectorAll("input, button").forEach((input) => { input.disabled = true; });
      byId("takeaway").hidden = false;
    }
    save(answer === "matched" ? "solved" : "review");
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    showAnswer(new FormData(form).get("final"));
  });
  if (saved?.status === "solved" || saved?.status === "review") showAnswer(saved.answers?.final);
  byId("restart").addEventListener("click", () => {
    welcome();
    byId("heading").focus();
  });
}

byId("mode").textContent = configured ? "Firebase tutors configured" : "Practice demo";
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  function showOfflineReady() {
    if (navigator.serviceWorker.controller) byId("mode").textContent = "Saved for offline use";
  }
  navigator.serviceWorker.addEventListener("controllerchange", showOfflineReady);
  navigator.serviceWorker.register("./sw.js").then(showOfflineReady).catch(() => {
    // The site is still playable when this browser cannot install the cache.
  });
}
const tabs = { today: welcome, explore, progress };
const resumable = { restaurant, "print-shop": printShop, greenhouse: garden, city, conclusion };
function resumeHandler() {
  return Object.hasOwn(resumable, session?.stage) ? resumable[session.stage] : null;
}
document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => tabs[button.dataset.tab]());
});
const resume = resumeHandler();
if (resume) resume(session);
else welcome();
window.addEventListener("offline", updateSyncPanel);
window.addEventListener("online", () => {
  retryDelay = 1000;
  updateSyncPanel();
  startSync()?.catch(() => {});
  queueSync();
});
window.addEventListener("focus", () => queueSync());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) queueSync();
});
startSync()?.catch(() => {});
