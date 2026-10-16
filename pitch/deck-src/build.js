// ECHO pitch deck generator (pptxgenjs). Run: node build.js
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const path = require("path");
const { applyTheme } = require("/home/krutarth/.claude/skills/synced/4cd74d32-2970-4470-a8eb-25513c5c3232_013ee358-19b9-4f13-9aa5-f3a5983fd789/pptx/scripts/apply_theme.js");
const fa6 = require("react-icons/fa6");
const gi = require("react-icons/gi");
const tb = require("react-icons/tb");

const A = (f) => path.join(__dirname, "assets", f);
const OUT = path.join(__dirname, "ECHO_pitch.pptx");

// ---------- palette (hex, no #) ----------
const BG = "07070A";
const WHITE = "FFFFFF";
const YELLOW = "FFD23F";
const RED = "FF3B3B";
const MUTED = "C9C9D3";
const CARD = "15151B";
const LINE = "3A3A46";

const THEME = {
  name: "ECHO",
  headFontFace: "Creepster",
  bodyFontFace: "Sanchez",
  colors: {
    dk1: BG, lt1: WHITE, dk2: "15151B", lt2: MUTED,
    accent1: YELLOW, accent2: RED, accent3: "FFFFFF", accent4: "8A8A99",
    accent5: "FFB000", accent6: "5A5A66", hlink: YELLOW, folHlink: "FFB000",
  },
};
const HEAD = "Creepster";
const BODY = "Sanchez";

async function icon(Comp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: String(size) }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
  pres.title = "ECHO: hackathon pitch";
  pres.author = "Solo Levelling";
  pres.theme = { headFontFace: HEAD, bodyFontFace: BODY };

  // ---------- layouts ----------
  pres.defineSlideMaster({
    title: "ECHO_TITLE",
    background: { path: A("hero_bg.jpg") },
    objects: [],
  });
  pres.defineSlideMaster({
    title: "ECHO_CONTENT",
    background: { path: A("content_bg.jpg") },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.3, w: 9.5, h: 0.85, fontFace: HEAD, fontSize: 44, color: WHITE, align: "left", valign: "middle", margin: 0 }, text: "" } },
      { text: { text: "ECHO", options: { x: 11.2, y: 0.42, w: 1.55, h: 0.5, fontFace: HEAD, fontSize: 22, color: YELLOW, align: "right", margin: 0 } } },
    ],
    slideNumber: { x: 12.3, y: 7.0, w: 0.45, h: 0.3, fontFace: BODY, fontSize: 10, color: "8A8A99", align: "right" },
  });

  // ---------- icons ----------
  const ic = {
    clap: await icon(fa6.FaHandsClapping, BG),
    hum: await icon(fa6.FaMusic, BG),
    head: await icon(tb.TbMoodLookLeft, BG),
    lean: await icon(fa6.FaPersonWalking, BG),
    access: await icon(fa6.FaUniversalAccess, BG),
    puzzle: await icon(fa6.FaPuzzlePiece, BG),
    steps: await icon(gi.GiFootsteps, BG),
    laptop: await icon(fa6.FaLaptop, BG),
    flask: await icon(fa6.FaFlask, BG),
    eye: await icon(fa6.FaEye, BG),
    ghost: await icon(fa6.FaGhost, BG),
  };

  // helpers ---------------------------------------------------------------
  const kicker = (s, text) =>
    s.addText(text, { x: 0.6, y: 1.12, w: 11.5, h: 0.4, fontFace: BODY, fontSize: 16, color: YELLOW, italic: true, margin: 0, isTextBox: true });
  const card = (s, x, y, w, h, opts = {}) =>
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w, h, rectRadius: 0.08,
      fill: { color: opts.fill || CARD, transparency: opts.transparency ?? 8 },
      line: { color: opts.line || LINE, width: opts.lineW || 1 },
    });
  const iconDot = (s, data, x, y, d = 0.62, fill = YELLOW) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill } });
    const p = d * 0.22;
    s.addImage({ data, x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p });
  };
  const arrow = (s, x1, y1, x2, y2, color = YELLOW, w = 2) => {
    const o = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001), line: { color, width: w, endArrowType: "triangle" } };
    if (y2 < y1) o.flipV = true;
    if (x2 < x1) o.flipH = true;
    s.addShape(pres.shapes.LINE, o);
  };
  const seg = (s, x1, y1, x2, y2, color = YELLOW, w = 2) => {
    s.addShape(pres.shapes.LINE, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001), line: { color, width: w } });
  };
  const box = (s, x, y, w, h, runs, opts = {}) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x, y, w, h, rectRadius: 0.06,
      fill: { color: opts.fill || CARD }, line: { color: opts.line || YELLOW, width: opts.lineW ?? 1.25 },
    });
    s.addText(runs, { x: x + 0.06, y, w: w - 0.12, h, fontFace: BODY, fontSize: opts.size || 12, color: opts.color || WHITE, align: "center", valign: "middle", margin: 0, isTextBox: true });
  };

  // ======================================================================
  // 1. TITLE
  // ======================================================================
  {
    const s = pres.addSlide({ masterName: "ECHO_TITLE" });
    s.addImage({ path: A("pose1.png"), x: 8.95, y: 1.15, w: 3.6, h: 3.6 * 614 / 601 });
    s.addText("NO KEYBOARD  ·  NO MOUSE  ·  NO CONTROLLER", { x: 0.7, y: 0.6, w: 7, h: 0.35, fontFace: BODY, fontSize: 14, color: YELLOW, charSpacing: 3, margin: 0, isTextBox: true });
    s.addText("ECHO", { x: 0.6, y: 1.0, w: 7.5, h: 2.0, fontFace: HEAD, fontSize: 150, color: WHITE, margin: 0, isTextBox: true });
    s.addText([
      { text: "You are blind in a cave.", options: { breakLine: true } },
      { text: "Your voice is your only light.", options: { color: YELLOW } },
    ], { x: 0.7, y: 3.15, w: 7.5, h: 1.05, fontFace: BODY, fontSize: 28, color: WHITE, margin: 0, isTextBox: true });
    s.addText("A horror escape game played in total darkness, controlled only by your voice and your head. A webcam and a microphone are the whole controller.", {
      x: 0.7, y: 4.35, w: 6.6, h: 0.95, fontFace: BODY, fontSize: 16, color: MUTED, margin: 0, isTextBox: true,
    });
    const chips = [["TEAM", "Solo Levelling"], ["TRACK", "Track 2: PlayLab"], ["HACKATHON", "MGM2026"]];
    chips.forEach(([k, v], i) => {
      const x = 0.7 + i * 2.55;
      card(s, x, 5.75, 2.35, 0.95, { fill: "000000", transparency: 30, line: YELLOW });
      s.addText(k, { x: x + 0.2, y: 5.85, w: 2.0, h: 0.3, fontFace: BODY, fontSize: 11, color: YELLOW, charSpacing: 2, margin: 0, isTextBox: true });
      s.addText(v, { x: x + 0.2, y: 6.15, w: 2.1, h: 0.42, fontFace: BODY, fontSize: 17, color: WHITE, bold: true, margin: 0, isTextBox: true });
    });
    s.addText("In-game artwork: a Hollow. Blind. It hunts by sound.", { x: 8.7, y: 6.35, w: 4.1, h: 0.3, fontFace: BODY, fontSize: 11, color: MUTED, italic: true, align: "right", margin: 0, isTextBox: true });
    s.addNotes("ECHO is a horror escape game you play in the dark with only your voice and your head. Webcam and mic are the whole controller. Team Solo Levelling, Track 2 PlayLab.");
  }

  // ======================================================================
  // 2. PROPOSED SOLUTION
  // ======================================================================
  {
    const s = pres.addSlide({ masterName: "ECHO_CONTENT" });
    s.addText("Proposed Solution", { placeholder: "title" });
    kicker(s, "Sound is sight. The input is not a button in disguise: it IS the core mechanic.");

    card(s, 0.6, 1.7, 6.1, 0.95, { line: RED });
    s.addText([
      { text: "THE CHALLENGE  ", options: { color: RED, bold: true } },
      { text: "Play without keyboard, mouse, touch or controller, where the input is meaningfully tied to gameplay." },
    ], { x: 0.8, y: 1.7, w: 5.75, h: 0.95, fontFace: BODY, fontSize: 14, color: WHITE, valign: "middle", margin: 0, isTextBox: true });

    const rows = [
      [ic.clap, "CLAP · CLICK · KNOCK", "A sonar pulse reveals the cave. Louder = see further, and be heard further."],
      [ic.hum, "HUM", "A quiet beam where you look. Pitch sets width, loudness sets range. Heard only within ~5 m."],
      [ic.head, "TURN YOUR HEAD", "Look left and right. MediaPipe tracks head yaw."],
      [ic.lean, "LEAN IN · LEAN BACK", "Walk. A gentle lean is silent; a full lean makes footsteps they can hear."],
    ];
    rows.forEach(([data, h, d], i) => {
      const y = 2.95 + i * 0.95;
      iconDot(s, data, 0.6, y + 0.04, 0.66);
      s.addText(h, { x: 1.45, y, w: 5.2, h: 0.32, fontFace: BODY, fontSize: 16, bold: true, color: YELLOW, margin: 0, isTextBox: true });
      s.addText(d, { x: 1.45, y: y + 0.32, w: 5.25, h: 0.55, fontFace: BODY, fontSize: 14, color: WHITE, margin: 0, valign: "top", isTextBox: true });
    });

    // chart: one clap, two radii (CONFIG: PULSE 5..24 m, HEAR 4..34 m, loudness 0..1.5)
    card(s, 7.05, 1.7, 5.7, 4.05);
    const L = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5];
    const labels = ["soft click", "", "", "normal clap", "", "loud clap"];
    const see = L.map((l) => +(5 + 19 * (l / 1.5)).toFixed(1));
    const hear = L.map((l) => +(4 + 30 * (l / 1.5)).toFixed(1));
    s.addText("ONE CLAP, TWO RADII", { x: 7.3, y: 1.82, w: 5.2, h: 0.32, fontFace: BODY, fontSize: 15, bold: true, color: WHITE, margin: 0, isTextBox: true });
    s.addChart(pres.charts.LINE, [
      { name: "How far you SEE (m)", labels, values: see },
      { name: "How far Hollows HEAR (m)", labels, values: hear },
    ], {
      x: 7.2, y: 2.15, w: 5.4, h: 3.5,
      chartColors: [YELLOW, RED], lineSize: 4, lineDataSymbol: "circle", lineDataSymbolSize: 8,
      showLegend: true, legendPos: "b", legendColor: WHITE, legendFontFace: "+mn-lt", legendFontSize: 12,
      catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 11,
      valAxisMinVal: 0, valAxisMaxVal: 35, valAxisMajorUnit: 10,
      valGridLine: { color: "2A2A33", size: 0.75 }, catGridLine: { style: "none" },
      catAxisLineColor: LINE, valAxisLineShow: false,
      showValue: false,
    });
    card(s, 7.05, 5.95, 5.7, 0.95, { fill: YELLOW, transparency: 0, line: YELLOW });
    s.addText([
      { text: "USP: every input is a bet. ", options: { bold: true } },
      { text: "Sound always carries further than it reveals, so seeing the cave tells the Hollows where you are." },
    ], { x: 7.25, y: 5.95, w: 5.35, h: 0.95, fontFace: BODY, fontSize: 14, color: BG, valign: "middle", margin: 0, isTextBox: true });
    s.addNotes("Every input is analog and physical. The chart is straight from the game's config: a clap reveals 5 to 24 m but is heard 4 to 34 m away, so every clap is a trade-off. No buttons in disguise.");
  }

  // ======================================================================
  // 3. TECHNICAL APPROACH
  // ======================================================================
  {
    const s = pres.addSlide({ masterName: "ECHO_CONTENT" });
    s.addText("Technical Approach", { placeholder: "title" });
    kicker(s, "Sensor → signal processing → intent → pure game logic → real-time feedback, all in the browser.");

    const sub = (t) => ({ text: t, options: { fontSize: 10.5, color: MUTED, breakLine: false } });
    const hd = (t) => ({ text: t, options: { bold: true, breakLine: true } });
    // row A (camera) and row B (mic)
    const yA = 1.75, yB = 2.85, h = 0.85;
    box(s, 0.6, yA, 1.55, h, [hd("WEBCAM"), sub("640×480 · 30 fps")]);
    box(s, 0.6, yB, 1.55, h, [hd("MICROPHONE"), sub("raw, no AGC")]);
    arrow(s, 2.15, yA + h / 2, 2.4, yA + h / 2);
    arrow(s, 2.15, yB + h / 2, 2.4, yB + h / 2);
    box(s, 2.4, yA, 2.1, h, [hd("MediaPipe Face"), hd("Landmarker"), sub("GPU delegate")]);
    box(s, 2.4, yB, 2.1, h, [hd("MicAnalyzer"), sub("128-sample hops (2.7 ms)")]);
    arrow(s, 4.5, yA + h / 2, 4.75, yA + h / 2);
    arrow(s, 4.5, yB + h / 2, 4.75, yB + h / 2);
    box(s, 4.75, yA, 2.25, h, [hd("Head yaw · lean · presence"), sub("One-Euro smoothed")]);
    box(s, 4.75, yB, 2.25, h, [hd("Clap onsets · YIN pitch"), sub("noise floor · hum detector")]);
    arrow(s, 7.0, yA + h / 2, 7.3, yA + h / 2);
    arrow(s, 7.0, yB + h / 2, 7.3, yB + h / 2);
    box(s, 7.3, yA, 1.8, yB + h - yA, [
      { text: "IntentBuilder", options: { bold: true, fontSize: 14, breakLine: true } },
      { text: "+ calibration", options: { breakLine: true } },
      { text: " ", options: { fontSize: 6, breakLine: true } },
      { text: "PlayerIntent", options: { bold: true, breakLine: true } },
      { text: "turn · speed · pulses · beam", options: { fontSize: 10.5 } },
    ], { fill: YELLOW, color: BG, line: YELLOW });
    const mid = (yA + yB + h) / 2;
    arrow(s, 9.1, mid, 9.4, mid);
    box(s, 9.4, yA, 1.6, yB + h - yA, [
      { text: "World.update()", options: { bold: true, breakLine: true } },
      { text: "pure TypeScript", options: { fontSize: 10.5, color: MUTED, breakLine: true } },
      { text: " ", options: { fontSize: 6, breakLine: true } },
      { text: "hearing · Hollows · the Hush · levels", options: { fontSize: 10.5 } },
    ]);
    const outs = ["three.js reveal shader", "Web Audio HRTF 3D", "HUD + debug panel"];
    outs.forEach((t, i) => {
      const y = yA + i * 0.68;
      arrow(s, 11.0, mid, 11.25, y + 0.27, YELLOW, 1.5);
      box(s, 11.25, y, 1.5, 0.55, [{ text: t, options: { fontSize: 10.5, bold: true } }]);
    });
    s.addText("The game logic never touches a sensor. A dev-only keyboard sim feeds the same PlayerIntent, which is how 141 unit tests drive the game.", {
      x: 0.6, y: 3.82, w: 12.15, h: 0.35, fontFace: BODY, fontSize: 12, italic: true, color: MUTED, margin: 0, isTextBox: true,
    });

    // --- Hollow state machine (left bottom) ---
    s.addText("THE HOLLOW'S BRAIN", { x: 0.6, y: 4.25, w: 5.8, h: 0.32, fontFace: BODY, fontSize: 15, bold: true, color: YELLOW, margin: 0, isTextBox: true });
    const ny = 5.15, nh = 0.62;
    box(s, 0.6, ny, 1.35, nh, [hd("IDLE"), sub("wanders")]);
    box(s, 2.55, ny, 1.9, nh, [hd("HUNT"), sub("runs to the sound")], { line: RED });
    box(s, 5.05, ny, 1.35, nh, [hd("SEARCH"), sub("6 s")]);
    arrow(s, 1.95, ny + nh / 2, 2.55, ny + nh / 2);
    arrow(s, 4.45, ny + nh / 2, 5.05, ny + nh / 2);
    s.addText("hears", { x: 1.95, y: ny + nh / 2 - 0.3, w: 0.6, h: 0.25, fontFace: BODY, fontSize: 10, color: MUTED, align: "center", margin: 0, isTextBox: true });
    s.addText("arrives", { x: 4.45, y: ny + nh / 2 - 0.3, w: 0.6, h: 0.25, fontFace: BODY, fontSize: 10, color: MUTED, align: "center", margin: 0, isTextBox: true });
    // return path above: SEARCH -> IDLE
    seg(s, 5.72, ny, 5.72, 4.9); seg(s, 5.72, 4.9, 1.28, 4.9); arrow(s, 1.28, 4.9, 1.28, ny);
    s.addText("nothing found: back to idle", { x: 2.2, y: 4.64, w: 2.6, h: 0.24, fontFace: BODY, fontSize: 10, color: MUTED, align: "center", margin: 0, isTextBox: true });
    // catch
    arrow(s, 3.5, ny + nh, 3.5, 6.3, RED);
    box(s, 2.55, 6.3, 1.9, 0.55, [{ text: "CATCH", options: { bold: true } }], { fill: RED, line: RED, color: WHITE });
    s.addText("within 1.1 m", { x: 3.58, y: ny + nh + 0.05, w: 1.3, h: 0.25, fontFace: BODY, fontSize: 10, color: RED, margin: 0, isTextBox: true });
    s.addText("Runs 3.6 m/s from afar, slows to 1.9 m/s up close: faster than you walk, slower when near, so a quiet escape works.", {
      x: 4.6, y: 5.95, w: 2.05, h: 1.0, fontFace: BODY, fontSize: 10.5, color: WHITE, margin: 0, valign: "top", isTextBox: true,
    });

    // --- calibration timeline (right bottom) ---
    s.addText("HANDS-FREE CALIBRATION · ~45 s", { x: 7.1, y: 4.35, w: 5.6, h: 0.32, fontFace: BODY, fontSize: 15, bold: true, color: YELLOW, margin: 0, isTextBox: true });
    const steps = ["Face", "Quiet room", "Neutral pose", "Look left", "Clap", "Hum", "Speaker leak"];
    const x0 = 7.35, x1 = 12.45, dx = (x1 - x0) / (steps.length - 1), cy = 5.15;
    seg(s, x0, cy, x1, cy, LINE, 3);
    steps.forEach((t, i) => {
      const x = x0 + i * dx;
      s.addShape(pres.shapes.OVAL, { x: x - 0.22, y: cy - 0.22, w: 0.44, h: 0.44, fill: { color: YELLOW }, line: { color: YELLOW } });
      s.addText(String(i + 1), { x: x - 0.22, y: cy - 0.22, w: 0.44, h: 0.44, fontFace: BODY, fontSize: 13, bold: true, color: BG, align: "center", valign: "middle", margin: 0, isTextBox: true });
      s.addText(t, { x: x - 0.43, y: cy + 0.3, w: 0.86, h: 0.45, fontFace: BODY, fontSize: 10, color: WHITE, align: "center", valign: "top", margin: 0, isTextBox: true });
    });
    s.addText("Every step: says what and why → countdown → live reading → result.", { x: 7.1, y: 5.95, w: 5.65, h: 0.3, fontFace: BODY, fontSize: 11, italic: true, color: MUTED, margin: 0, isTextBox: true });
    const stack = ["TypeScript", "Vite", "three.js", "MediaPipe", "Web Audio", "Vitest"];
    let sx = 7.1;
    stack.forEach((t) => {
      const w = 0.25 + t.length * 0.085;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: sx, y: 6.4, w, h: 0.36, rectRadius: 0.18, fill: { color: CARD }, line: { color: YELLOW, width: 1 } });
      s.addText(t, { x: sx, y: 6.4, w, h: 0.36, fontFace: BODY, fontSize: 10.5, color: YELLOW, align: "center", valign: "middle", margin: 0, isTextBox: true });
      sx += w + 0.1;
    });
    s.addNotes("One frame: webcam to MediaPipe for head yaw and lean, mic to our own DSP for clap onsets and YIN pitch. IntentBuilder turns signals into a PlayerIntent; the game logic is pure TypeScript and never sees a sensor. Hollows are blind state machines driven only by what they hear.");
  }

  // ======================================================================
  // 4. FEASIBILITY & VIABILITY
  // ======================================================================
  {
    const s = pres.addSlide({ masterName: "ECHO_CONTENT" });
    s.addText("Feasibility & Viability", { placeholder: "title" });
    kicker(s, "It already works: a playable 3-level prototype, measured on an ordinary laptop with integrated graphics.");
    const stats = [
      ["30 fps", "face tracking on an Intel integrated GPU"],
      ["6.5 ms", "to render the cave per frame, inside a 20 ms budget"],
      ["141", "unit tests, all passing"],
      ["0", "extra hardware: webcam + mic, runs offline in Chrome"],
    ];
    stats.forEach(([n, l], i) => {
      const x = 0.6 + i * 3.08;
      card(s, x, 1.75, 2.88, 1.6);
      s.addText(n, { x: x + 0.2, y: 1.85, w: 2.5, h: 0.8, fontFace: BODY, fontSize: 40, bold: true, color: YELLOW, margin: 0, isTextBox: true });
      s.addText(l, { x: x + 0.2, y: 2.62, w: 2.55, h: 0.65, fontFace: BODY, fontSize: 13, color: WHITE, margin: 0, valign: "top", isTextBox: true });
    });

    card(s, 0.6, 3.6, 4.6, 3.25);
    s.addText("141 TESTS BY LAYER", { x: 0.8, y: 3.7, w: 4.2, h: 0.32, fontFace: BODY, fontSize: 15, bold: true, color: WHITE, margin: 0, isTextBox: true });
    s.addChart(pres.charts.BAR, [{ name: "Tests", labels: ["Game logic", "Input & DSP", "Rendering"], values: [64, 54, 23] }], {
      x: 0.75, y: 4.05, w: 4.35, h: 2.7, barDir: "bar",
      chartColors: [YELLOW], showValue: true, dataLabelPosition: "outEnd", dataLabelColor: WHITE, dataLabelFontSize: 14, dataLabelFontFace: "+mn-lt", dataLabelFontBold: true,
      catAxisLabelColor: WHITE, catAxisLabelFontSize: 13, catAxisLabelFontFace: "+mn-lt", catAxisOrientation: "maxMin",
      valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" }, catAxisLineShow: false,
      valAxisMinVal: 0, valAxisMaxVal: 80, barGapWidthPct: 45, showLegend: false,
    });

    // risks table
    s.addText("RISKS WE DESIGNED FOR", { x: 5.55, y: 3.7, w: 7, h: 0.32, fontFace: BODY, fontSize: 15, bold: true, color: WHITE, margin: 0, isTextBox: true });
    const risks = [
      ["Noisy hackathon hall", "Calibrated noise floor; a clap must spike, then drop 8\u00A0dB within 75\u00A0ms"],
      ["The game hears itself", "Headphones + a speaker-leak test during calibration"],
      ["Face lost, bad light", "Auto-pause after 0.4 s without a face"],
      ["Weak laptop", "Adaptive render scale below 40 fps; all assets bundled offline"],
    ];
    risks.forEach(([r, m], i) => {
      const y = 4.12 + i * 0.6;
      card(s, 5.4, y, 7.35, 0.52, { transparency: 0 });
      s.addText(r, { x: 5.55, y, w: 2.25, h: 0.52, fontFace: BODY, fontSize: 13, bold: true, color: RED, valign: "middle", margin: 0, isTextBox: true });
      s.addText(m, { x: 7.85, y, w: 4.85, h: 0.52, fontFace: BODY, fontSize: 12, color: WHITE, valign: "middle", margin: 0, isTextBox: true });
    });
    s.addText([
      { text: "Viable: ", options: { bold: true, color: YELLOW } },
      { text: "browser distribution, zero install, zero hardware cost. Levels are ASCII maps, so new content is cheap." },
    ], { x: 5.4, y: 6.55, w: 7.35, h: 0.35, fontFace: BODY, fontSize: 13, color: WHITE, margin: 0, isTextBox: true });
    s.addNotes("Everything here is measured, not projected: 30 fps face tracking and 6.5 ms cave render on the laptop's integrated GPU, 141 passing unit tests. Each venue risk has a built-in mitigation.");
  }

  // ======================================================================
  // 5. IMPACT & BENEFITS
  // ======================================================================
  {
    const s = pres.addSlide({ masterName: "ECHO_CONTENT" });
    s.addText("Impact & Benefits", { placeholder: "title" });
    kicker(s, "Your body is the controller.");
    s.addImage({ path: A("red_glow.png"), x: 7.9, y: 1.2, w: 5.4, h: 5.4, transparency: 15 });
    s.addImage({ path: A("pose3.png"), x: 8.35, y: 1.45, w: 4.4, h: 4.4 * 627 / 612 });
    const cards = [
      [ic.access, "Accessibility", "Fully hands-free play for people who can't use a keyboard, mouse or controller."],
      [ic.puzzle, "Input becomes the game", "Alt-input as the fun, not a gimmick: your noise is both your light and your danger."],
      [ic.steps, "Real immersion", "You hold your breath, lean in slowly and hum quietly. The fear is physical."],
      [ic.laptop, "Reusable & low barrier", "A face + voice → intent pipeline any browser game can adopt. Any laptop, no install."],
    ];
    cards.forEach(([data, h, d], i) => {
      const x = 0.6 + (i % 2) * 3.65, y = 1.75 + Math.floor(i / 2) * 2.55;
      card(s, x, y, 3.45, 2.35);
      iconDot(s, data, x + 0.25, y + 0.25, 0.7);
      s.addText(h, { x: x + 0.25, y: y + 1.05, w: 3.0, h: 0.38, fontFace: BODY, fontSize: 17, bold: true, color: YELLOW, margin: 0, isTextBox: true });
      s.addText(d, { x: x + 0.25, y: y + 1.45, w: 3.0, h: 0.85, fontFace: BODY, fontSize: 13.5, color: WHITE, margin: 0, valign: "top", isTextBox: true });
    });
    s.addText("Seen only in the flash of your own clap.", { x: 8.0, y: 6.25, w: 4.75, h: 0.55, fontFace: BODY, fontSize: 13, italic: true, color: MUTED, align: "right", margin: 0, isTextBox: true });
    s.addNotes("Who it helps: players who can't use their hands; designers looking for alternative input that's actually fun; and anyone building browser games, because the face and voice pipeline is reusable.");
  }

  // ======================================================================
  // 6. RESEARCH & REFERENCES
  // ======================================================================
  {
    const s = pres.addSlide({ masterName: "ECHO_CONTENT" });
    s.addText("Research & References", { placeholder: "title" });
    kicker(s, "The techniques under the hood, plus related research and games.");
    const cols = [
      [ic.flask, "Signal processing", [
        "YIN pitch estimation: de Cheveigné & Kawahara, JASA 2002",
        "One Euro Filter: Casiez, Roussel & Vogel, CHI 2012",
        "Percussive onset detection with an adaptive noise floor",
      ]],
      [ic.eye, "Vision & rendering", [
        "MediaPipe Face Landmarker (Google)",
        "Surface Nets meshing of distance fields: Gibson, 1998",
        "three.js · Web Audio API (HRTF panning)",
      ]],
      [ic.ghost, "Related work", [
        "Human echolocation: Thaler, Arnott & Goodale, PLoS ONE 2011",
        "Sound-driven horror games: Dark Echo (2015), Perception (2017), Stifled (2017)",
      ]],
    ];
    cols.forEach(([data, h, items], i) => {
      const x = 0.6 + i * 4.1;
      card(s, x, 1.75, 3.9, 2.85);
      iconDot(s, data, x + 0.25, 1.95, 0.6);
      s.addText(h, { x: x + 1.0, y: 1.95, w: 2.8, h: 0.6, fontFace: BODY, fontSize: 17, bold: true, color: YELLOW, valign: "middle", margin: 0, isTextBox: true });
      s.addText(items.map((t, j) => ({ text: t, options: { bullet: { indent: 14 }, breakLine: j < items.length - 1 } })), {
        x: x + 0.25, y: 2.7, w: 3.5, h: 1.8, fontFace: BODY, fontSize: 13, color: WHITE, paraSpaceAfter: 6, valign: "top", margin: 0, isTextBox: true,
      });
    });
    const shots = [
      ["crop-hollow.jpg", "Clap: the pulse reveals a Hollow"],
      ["crop-hum.jpg", "Hum: a narrow, quiet beam"],
      ["crop-hero-eyes.jpg", "It heard you"],
      ["cave_user.jpg", "Awakening: gold arrows to the exit"],
    ];
    shots.forEach(([f, c], i) => {
      const x = 0.6 + i * 3.08;
      s.addImage({ path: A(f), x, y: 4.85, w: 2.9, h: 2.9 * 9 / 16, sizing: { type: "cover", w: 2.9, h: 2.9 * 9 / 16 } });
      s.addShape(pres.shapes.RECTANGLE, { x, y: 4.85, w: 2.9, h: 2.9 * 9 / 16, fill: { type: "none" }, line: { color: LINE, width: 1 } });
      s.addText(c, { x, y: 6.55, w: 2.9, h: 0.3, fontFace: BODY, fontSize: 11, color: MUTED, margin: 0, isTextBox: true });
    });
    s.addNotes("References for the DSP and vision building blocks, plus the inspirations. Bottom row: real in-game screenshots.");
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
