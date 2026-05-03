import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { convertText } from "@/utils/convert.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LexiEase — Making any text easier to read" },
      {
        name: "description",
        content:
          "LexiEase rewrites any text using British Dyslexia Association guidelines. Customizable fonts, spacing, color overlays, and read-aloud.",
      },
      { property: "og:title", content: "LexiEase — Dyslexia-friendly text converter" },
      {
        property: "og:description",
        content:
          "Paste any article, email or document. LexiEase rewrites it using BDA guidelines and displays it in a fully customizable, dyslexia-optimized way.",
      },
    ],
  }),
  component: LexiEase,
});

/* ───────── Constants ───────── */

const STORAGE_KEY = "lexiease_v1_prefs";

type Level = "simple" | "standard" | "detailed";

interface Prefs {
  font: string;
  fontSize: number;
  letterSpacing: number;
  wordSpacing: number;
  lineHeight: number;
  overlay: string;
  speechRate: number;
  readingLevel: Level;
  lastConverted: string;
}

const DEFAULTS: Prefs = {
  font: "OpenDyslexic, sans-serif",
  fontSize: 20,
  letterSpacing: 0.05,
  wordSpacing: 0.1,
  lineHeight: 1.75,
  overlay: "#FFF9E6",
  speechRate: 0.9,
  readingLevel: "standard",
  lastConverted: "",
};

const OVERLAYS: { name: string; bg: string; label: string }[] = [
  { name: "White", bg: "#FFFFFF", label: "Standard" },
  { name: "Cream", bg: "#FFF9E6", label: "BDA recommended" },
  { name: "Yellow", bg: "#FFFACD", label: "High contrast" },
  { name: "Sky Blue", bg: "#E8F4FD", label: "Reduces glare" },
  { name: "Soft Pink", bg: "#FDE8F4", label: "Warm tone" },
  { name: "Mint", bg: "#E8FDF4", label: "Cool tone" },
  { name: "Lavender", bg: "#F0EEFE", label: "Gentle purple" },
  { name: "Peach", bg: "#FEF0E8", label: "Warm peach" },
];

const FONTS = [
  { value: "OpenDyslexic, sans-serif", label: "OpenDyslexic (recommended)" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: '"Comic Sans MS", cursive', label: "Comic Sans MS" },
  { value: '"Lexie Readable", sans-serif', label: "Lexie Readable" },
];

const LEVELS: { value: Level; name: string; desc: string }[] = [
  { value: "simple", name: "Simple", desc: "≤ 8 words/sentence · ages 8–12, severe dyslexia, EAL learners" },
  { value: "standard", name: "Standard (default)", desc: "≤ 15 words/sentence · most dyslexic adults" },
  { value: "detailed", name: "Detailed", desc: "≤ 20 words/sentence · professionals, students, mild dyslexia" },
];

/* ───────── Helpers ───────── */

function analyzeText(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 2);
  const avg = sentences.length ? Math.round(words.length / sentences.length) : 0;
  return { wordCount: words.length, sentenceCount: sentences.length, avg };
}

function todayStr() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

type BannerType = "error" | "warning" | "info" | "success";
interface Banner {
  type: BannerType;
  message: string;
  persist?: boolean;
}

/* ───────── Component ───────── */

function LexiEase() {
  const convert = useServerFn(convertText);

  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const [ttsSupported, setTtsSupported] = useState(true);
  const [ttsState, setTtsState] = useState<"stopped" | "playing" | "paused">("stopped");
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);

  const [copyLabel, setCopyLabel] = useState("⎘ Copy");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerTimer = useRef<number | null>(null);

  // Load prefs once
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPrefs({ ...DEFAULTS, ...parsed });
        if (parsed.lastConverted) setOutput(parsed.lastConverted);
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && !("speechSynthesis" in window)) {
      setTtsSupported(false);
    }
  }, []);

  // Persist prefs (debounced via React batching)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const updatePref = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setPrefs((p) => ({ ...p, [k]: v }));

  /* ── Banner ── */
  const showBanner = useCallback((b: Banner) => {
    setBanner(b);
    if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    if (!b.persist) {
      bannerTimer.current = window.setTimeout(() => setBanner(null), 6000);
    }
  }, []);

  /* ── Convert flow ── */
  const handleConvert = async () => {
    const text = input.trim();
    if (!text) {
      showBanner({ type: "warning", message: "Please paste some text before converting." });
      return;
    }
    if (text.length > 10000) {
      showBanner({
        type: "warning",
        message: `Your text is ${text.length} characters. Please reduce to under 10,000.`,
      });
      return;
    }
    setLoading(true);
    stopReading();
    try {
      const result = await convert({ data: { text, level: prefs.readingLevel } });
      if (!result.ok) {
        showBanner({ type: "error", message: result.error });
      } else {
        setOutput(result.output);
        setOriginalText(text);
        updatePref("lastConverted", result.output);
        showBanner({ type: "success", message: "Text converted successfully." });
      }
    } catch (e) {
      console.error(e);
      showBanner({
        type: "error",
        message: "Something unexpected happened. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  /* ── TTS ── */
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const wordSpans = useMemo(() => {
    if (!output) return [] as { text: string; start: number }[];
    const parts: { text: string; start: number }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      parts.push({ text: m[0], start: m.index });
    }
    return parts;
  }, [output]);

  function readAloud() {
    if (!ttsSupported || !output.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(output);
    u.rate = prefs.speechRate;
    u.pitch = 1;
    u.lang = "en-GB";
    u.onboundary = (e) => {
      if (e.name && e.name !== "word") return;
      const idx = wordSpans.findIndex(
        (w, i) =>
          e.charIndex >= w.start &&
          (i === wordSpans.length - 1 || e.charIndex < wordSpans[i + 1].start),
      );
      if (idx >= 0) setHighlightIdx(idx);
    };
    u.onend = () => {
      setHighlightIdx(null);
      setTtsState("stopped");
    };
    u.onerror = () => {
      setHighlightIdx(null);
      setTtsState("stopped");
    };
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
    setTtsState("playing");
  }

  function pauseResume() {
    if (!ttsSupported) return;
    if (ttsState === "playing") {
      window.speechSynthesis.pause();
      setTtsState("paused");
    } else if (ttsState === "paused") {
      window.speechSynthesis.resume();
      setTtsState("playing");
    }
  }

  function stopReading() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setHighlightIdx(null);
    setTtsState("stopped");
  }

  // Cleanup TTS on unmount
  useEffect(() => () => stopReading(), []);

  /* ── Export ── */
  async function copyOutput() {
    if (!output.trim()) {
      showBanner({ type: "warning", message: "Nothing to copy yet." });
      return;
    }
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      /* ignore */
    }
    setCopyLabel("✓ Copied!");
    setTimeout(() => setCopyLabel("⎘ Copy"), 2500);
  }

  function downloadBlob(content: string, mime: string, ext: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `LexiEase-converted-${todayStr()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTxt() {
    if (!output.trim()) {
      showBanner({ type: "warning", message: "Nothing to download yet." });
      return;
    }
    downloadBlob(output, "text/plain;charset=utf-8", "txt");
  }

  function downloadHtml() {
    if (!output.trim()) {
      showBanner({ type: "warning", message: "Nothing to download yet." });
      return;
    }
    const escaped = output
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>LexiEase Converted Text</title>
<style>
@font-face{font-family:'OpenDyslexic';src:url('https://cdn.jsdelivr.net/npm/open-dyslexic@1.0.3/woff/OpenDyslexic-Regular.woff') format('woff');}
body{background:${prefs.overlay};color:#1A1A1A;padding:40px;max-width:760px;margin:0 auto;
 font-family:${prefs.font};font-size:${prefs.fontSize}px;letter-spacing:${prefs.letterSpacing}em;
 word-spacing:${prefs.wordSpacing}em;line-height:${prefs.lineHeight};text-align:left;font-style:normal;white-space:pre-wrap;}
</style></head><body>${escaped}</body></html>`;
    downloadBlob(html, "text/html;charset=utf-8", "html");
  }

  /* ── File upload ── */
  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      showBanner({
        type: "warning",
        message: `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`,
      });
      return;
    }
    const name = file.name.toLowerCase();
    try {
      let text = "";
      if (name.endsWith(".txt")) {
        text = await file.text();
      } else if (name.endsWith(".pdf")) {
        const pdfjs = await loadPdfJs();
        const buf = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text +=
            content.items.map((it: { str: string }) => it.str).join(" ") + "\n";
        }
      } else if (name.endsWith(".docx")) {
        const mammoth = await loadMammoth();
        const buf = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        text = result.value;
      } else {
        showBanner({
          type: "warning",
          message: "Unsupported file type. Please upload a .txt, .pdf, or .docx file.",
        });
        return;
      }
      setInput(text.trim());
      const wc = analyzeText(text).wordCount;
      showBanner({
        type: "success",
        message: `Loaded ${file.name} (${wc.toLocaleString()} words).`,
      });
    } catch (e) {
      console.error(e);
      showBanner({ type: "error", message: "Could not read that file." });
    }
  }

  /* ── Stats ── */
  const stats = useMemo(() => {
    if (!output || !originalText) return null;
    const before = analyzeText(originalText);
    const after = analyzeText(output);
    const pct = before.wordCount
      ? Math.round((1 - after.wordCount / before.wordCount) * 100)
      : 0;
    const sentPct = before.avg
      ? Math.round((1 - after.avg / before.avg) * 100)
      : 0;
    return { before, after, pct, sentPct };
  }, [output, originalText]);

  const charCount = input.length;
  const charOver = charCount > 9000;

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        handleConvert();
      } else if (k === "r") {
        e.preventDefault();
        readAloud();
      } else if (k === "p") {
        e.preventDefault();
        pauseResume();
      } else if (k === "x") {
        e.preventDefault();
        stopReading();
      } else if (k === "d") {
        e.preventDefault();
        downloadTxt();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, output, prefs.readingLevel, prefs.speechRate]);

  const lhWarning = prefs.lineHeight < 1.5;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header
        className="px-6 py-4"
        style={{ background: "var(--header)", color: "var(--header-foreground)" }}
      >
        <div className="max-w-[1280px] mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold m-0">LexiEase</h1>
            <p className="text-[13px] opacity-85 m-0">
              Making any text easier to read — for everyone.
            </p>
          </div>
          <span
            className="text-xs font-medium px-3 py-1 rounded-full"
            style={{ background: "rgba(255,255,255,0.2)" }}
            title="Built following British Dyslexia Association Style Guide 2023"
          >
            BDA Guidelines 2023 ✓
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-6 py-5">
        {/* Two columns */}
        <div className="grid gap-5 grid-cols-1 lg:grid-cols-2">
          {/* INPUT */}
          <section className="bg-card border border-border rounded-[10px] p-5">
            <label htmlFor="input-text" className="block text-sm font-semibold mb-2">
              Paste your text here
            </label>
            <textarea
              id="input-text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste any article, email, letter, or document here..."
              className="w-full min-h-[260px] p-3 text-[15px] rounded-md border border-border bg-[var(--panel-soft)] text-foreground leading-[1.6] resize-y focus:outline-none focus:ring-2 focus:ring-primary"
              aria-describedby="char-count"
            />

            <label
              htmlFor="file-input"
              className="mt-3 block text-center text-[13px] cursor-pointer rounded-lg p-4 border-2 border-dashed border-border bg-[var(--panel-soft)] hover:border-primary hover:bg-accent transition"
            >
              <input
                ref={fileInputRef}
                id="file-input"
                type="file"
                accept=".txt,.pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <strong>Click to upload</strong> or drop a .txt / .pdf / .docx
              <div className="text-xs opacity-70 mt-1">Maximum 5 MB</div>
            </label>

            <div
              id="char-count"
              aria-live="polite"
              className={`mt-2 text-xs text-right ${charOver ? "text-destructive font-semibold" : "text-muted-foreground"}`}
            >
              {charCount.toLocaleString()} / 10,000 characters
            </div>

            {/* Level radios */}
            <fieldset className="mt-4 border-0 p-0">
              <legend className="text-sm font-semibold mb-2">Reading level</legend>
              <div className="grid gap-2">
                {LEVELS.map((lvl) => {
                  const active = prefs.readingLevel === lvl.value;
                  return (
                    <label
                      key={lvl.value}
                      className={`flex items-start gap-2.5 p-3 rounded-md border cursor-pointer transition ${
                        active
                          ? "border-primary bg-accent"
                          : "border-border bg-[var(--panel-soft)] hover:border-primary"
                      }`}
                    >
                      <input
                        type="radio"
                        name="level"
                        value={lvl.value}
                        checked={active}
                        onChange={() => updatePref("readingLevel", lvl.value)}
                        className="mt-1 accent-[var(--primary)]"
                      />
                      <span>
                        <span className="block font-semibold text-sm">{lvl.name}</span>
                        <span className="block text-xs text-muted-foreground mt-0.5">
                          {lvl.desc}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <button
              onClick={handleConvert}
              disabled={loading}
              aria-busy={loading}
              accessKey="c"
              className="w-full mt-4 py-3.5 text-base font-semibold rounded-md text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
                  />
                  Converting...
                </span>
              ) : (
                "Convert Text →"
              )}
            </button>

            {banner && (
              <div
                role="alert"
                className="mt-3 px-4 py-2.5 rounded-md text-sm flex items-start justify-between gap-3 border-l-4"
                style={bannerStyle(banner.type)}
              >
                <span>{banner.message}</span>
                <button
                  onClick={() => setBanner(null)}
                  aria-label="Dismiss"
                  className="text-lg leading-none"
                >
                  ✕
                </button>
              </div>
            )}
          </section>

          {/* OUTPUT */}
          <section
            className="rounded-[10px] p-5 border border-border min-h-[360px] transition-colors"
            style={{ backgroundColor: prefs.overlay }}
            aria-labelledby="output-heading"
          >
            <h2 id="output-heading" className="sr-only">
              Converted text output
            </h2>

            <div
              role="toolbar"
              aria-label="Output actions"
              className="flex flex-wrap gap-1.5 pb-3 mb-3 border-b border-black/10"
            >
              <ActionBtn
                onClick={readAloud}
                disabled={!ttsSupported || !output.trim() || ttsState === "playing"}
                label="▶ Read Aloud"
                aria="Read aloud"
              />
              <ActionBtn
                onClick={pauseResume}
                disabled={!ttsSupported || ttsState === "stopped"}
                label={ttsState === "paused" ? "▶ Resume" : "⏸ Pause"}
                aria="Pause or resume"
              />
              <ActionBtn
                onClick={stopReading}
                disabled={!ttsSupported || ttsState === "stopped"}
                label="⏹ Stop"
                aria="Stop reading"
              />
              <ActionBtn onClick={copyOutput} label={copyLabel} aria="Copy" />
              <ActionBtn onClick={downloadTxt} label="↓ .txt" aria="Download as text" />
              <ActionBtn onClick={downloadHtml} label="↓ .html" aria="Download as HTML" />
              <ActionBtn
                onClick={() => window.print()}
                label="🖨 Print"
                aria="Print"
              />
            </div>

            {stats && (
              <div className="text-[13px] mb-3 px-3 py-2 rounded-md bg-white/60">
                <div>
                  <strong>Before:</strong> {stats.before.wordCount} words ·{" "}
                  {stats.before.sentenceCount} sentences · {stats.before.avg} words/sentence
                </div>
                <div>
                  <strong>After:</strong> {stats.after.wordCount} words ·{" "}
                  {stats.after.sentenceCount} sentences · {stats.after.avg} words/sentence
                </div>
                <div
                  className="font-semibold mt-1"
                  style={{
                    color:
                      stats.pct > 30
                        ? "#1a7a4a"
                        : stats.pct >= 10
                          ? "#7a5a1a"
                          : "#666",
                  }}
                >
                  Result: {stats.pct}% shorter · sentences{" "}
                  {Math.max(0, stats.sentPct)}% simpler
                </div>
              </div>
            )}

            <div
              id="output-text"
              role="status"
              aria-live="polite"
              aria-label="Converted text"
              style={{
                fontFamily: prefs.font,
                fontSize: prefs.fontSize + "px",
                letterSpacing: prefs.letterSpacing + "em",
                wordSpacing: prefs.wordSpacing + "em",
                lineHeight: prefs.lineHeight,
                fontStyle: "normal",
                textAlign: "left",
                whiteSpace: "pre-wrap",
                color: "#1A1A1A",
                minHeight: 200,
              }}
            >
              {!output ? (
                <div
                  className="text-center py-16 text-muted-foreground"
                  style={{ fontFamily: "inherit" }}
                >
                  <div className="text-5xl mb-3" aria-hidden>
                    📖
                  </div>
                  <div
                    style={{
                      fontFamily: "system-ui, sans-serif",
                      fontSize: 16,
                      letterSpacing: "normal",
                      lineHeight: 1.5,
                    }}
                  >
                    Your converted text will appear here.
                  </div>
                </div>
              ) : (
                renderWithHighlight(output, wordSpans, highlightIdx)
              )}
            </div>
          </section>
        </div>

        {/* SETTINGS */}
        <section
          className="mt-5 rounded-[10px] p-5 border border-border"
          style={{ background: "var(--panel-soft)" }}
          aria-labelledby="settings-heading"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 id="settings-heading" className="text-sm font-semibold m-0">
              Display settings
            </h2>
            <button
              onClick={() => {
                setPrefs({ ...DEFAULTS, lastConverted: prefs.lastConverted });
                showBanner({ type: "success", message: "Display settings reset." });
              }}
              className="text-xs px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted transition"
            >
              ↺ Reset to Defaults
            </button>
          </div>

          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
            <Setting label="Font family">
              <select
                value={prefs.font}
                onChange={(e) => updatePref("font", e.target.value)}
                className="w-full p-1.5 rounded border border-border bg-card text-sm"
              >
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Setting>

            <SliderSetting
              label="Font size"
              value={prefs.fontSize}
              min={16}
              max={28}
              step={1}
              suffix="px"
              onChange={(v) => updatePref("fontSize", v)}
            />
            <SliderSetting
              label="Letter spacing"
              value={prefs.letterSpacing}
              min={0.035}
              max={0.15}
              step={0.005}
              suffix="em"
              decimals={3}
              onChange={(v) => updatePref("letterSpacing", v)}
            />
            <SliderSetting
              label="Word spacing"
              value={prefs.wordSpacing}
              min={0}
              max={0.25}
              step={0.01}
              suffix="em"
              decimals={2}
              onChange={(v) => updatePref("wordSpacing", v)}
            />
            <div>
              <SliderSetting
                label="Line height"
                value={prefs.lineHeight}
                min={1.4}
                max={2.5}
                step={0.1}
                suffix=""
                decimals={2}
                onChange={(v) => updatePref("lineHeight", v)}
              />
              {lhWarning && (
                <div className="text-[11px] mt-1" style={{ color: "var(--warning-border)" }}>
                  ⚠ BDA recommends ≥ 1.5
                </div>
              )}
            </div>
            <SliderSetting
              label="Reading speed"
              value={prefs.speechRate}
              min={0.6}
              max={1.4}
              step={0.1}
              suffix="×"
              decimals={1}
              onChange={(v) => updatePref("speechRate", v)}
            />

            <div className="col-span-full">
              <div className="text-[13px] font-medium mb-2">Color overlay</div>
              <div role="radiogroup" aria-label="Background color overlay" className="flex flex-wrap gap-2">
                {OVERLAYS.map((o) => {
                  const active = prefs.overlay === o.bg;
                  return (
                    <button
                      key={o.name}
                      role="radio"
                      aria-checked={active}
                      aria-label={`${o.name} overlay — ${o.label}`}
                      title={`${o.name} · ${o.label}`}
                      onClick={() => updatePref("overlay", o.bg)}
                      className="w-9 h-9 rounded-full border border-black/15 hover:scale-110 transition focus:outline-none"
                      style={{
                        backgroundColor: o.bg,
                        outline: active ? "3px solid var(--primary)" : undefined,
                        outlineOffset: active ? "2px" : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {!ttsSupported && (
          <div
            role="status"
            className="mt-4 px-4 py-2.5 rounded-md text-sm border-l-4"
            style={bannerStyle("info")}
          >
            Text-to-speech is not available in this browser. Try Chrome or Microsoft Edge.
          </div>
        )}

        <div className="mt-4 text-xs text-muted-foreground">
          <strong>Keyboard shortcuts:</strong> Alt+C convert · Alt+R read · Alt+P pause/resume ·
          Alt+X stop · Alt+D download
        </div>
      </main>

      <footer className="text-center py-5 text-xs text-muted-foreground border-t border-border">
        Based on British Dyslexia Association guidelines · Powered by Lovable AI · WCAG 2.2 AA
        compliant
      </footer>
    </div>
  );
}

/* ───────── Subcomponents ───────── */

function ActionBtn({
  onClick,
  disabled,
  label,
  aria,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  aria: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="px-2.5 py-1.5 text-[13px] font-semibold rounded-md bg-card text-foreground border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 transition"
    >
      {label}
    </button>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[13px] font-medium mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function SliderSetting({
  label,
  value,
  min,
  max,
  step,
  suffix,
  decimals,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  const display = decimals != null ? value.toFixed(decimals) : String(value);
  return (
    <div>
      <div className="text-[13px] font-medium mb-1.5 flex justify-between">
        <span>{label}</span>
        <span className="text-primary font-semibold">
          {display}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--primary)]"
      />
    </div>
  );
}

function renderWithHighlight(
  text: string,
  wordSpans: { text: string; start: number }[],
  highlightIdx: number | null,
) {
  if (highlightIdx == null) return text;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  wordSpans.forEach((w, i) => {
    if (w.start > cursor) out.push(text.slice(cursor, w.start));
    if (i === highlightIdx) {
      out.push(
        <mark
          key={i}
          style={{
            backgroundColor: "oklch(0.88 0.18 95)",
            color: "inherit",
            padding: "0 2px",
            borderRadius: 3,
          }}
        >
          {w.text}
        </mark>,
      );
    } else {
      out.push(<span key={i}>{w.text}</span>);
    }
    cursor = w.start + w.text.length;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function bannerStyle(type: BannerType): React.CSSProperties {
  const map: Record<BannerType, { bg: string; border: string; fg: string }> = {
    error: {
      bg: "var(--error-bg)",
      border: "var(--error-border)",
      fg: "var(--error-fg)",
    },
    warning: {
      bg: "var(--warning-bg)",
      border: "var(--warning-border)",
      fg: "var(--warning-fg)",
    },
    info: {
      bg: "var(--info-bg)",
      border: "var(--info-border)",
      fg: "var(--info-fg)",
    },
    success: {
      bg: "var(--success-bg)",
      border: "var(--success-border)",
      fg: "var(--success-fg)",
    },
  };
  const c = map[type];
  return {
    backgroundColor: c.bg,
    borderLeftColor: c.border,
    color: c.fg,
  };
}

/* ───────── Lazy CDN loaders ───────── */

declare global {
  interface Window {
    pdfjsLib?: any;
    mammoth?: any;
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}

async function loadMammoth() {
  if (window.mammoth) return window.mammoth;
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
  );
  return window.mammoth;
}
