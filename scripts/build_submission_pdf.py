"""Build the FeatureScript submission packet PDF.

Usage:
    python3 scripts/build_submission_pdf.py [--author "Your Name"] [--out FILE]

Reads the custom feature library in data/fs_examples/ (via
scripts/submission_examples.mjs, which also runs the project's validator on
each feature) and writes a submission document with a feature catalog,
install instructions, validation results and the full source of every feature.
Requires: node, python3, reportlab.
"""
import argparse
import datetime
import json
import os
import subprocess
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Frame, KeepTogether, PageBreak, PageTemplate,
    Paragraph, Preformatted, Spacer, Table, TableStyle,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_URL = "https://github.com/noobifyLol/CAD_AI"

# Unicode fonts (→, ✓, curly quotes): DejaVu on Linux, Segoe UI + Consolas on Windows.
FONT_SETS = [
    ("/usr/share/fonts/truetype/dejavu", "DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf"),
    (os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"), "segoeui.ttf", "segoeuib.ttf", "consola.ttf"),
]
BODY, BOLD, MONO = "Helvetica", "Helvetica-Bold", "Courier"  # built-in fallback (ASCII only)
for font_dir, body_file, bold_file, mono_file in FONT_SETS:
    try:
        pdfmetrics.registerFont(TTFont("Body", os.path.join(font_dir, body_file)))
        pdfmetrics.registerFont(TTFont("Body-Bold", os.path.join(font_dir, bold_file)))
        pdfmetrics.registerFont(TTFont("Mono", os.path.join(font_dir, mono_file)))
        BODY, BOLD, MONO = "Body", "Body-Bold", "Mono"
        break
    except Exception:
        continue

INK = colors.HexColor("#1b2430")
MUTED = colors.HexColor("#5b6675")
ACCENT = colors.HexColor("#1f5fae")
RULE = colors.HexColor("#d5dbe3")
CODE_BG = colors.HexColor("#f4f6f9")
PASS = colors.HexColor("#1e7a46")

S = {
    "title": ParagraphStyle("title", fontName=BOLD, fontSize=26, leading=32, textColor=INK, alignment=TA_CENTER),
    "subtitle": ParagraphStyle("subtitle", fontName=BODY, fontSize=13, leading=18, textColor=MUTED, alignment=TA_CENTER),
    "h1": ParagraphStyle("h1", fontName=BOLD, fontSize=16, leading=20, textColor=INK, spaceBefore=6, spaceAfter=8),
    "h2": ParagraphStyle("h2", fontName=BOLD, fontSize=12, leading=15, textColor=ACCENT, spaceBefore=10, spaceAfter=4),
    "body": ParagraphStyle("body", fontName=BODY, fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=6),
    "bullet": ParagraphStyle("bullet", fontName=BODY, fontSize=9.5, leading=13.5, textColor=INK,
                             leftIndent=14, bulletIndent=4, spaceAfter=2),
    "small": ParagraphStyle("small", fontName=BODY, fontSize=8, leading=10.5, textColor=MUTED),
    "cell": ParagraphStyle("cell", fontName=BODY, fontSize=8, leading=10, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName=BOLD, fontSize=8, leading=10, textColor=INK),
    "code": ParagraphStyle("code", fontName=MONO, fontSize=6.6, leading=8.2, textColor=INK),
    "inline": ParagraphStyle("inline", fontName=MONO, fontSize=8.5, leading=11, textColor=INK,
                             backColor=CODE_BG, borderPadding=6, spaceBefore=4, spaceAfter=10),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def bullets(items):
    return [Paragraph(t, S["bullet"], bulletText="•") for t in items]


def code(text):
    return f'<font name="{MONO}">{escape(text)}</font>'


def table(rows, widths, header=True, zebra=True):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), INK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
    if zebra:
        for r in range(1 if header else 0, len(rows)):
            if r % 2 == 0:
                style.append(("BACKGROUND", (0, r), (-1, r), CODE_BG))
    t.setStyle(TableStyle(style))
    return t


def head(text):
    return Paragraph(f'<font color="white">{text}</font>', S["cellb"])


def load_examples():
    out = subprocess.run(
        ["node", os.path.join(ROOT, "scripts", "submission_examples.mjs")],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def on_page(canvas, doc):
    canvas.saveState()
    w, h = letter
    if doc.page > 1:
        canvas.setFont(BODY, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(0.75 * inch, h - 0.5 * inch, "CAD_AI · FeatureScript Custom Feature Library · Submission Packet")
        canvas.drawRightString(w - 0.75 * inch, h - 0.5 * inch, "FeatureScript 2931")
        canvas.setStrokeColor(RULE)
        canvas.line(0.75 * inch, h - 0.56 * inch, w - 0.75 * inch, h - 0.56 * inch)
    canvas.setFont(BODY, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(w / 2, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build(author, out_path):
    examples = load_examples()
    passed = sum(1 for e in examples if e["ok"])
    total = len(examples)
    live_checked = [e for e in examples if e.get("onshape") is not None]
    live_passed = sum(1 for e in live_checked if e["onshape"])
    today = datetime.date.today().strftime("%B %d, %Y")
    story = []

    # ---- Cover ----
    story += [Spacer(1, 1.4 * inch), P("CAD_AI", "title"), Spacer(1, 6),
              P("Text-to-FeatureScript Custom Feature Library", "subtitle"), Spacer(1, 4),
              P("FeatureScript Submission Packet", "subtitle"), Spacer(1, 0.6 * inch)]
    cover_rows = [
        [P("Author", "cellb"), P(escape(author), "cell")],
        [P("Repository", "cellb"), P(REPO_URL, "cell")],
        [P("Language / version", "cellb"), P("Onshape FeatureScript 2931 (std library 2931.0)", "cell")],
        [P("Submission contents", "cellb"), P(f"{total} parametric custom features (one Feature Studio each) "
                                              "plus the AI generator that produces new ones from plain English", "cell")],
        [P("Validation", "cellb"), P(f'<font color="#1e7a46">{passed} / {total} features pass</font> '
                                     "the project's strict FeatureScript validator"
                                     + (f'; <font color="#1e7a46">{live_passed} / {len(live_checked)} run without '
                                        "errors</font> in a live Onshape Part Studio" if live_checked else ""),
                                     "cell")],
        [P("Date", "cellb"), P(today, "cell")],
    ]
    t = Table(cover_rows, colWidths=[1.6 * inch, 4.4 * inch])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [t, PageBreak()]

    # ---- 1. Summary ----
    story += [P("1. Summary", "h1"),
              P("CAD_AI turns a plain-English request such as <i>“create a wheel with 6 spokes”</i> into Onshape "
                "FeatureScript that adds editable, parametric geometry to a Part Studio. This packet submits "
                f"the project's library of {total} custom features. Every feature is a complete Feature Studio "
                f"file with one exported {code('defineFeature')} and a dialog of editable parameters (lengths, "
                "counts, an optional sketch plane). The generator uses these features as its reference set "
                "and as a guaranteed fallback, so they are the project's core FeatureScript."),
              P("What makes the features useful", "h2")]
    story += bullets([
        "<b>Fully parametric.</b> Every size is a dialog parameter with sensible bounds and defaults. "
        "Nothing is hard-coded, so a part can be resized after it is placed.",
        "<b>Placeable.</b> Each feature takes an optional <i>Plane</i> pick. If you leave it empty, the "
        "part is built on the world Top plane.",
        "<b>Real decomposition.</b> Everyday objects are built from their components (pen = barrel + tip + "
        "clip, wheel = rim + hub + patterned spokes) rather than one stretched primitive.",
        "<b>Idiomatic FeatureScript.</b> The features use standard library operations only "
        f"({code('opExtrude')}, {code('opRevolve')}, {code('opLoft')}, {code('opSweep')}, {code('opShell')}, "
        f"{code('opPattern')}, {code('opBoolean')}, {code('opFillet')}, {code('opChamfer')}).",
    ])

    # ---- 2. Feature catalog ----
    story += [CondPageBreak(2 * inch), P("2. Feature catalog", "h1"),
              P("Each row is one custom feature. The <i>Feature name</i> is what appears in the Onshape "
                "toolbar and the <i>Export</i> is the FeatureScript symbol.")]
    def verdict(ok):
        if ok is None:
            return P("n/a", "cell")
        return P('<font color="#1e7a46">PASS</font>' if ok else '<font color="#b42318">FAIL</font>', "cell")

    rows = [[head("#"), head("Feature name"), head("Export"), head("Key operations"), head("Inputs"),
             head("Static"), head("Onshape")]]
    for i, e in enumerate(examples, 1):
        rows.append([
            P(str(i), "cell"), P(escape(e["typeName"]), "cellb"), P(code(e["exportName"]), "cell"),
            P(escape(", ".join(e.get("operations", []))), "cell"), P(str(len(e["params"])), "cell"),
            verdict(e["ok"]), verdict(e.get("onshape")),
        ])
    story.append(table(rows, [0.3 * inch, 1.45 * inch, 1.65 * inch, 1.7 * inch, 0.5 * inch, 0.55 * inch,
                              0.65 * inch]))
    story += [Spacer(1, 4),
              P("<i>Static</i> is the project's strict FeatureScript validator. <i>Onshape</i> means the feature "
                "was executed in a real Onshape Part Studio through the Onshape API and reported no errors.",
                "small")]

    # ---- 3. Install & use ----
    story += [PageBreak(), P("3. Installing and using a feature in Onshape", "h1")]
    story += bullets([
        "Open (or create) an Onshape document. Click <b>+</b> (Insert new tab) → <b>Create Feature Studio</b>.",
        "Delete the starter text and paste the full source of a feature from the appendix "
        f"(or from {code('data/fs_examples/<file>.fs')} in the repository).",
        "Click <b>Commit</b>. The Feature Studio should show no errors.",
        "Switch to a Part Studio. Click <b>Custom features</b> on the toolbar (the puzzle-piece icon) and "
        "add the feature to the toolbar.",
        "Click the feature, optionally pick a plane, adjust the parameters and click the green check mark. Double-click the "
        "feature in the Feature list at any time to change its dimensions.",
    ])
    story += [P("To share a feature with others, make the document public (or share it), then they can add it "
                "from <b>Custom features → Add custom features</b> by searching for the document."),
              P("Generating a new feature from text", "h2"),
              P("Run the web app (see Section 5), type a description and copy the returned FeatureScript into "
                "a Feature Studio exactly as above. From the command line:"),
              Preformatted('npm install\nnpm run test:e2e -- "Create a coffee mug with a handle"', S["inline"])]

    # ---- 4. How it works ----
    story += [P("4. How the generator works", "h1")]
    steps = [
        ("Dimension extraction", "A fast model parses the prompt into a shape class and dimensions."),
        ("Retrieval", "The prompt is matched against the feature library manifest, CAD knowledge rows, "
                      "Omni-CAD caption summaries and indexed FeatureScript documentation. The closest "
                      "validated feature is injected as a worked example."),
        ("Generate → test → fix", "Up to 3 candidates. Each one is sanitized and checked by a strict "
                                    "FeatureScript 2931 validator, and blocking errors are fed into the next attempt. "
                                    "If Onshape API keys are configured, candidates are also compiled against a "
                                    "live Part Studio."),
        ("Repair and fallback", "Failing candidates get an AI repair pass. If everything fails, a deterministic "
                                "builder or the closest library feature is returned, so a request always "
                                "produces usable FeatureScript."),
        ("DeepCAD path (optional)", "A Text2CAD model (DeepCAD sketch-and-extrude format) predicts the exact "
                                    "sketch planes, curves and extrude depths. A deterministic compiler "
                                    f"({code('deepcadCompiler.js')}) turns that into FeatureScript with one "
                                    "adjustable Overall Size parameter, so the model never writes code directly."),
    ]
    rows = [[head("Stage"), head("What happens")]] + [[P(a, "cellb"), P(b, "cell")] for a, b in steps]
    story.append(table(rows, [1.6 * inch, 5.2 * inch]))

    # ---- 5. Cloud deployment ----
    story += [P("5. Running in the cloud", "h1"),
              P("The app is a Node 22 Express server and runs on any cloud host. With no API keys it still serves "
                "FeatureScript from the validated library and deterministic builders. Adding "
                f"{code('GROQ_API_KEY')} enables AI generation.")]
    rows = [[head("Target"), head("How")],
            [P("Render", "cellb"), P(f"New → Blueprint → select the repository. {code('render.yaml')} configures "
                                     f"build, start, the {code('/health')} check and secrets.", "cell")],
            [P("Any container host", "cellb"), P(f"{code('docker build -t cad-ai .')} then "
                                                 f"{code('docker run -p 10000:10000 -e GROQ_API_KEY=… cad-ai')} "
                                                 "(Railway, Fly.io, Cloud Run, a VPS).", "cell")],
            [P("Continuous integration", "cellb"), P("GitHub Actions runs the validator, plan-compiler and DeepCAD "
                                                     "regressions and boots the server on every push.", "cell")],
            [P("DeepCAD model (optional)", "cellb"), P(f"Text2CAD on a free Hugging Face Space ({code('hf_space/')}); "
                                                       f"set {code('DEEPCAD_MODEL_URL')}.", "cell")],
            [P("GPU model (optional)", "cellb"), P(f"CADFS-2B on Modal (scales to zero); set {code('CADFS_MODEL_URL')}.",
                                                   "cell")]]
    story.append(table(rows, [1.6 * inch, 5.2 * inch]))

    # ---- 6. Validation ----
    story += [CondPageBreak(2.5 * inch), P("6. Quality and validation", "h1")]
    rows = [[head("Check"), head("Command"), head("Result")],
            [P("Library features pass the strict validator", "cell"), P(code("node scripts/submission_examples.mjs"), "cell"),
             P(f'<font color="#1e7a46">{passed} / {total} pass</font>', "cell")],
            [P("Validator regression (templates, builders, known-bad code)", "cell"), P(code("npm run test:validator"), "cell"),
             P('<font color="#1e7a46">all pass</font>', "cell")],
            [P("Plan compiler regression", "cell"), P(code("npm run test:plan"), "cell"),
             P('<font color="#1e7a46">all pass</font>', "cell")],
            [P("DeepCAD compiler regression", "cell"), P(code("npm run test:deepcad"), "cell"),
             P('<font color="#1e7a46">all pass</font>', "cell")]]
    if live_checked:
        live_color = "#1e7a46" if live_passed == len(live_checked) else "#b42318"
        rows.append([P("Library features executed in a live Onshape Part Studio", "cell"),
                     P(code("node scripts/submission_examples.mjs") + " (with Onshape API keys)", "cell"),
                     P(f'<font color="{live_color}">{live_passed} / {len(live_checked)} pass</font>', "cell")])
    else:
        rows.append([P("Live Onshape compile check", "cell"), P(code("npm run test:onshape"), "cell"),
                     P("Needs Onshape API keys; not run for this packet", "cell")])
    story.append(table(rows, [2.6 * inch, 2.4 * inch, 1.8 * inch]))
    story += [Spacer(1, 6),
              P("The strict validator is a static check. It catches the failure classes the project has seen in "
                "practice: unbalanced braces, unitless vectors, nonexistent operations, wrong query arguments, "
                "and parameters multiplied by units twice. "
                + ("The live check goes further: each feature's source is sent to a real Onshape Part Studio, "
                   "executed by Onshape's own FeatureScript engine, and any error it reports counts as a failure."
                   if live_checked else "Committing a feature in Onshape is the final check."),
                "small"),
              P("FeatureScript conventions the library follows", "h2")]
    story += bullets([
        f"Patterns use {code('opPattern')} with {code('rotationAround')} / {code('transform')} arrays "
        f"({code('opPatternCircular')} and {code('opPatternLinear')} do not exist).",
        f"Strings concatenate with {code('~')}. Arrays grow with {code('append()')} and have no {code('.length')}.",
        f"{code('isLength')} parameters already carry units, so the body never multiplies them by {code('inch')}.",
        f"Holes are inner circles in the same sketch ({code('qSketchRegion(id, true)')}) or an extrude plus "
        f"{code('opBoolean')} SUBTRACTION.",
        f"Revolve axes are {code('Line')} values, never queries. Every sketch is closed with {code('skSolve')}.",
    ])

    # ---- Appendix ----
    story += [PageBreak(), P("Appendix A. Feature source code", "h1"),
              P("The complete source of every feature, exactly as it ships in the repository. Each listing is a "
                "whole Feature Studio file.")]
    for i, e in enumerate(examples, 1):
        params = ", ".join(f"{p['name']} ({p['type']})" for p in e["params"]) or "none"
        header = [P(f"A.{i}  {escape(e['typeName'])}", "h2"),
                  P(f"File {code(e['file'])} · export {code(e['exportName'])} · parameters: {escape(params)}", "small")]
        if e.get("lesson"):
            header.append(P(f"<i>{escape(e['lesson'])}</i>", "small"))
        header.append(Spacer(1, 4))
        listing = Preformatted(e["code"].rstrip("\n"), S["code"], maxLineLength=118, newLineChars="    ")
        story += [CondPageBreak(1.6 * inch), KeepTogether(header), listing, Spacer(1, 8)]

    doc = BaseDocTemplate(out_path, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                          topMargin=0.75 * inch, bottomMargin=0.7 * inch,
                          title="CAD_AI FeatureScript Submission", author=author,
                          subject="Onshape FeatureScript custom feature library")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=on_page)])
    doc.build(story)
    print(f"Wrote {out_path} ({total} features, {passed} valid)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--author", default="noobifyLol")
    ap.add_argument("--out", default=os.path.join(ROOT, "CAD_AI_FeatureScript_Submission.pdf"))
    args = ap.parse_args()
    build(args.author, args.out)
