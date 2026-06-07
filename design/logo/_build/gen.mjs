import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const svgDir = join(__dir, "..", "svg");
const outDir = __dir;
mkdirSync(outDir, { recursive: true });

const read = (f) => readFileSync(join(svgDir, f), "utf8")
  .replace(/<\?xml[^>]*\?>/g, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .trim();

const concepts = [
  {
    id: "01", name: "Dateline Wordmark",
    rationale: "Type-first masthead. Says Scout is a publication, not an app — editorial, calm, confident. The red full-stop is the signal.",
    header: read("01-dateline-wordmark.svg"),
    large: read("01-dateline-wordmark.svg"),
    mono: read("01-dateline-wordmark-mono.svg"),
  },
  {
    id: "02", name: "Trail Monogram",
    rationale: "An 'S' drawn as a scouting trail that ends in a signal-red node — the scout's route to the one thing that matters. Strong app-icon.",
    header: read("02-trail-monogram-mark.svg"),
    large: read("02-trail-monogram-lockup.svg"),
    mono: read("02-trail-monogram-mono.svg"),
  },
  {
    id: "03", name: "Compass Star",
    rationale: "A four-point navigation star, north in signal-red. The scout knows which way to look — orientation and editorial polish in one mark.",
    header: read("03-compass-star-lockup.svg"),
    large: read("03-compass-star-lockup.svg"),
    mono: read("03-compass-star-mono.svg"),
  },
  {
    id: "04", name: "Signal Arcs",
    rationale: "A wire-service transmission radiating from a single source. Scout goes out and brings back just the signal — literal and ownable.",
    header: read("04-signal-arcs-lockup.svg"),
    large: read("04-signal-arcs-lockup.svg"),
    mono: read("04-signal-arcs-mono.svg"),
  },
  {
    id: "05", name: "Spyglass",
    rationale: "The scout spots distant news; the lens catches the signal (red). Warm, human, unmistakably about finding what's out there.",
    header: read("05-spyglass-lockup.svg"),
    large: read("05-spyglass-lockup.svg"),
    mono: read("05-spyglass-mono.svg"),
  },
];

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">`;

const baseCSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#e7e0d2;font-family:Inter,system-ui,sans-serif;color:#1c1a17;padding:40px}
.label{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6f685d}
/* header-scale simulation */
.header-sim{display:flex;align-items:center;gap:18px;height:60px;padding:0 22px;background:#f6f2ea;border:1px solid #d8d0c1;border-radius:10px}
.header-sim svg{height:28px;width:auto;display:block}
.header-sim .nav{margin-left:auto;display:flex;gap:20px}
.header-sim .nav span{font-size:13px;color:#6f685d}
.paper{background:#f6f2ea;border:1px solid #d8d0c1;border-radius:10px;display:flex;align-items:center;justify-content:center}
.paper svg{height:64px;width:auto;display:block}
.paper.sm svg{height:28px}
`;

function headerSim(svg) {
  return `<div class="header-sim">${svg}<div class="nav"><span>Brief</span><span>Topics</span><span>Settings</span></div></div>`;
}

// ---- per-concept preview pages ----
for (const c of concepts) {
  const html = `<!doctype html><html><head><meta charset="utf8">${FONTS}<style>${baseCSS}
  .wrap{width:900px}
  .card{background:#fffdf8;border:1px solid #d8d0c1;border-radius:16px;padding:32px;margin-top:14px}
  h1{font-family:"Fraunces",serif;font-size:26px;font-weight:600}
  .ratio{color:#46413a;font-size:14px;line-height:1.5;max-width:640px;margin-top:6px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}
  .block .label{margin-bottom:8px}
  .tall{min-height:120px}
  </style></head><body><div class="wrap">
    <div class="label">Scout logo — concept ${c.id}</div>
    <div class="card">
      <h1>${c.name}</h1>
      <div class="ratio">${c.rationale}</div>
      <div class="block" style="margin-top:22px"><div class="label">In the app header (28px)</div>${headerSim(c.header)}</div>
      <div class="row">
        <div class="block"><div class="label">Signal-red on paper</div><div class="paper tall">${c.large}</div></div>
        <div class="block"><div class="label">Ink-only (mono degrade)</div><div class="paper tall">${c.mono}</div></div>
      </div>
    </div>
  </div></body></html>`;
  writeFileSync(join(outDir, `concept-${c.id}.html`), html);
}

// ---- contact sheet ----
const rows = concepts.map((c) => `
  <tr>
    <td class="cnum"><div class="label">${c.id}</div><div class="cname">${c.name}</div><div class="cr">${c.rationale}</div></td>
    <td><div class="paper sm">${c.header}</div></td>
    <td><div class="paper">${c.large}</div></td>
    <td><div class="paper">${c.mono}</div></td>
  </tr>`).join("");

const sheet = `<!doctype html><html><head><meta charset="utf8">${FONTS}<style>${baseCSS}
  .wrap{width:1180px;margin:0 auto}
  .title{font-family:"Fraunces",serif;font-size:34px;font-weight:600}
  .sub{color:#46413a;font-size:14px;margin-top:4px}
  table{width:100%;border-collapse:separate;border-spacing:0 14px;margin-top:18px}
  th{text-align:left;padding:0 8px}
  td{vertical-align:middle;padding:0 8px}
  .colhead{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6f685d;font-weight:500}
  .cnum{width:300px}
  .cname{font-family:"Fraunces",serif;font-size:20px;font-weight:600;margin-top:2px}
  .cr{color:#6f685d;font-size:12.5px;line-height:1.45;margin-top:6px}
  .paper{height:96px}
  .paper.sm{height:64px}
  .foot{margin-top:24px;color:#6f685d;font-size:12px;font-family:"JetBrains Mono",monospace}
</style></head><body><div class="wrap">
  <div class="title">Scout — logo concepts</div>
  <div class="sub">Five distinct directions on the warm-paper brand. Founder's pick drops into the PER-219 header slot.</div>
  <table>
    <tr><th></th><th class="colhead">Header (28px)</th><th class="colhead">Signal / paper</th><th class="colhead">Ink-only</th></tr>
    ${rows}
  </table>
  <div class="foot">Scout brand · paper #f6f2ea · signal-red #9a3b2e · ink #1c1a17 · Fraunces display</div>
</div></body></html>`;
writeFileSync(join(outDir, "contact-sheet.html"), sheet);

console.log("generated", concepts.length, "concept pages + contact sheet");
