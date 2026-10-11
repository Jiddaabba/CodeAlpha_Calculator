(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const el = {
    expression: $("#expression"), result: $("#result"), status: $("#statusText"),
    theme: $("#themeBtn"), sound: $("#soundBtn"), angle: $("#angleBtn"),
    angleSelect: $("#angleSelect"), precision: $("#precisionSelect"),
    haptic: $("#hapticToggle"), grouping: $("#groupingToggle"),
    memory: $("#memoryIndicator"), undo: $("#undoBtn"), toast: $("#toast"),
    sci: $("#scientificKeys"), historyPanel: $("#historyPanel"),
    settingsPanel: $("#settingsPanel"), historyList: $("#historyList"),
    historyCount: $("#historyCount"), modeButtons: $$(".mode")
  };

  const STORAGE = "jiddas-calculator-v1";
  const defaults = {
    theme: "dark", angle: "DEG", precision: 12, grouping: true,
    haptics: false, sound: false, history: [], memory: 0, ans: 0, mode: "basic"
  };
  let state = loadState();
  let expression = "";
  let lastAnswer = 0;
  let justCalculated = false;
  let repeatOperation = null;
  let undoStack = [];
  let toastTimer;
  let audioContext = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || "{}");
      return { ...defaults, ...saved,
        history: Array.isArray(saved.history) ? saved.history.slice(0, 50) : [] };
    } catch { return { ...defaults }; }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
    catch { showToast("Preferences could not be saved in this browser."); }
  }
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1900);
  }
  function feedback() {
    if (state.haptics && navigator.vibrate) navigator.vibrate(10);
    if (state.sound) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        audioContext ||= new AudioCtx();
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.frequency.value = 640; gain.gain.value = 0.025;
        osc.connect(gain); gain.connect(audioContext.destination);
        osc.start(); osc.stop(audioContext.currentTime + 0.035);
      } catch {}
    }
  }
  function cleanNumber(value) {
    if (!Number.isFinite(value)) throw new Error("Result is too large or undefined.");
    if (Object.is(value, -0)) value = 0;
    return Number(value.toPrecision(Number(state.precision))).toString();
  }
  function prettyNumber(value) {
    const text = cleanNumber(value);
    if (!state.grouping || /e/i.test(text)) return text;
    const parts = text.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  // A small recursive-descent parser. It never evaluates arbitrary JavaScript.
  function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
      const rest = input.slice(i);
      if (/^\s+/.test(rest)) { i += rest.match(/^\s+/)[0].length; continue; }
      const num = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
      if (num) { tokens.push({ type: "number", value: Number(num[0]) }); i += num[0].length; continue; }
      const name = rest.match(/^[a-z]+/i);
      if (name) { tokens.push({ type: "name", value: name[0].toLowerCase() }); i += name[0].length; continue; }
      const ch = input[i];
      if (ch === "π") { tokens.push({ type: "number", value: Math.PI }); i++; continue; }
      if ("+-*/^()%!".includes(ch)) { tokens.push({ type: ch, value: ch }); i++; continue; }
      throw new Error(`Unsupported character: ${ch}`);
    }
    // Allow implicit multiplication: 2π, 2(3+4), and )(
    const expanded = [];
    for (let j = 0; j < tokens.length; j++) {
      const a = tokens[j], b = tokens[j + 1];
      expanded.push(a);
      if (b && (
        (["number", ")","!"].includes(a.type) && ["number","name","("].includes(b.type)) ||
        (a.type === "number" && b.type === "name") ||
        (a.type === ")" && b.type === "number")
      )) expanded.push({ type: "*", value: "*" });
    }
    return expanded;
  }

  function parseExpression(input) {
    const tokens = tokenize(input);
    let pos = 0;
    const peek = () => tokens[pos];
    const take = (type) => {
      if (!peek() || peek().type !== type) throw new Error(`Expected ${type}`);
      return tokens[pos++];
    };
    const angle = (v) => state.angle === "DEG" ? v * Math.PI / 180 : v;
    const fromAngle = (v) => state.angle === "DEG" ? v * 180 / Math.PI : v;
    function expressionRule() {
      let v = term();
      while (peek() && ["+", "-"].includes(peek().type)) {
        const op = tokens[pos++].type, rhs = term();
        v = op === "+" ? v + rhs : v - rhs;
      }
      return v;
    }
    function term() {
      let v = unary();
      while (peek() && ["*", "/", "%"].includes(peek().type)) {
        const op = tokens[pos++].type, rhs = unary();
        if ((op === "/" || op === "%") && rhs === 0) throw new Error("Cannot divide by zero.");
        if (op === "*") v *= rhs;
        if (op === "/") v /= rhs;
        if (op === "%") v %= rhs;
      }
      return v;
    }
    function unary() {
      if (peek() && peek().type === "+") { pos++; return unary(); }
      if (peek() && peek().type === "-") { pos++; return -unary(); }
      return power();
    }
    function power() {
      let v = postfix();
      if (peek() && peek().type === "^") { pos++; v = Math.pow(v, unary()); }
      return v;
    }
    function postfix() {
      let v = primary();
      while (peek() && ["!", "%"].includes(peek().type)) {
        const op = tokens[pos++].type;
        if (op === "%") v /= 100;
        else {
          if (!Number.isInteger(v) || v < 0 || v > 170) throw new Error("Factorial needs a whole number from 0 to 170.");
          let f = 1; for (let n = 2; n <= v; n++) f *= n; v = f;
        }
      }
      return v;
    }
    function primary() {
      const token = peek();
      if (!token) throw new Error("Enter a number or expression.");
      if (token.type === "number") { pos++; return token.value; }
      if (token.type === "(") { pos++; const v = expressionRule(); take(")"); return v; }
      if (token.type === "name") {
        pos++;
        if (token.value === "pi") return Math.PI;
        if (token.value === "e") return Math.E;
        take("(");
        const x = expressionRule(); take(")");
        const funcs = {
          sin: () => Math.sin(angle(x)), cos: () => Math.cos(angle(x)),
          tan: () => { if (Math.abs(Math.cos(angle(x))) < 1e-12) throw new Error("Tangent is undefined at this angle."); return Math.tan(angle(x)); },
          asin: () => fromAngle(Math.asin(x)), acos: () => fromAngle(Math.acos(x)),
          atan: () => fromAngle(Math.atan(x)), sqrt: () => Math.sqrt(x),
          log: () => Math.log10(x), ln: () => Math.log(x),
          abs: () => Math.abs(x), exp: () => Math.exp(x)
        };
        if (!funcs[token.value]) throw new Error(`Unknown function: ${token.value}`);
        if ((["sqrt","log","ln"].includes(token.value) && x < 0) ||
            (["log","ln"].includes(token.value) && x === 0) ||
            (["asin","acos"].includes(token.value) && Math.abs(x) > 1)) {
          throw new Error("This function is undefined for that value.");
        }
        return funcs[token.value]();
      }
      throw new Error("Check the expression.");
    }
    const result = expressionRule();
    if (pos !== tokens.length) throw new Error("Check the expression.");
    if (!Number.isFinite(result)) throw new Error("Result is too large or undefined.");
    return result;
  }

  function currentValue() {
    if (!expression) return 0;
    return parseExpression(expression);
  }
  function render() {
    el.expression.textContent = expression || "0";
    el.undo.disabled = undoStack.length === 0;
    el.memory.hidden = !state.memory;
    el.angle.textContent = state.angle;
    el.angleSelect.value = state.angle;
    el.precision.value = String(state.precision);
    el.haptic.checked = state.haptics;
    el.grouping.checked = state.grouping;
    el.sound.textContent = state.sound ? "♫" : "♪";
    document.body.classList.toggle("light", state.theme === "light");
    el.theme.textContent = state.theme === "light" ? "☾" : "☀";
    el.modeButtons.forEach(btn => {
      const active = btn.dataset.mode === state.mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    el.sci.hidden = state.mode !== "scientific";
    el.historyCount.textContent = state.history.length;
    if (!expression) { el.result.textContent = "0"; el.status.textContent = "Ready when you are"; return; }
    try {
      const value = currentValue();
      el.result.textContent = prettyNumber(value);
      el.status.textContent = justCalculated ? "Calculation complete" : "Live result";
    } catch (err) {
      el.result.textContent = "—";
      el.status.textContent = err.message;
    }
  }
  function rememberEdit() {
    undoStack.push(expression);
    if (undoStack.length > 60) undoStack.shift();
    if (undoStack.length === 0) el.undo.disabled = true;
  }
  function insert(value) {
    feedback();
    if (justCalculated && /^(?:\d|\.|π|e|[a-z])/.test(value)) expression = "";
    justCalculated = false;
    rememberEdit();
    if (value === "ANS") value = cleanNumber(state.ans);
    expression += value;
    render();
  }
  function clearAll() { rememberEdit(); expression = ""; justCalculated = false; repeatOperation = null; render(); }
  function deleteLast() { rememberEdit(); expression = expression.slice(0, -1); justCalculated = false; render(); }
  function toggleSign() {
    rememberEdit();
    if (!expression) expression = "-";
    else if (expression.startsWith("-(") && expression.endsWith(")")) expression = expression.slice(2, -1);
    else expression = `-(${expression})`;
    justCalculated = false; render();
  }
  function doCalculation() {
    if (!expression.trim()) return;
    try {
      const source = expression;
      const answer = parseExpression(source);
      state.ans = answer;
      lastAnswer = answer;
      state.history.unshift({ id: Date.now() + Math.random(), expression: source, result: cleanNumber(answer), time: new Date().toISOString() });
      state.history = state.history.slice(0, 50);
      saveState();
      expression = cleanNumber(answer);
      justCalculated = true;
      repeatOperation = null;
      render(); renderHistory(); feedback();
    } catch (err) {
      el.status.textContent = err.message;
      el.result.textContent = "Error";
      showToast(err.message);
    }
  }
  function undo() {
    if (!undoStack.length) return;
    expression = undoStack.pop(); justCalculated = false; render();
  }
  function memoryAction(action) {
    try {
      const value = currentValue();
      if (action === "memory-clear") state.memory = 0;
      if (action === "memory-recall") { rememberEdit(); expression += cleanNumber(state.memory); justCalculated = false; }
      if (action === "memory-add") state.memory += value;
      if (action === "memory-subtract") state.memory -= value;
      saveState(); render(); showToast(action === "memory-clear" ? "Memory cleared" : "Memory updated");
    } catch { showToast("Enter a valid calculation first."); }
  }
  async function copyResult() {
    try {
      const value = expression ? cleanNumber(currentValue()) : "0";
      await navigator.clipboard.writeText(value);
      showToast("Result copied");
    } catch { showToast("Clipboard access isn't available here."); }
  }
  async function shareCalculation() {
    const content = `${expression || "0"} = ${el.result.textContent}`;
    try {
      if (navigator.share) await navigator.share({ title: "Jidda's Calculator", text: content });
      else { await navigator.clipboard.writeText(content); showToast("Calculation copied for sharing"); }
    } catch (err) { if (err.name !== "AbortError") showToast("Sharing isn't available here."); }
  }
  function renderHistory() {
    el.historyList.replaceChildren();
    if (!state.history.length) {
      const empty = document.createElement("p"); empty.className = "empty-history"; empty.textContent = "Your calculations will appear here.";
      el.historyList.append(empty); return;
    }
    state.history.forEach(item => {
      const row = document.createElement("div"); row.className = "history-entry";
      const reuse = document.createElement("button"); reuse.className = "history-reuse";
      const expr = document.createElement("span"); expr.textContent = item.expression;
      const result = document.createElement("strong"); result.textContent = item.result;
      reuse.append(expr, result); reuse.setAttribute("aria-label", `Reuse ${item.expression}, result ${item.result}`);
      reuse.addEventListener("click", () => { rememberEdit(); expression = item.expression; justCalculated = false; render(); });
      const del = document.createElement("button"); del.className = "history-delete"; del.textContent = "×"; del.title = "Delete calculation";
      del.setAttribute("aria-label", "Delete this calculation");
      del.addEventListener("click", () => { state.history = state.history.filter(h => h.id !== item.id); saveState(); render(); renderHistory(); });
      row.append(reuse, del); el.historyList.append(row);
    });
  }
  function togglePanel(panel) {
    const show = panel.hidden;
    el.historyPanel.hidden = true; el.settingsPanel.hidden = true;
    panel.hidden = !show;
    if (panel === el.historyPanel) renderHistory();
  }

  document.addEventListener("click", event => {
    const btn = event.target.closest("button");
    if (!btn) return;
    if (btn.dataset.insert !== undefined) insert(btn.dataset.insert);
    if (btn.dataset.action) {
      const action = btn.dataset.action;
      if (action === "clear") clearAll();
      else if (action === "delete") deleteLast();
      else if (action === "equals") doCalculation();
      else if (action === "sign") toggleSign();
      else if (action.startsWith("memory-")) memoryAction(action);
      else if (action === "history-toggle") togglePanel(el.historyPanel);
    }
  });
  el.modeButtons.forEach(btn => btn.addEventListener("click", () => { state.mode = btn.dataset.mode; saveState(); render(); }));
  el.theme.addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; saveState(); render(); });
  el.sound.addEventListener("click", () => { state.sound = !state.sound; saveState(); render(); showToast(`Sound ${state.sound ? "enabled" : "disabled"}`); });
  el.angle.addEventListener("click", () => { state.angle = state.angle === "DEG" ? "RAD" : "DEG"; saveState(); render(); });
  $("#settingsBtn").addEventListener("click", () => togglePanel(el.settingsPanel));
  $("#closeSettingsBtn").addEventListener("click", () => { el.settingsPanel.hidden = true; });
  $("#undoBtn").addEventListener("click", undo);
  $("#copyBtn").addEventListener("click", copyResult);
  $("#shareBtn").addEventListener("click", shareCalculation);
  $("#ansBtn").addEventListener("click", () => insert("ANS"));
  $("#clearHistoryBtn").addEventListener("click", () => { state.history = []; saveState(); render(); renderHistory(); showToast("History cleared"); });
  el.angleSelect.addEventListener("change", () => { state.angle = el.angleSelect.value; saveState(); render(); });
  el.precision.addEventListener("change", () => { state.precision = Number(el.precision.value); saveState(); render(); });
  el.haptic.addEventListener("change", () => { state.haptics = el.haptic.checked; saveState(); });
  el.grouping.addEventListener("change", () => { state.grouping = el.grouping.checked; saveState(); render(); });
  $("#resetSettingsBtn").addEventListener("click", () => {
    state = { ...defaults, history: state.history, memory: 0, ans: 0 };
    saveState(); render(); showToast("Preferences reset");
  });

  document.addEventListener("keydown", event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[0-9.+\-*/%^()]$/.test(event.key)) { event.preventDefault(); insert(event.key); }
    else if (event.key === "Enter" || event.key === "=") { event.preventDefault(); doCalculation(); }
    else if (event.key === "Backspace") { event.preventDefault(); deleteLast(); }
    else if (event.key === "Escape") { clearAll(); el.historyPanel.hidden = true; el.settingsPanel.hidden = true; }
    else if (event.key.toLowerCase() === "s") { state.mode = state.mode === "basic" ? "scientific" : "basic"; saveState(); render(); }
  });

  // Tiny built-in smoke tests: run with ?test=1 and inspect the browser console.
  function runSmokeTests() {
    const cases = [
      ["2+3*4", 14], ["(2+3)*4", 20], ["2^3", 8],
      ["sqrt(81)", 9], ["sin(30)", 0.5], ["2π", 2 * Math.PI],
      ["5!", 120], ["50%", 0.5], ["-2^2", -4]
    ];
    let passed = 0;
    for (const [input, expected] of cases) {
      try {
        const actual = parseExpression(input);
        if (Math.abs(actual - expected) < 1e-9) passed++;
        else console.error("FAIL", input, actual, expected);
      } catch (error) { console.error("FAIL", input, error); }
    }
    console.info(`Jidda's Calculator smoke tests: ${passed}/${cases.length} passed`);
  }

  render(); renderHistory();
  if (new URLSearchParams(location.search).has("test")) runSmokeTests();
})();
