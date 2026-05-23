## Current Architecture: 2026-05-23

This is the active design now.

### Final goal

1. The AI should rely on Groq reasoning instead of template-first generation.
2. The AI should use the model's own prompt understanding so the app does not depend on heavy keyword routing.
3. After understanding the request, the AI should use FeatureScript documentation plus learned memory to generate the final FeatureScript.

### Active runtime files

- `server.js`
  - main Express server
  - receives prompts and returns generated FeatureScript

- `ai.js`
  - Groq prompt understanding, planning, generation, validation, and repair
  - now defaults away from template fallback

- `learning.js`
  - loads FeatureScript documentation snippets
  - retrieves learned memory from Supabase
  - logs generations and feedback

- `adaptiveNetwork.js`
  - reranks memory rows so the best learned guidance is used first

- `Auth.js`
  - sign up, login, token verification, and auth middleware

- `public/script.js`
  - frontend logic for prompt submission, auth, and showing results

### Files removed from the active runtime

- `agent.js`
  - deleted because it kept an extra agent/template path alive

- `multimodalConditioning.js`
  - deleted with the old `/agent` workflow

### Current request path

`/generate` -> `learning.js` gathers FS docs and learned memory -> `ai.js` uses Groq to reason and generate -> `server.js` returns code and logs feedback

---

Historical notes kept below.

**4/9/26**
This project started on this date.

**This is a onshape featureScript project**
First I have to learn how to connect onshape featurescript to coding environment so I can use every tool to my disposal
I did this by using the onshape devleoper API keys and then setting up a base 64 encoder and then connecting the 2 end points by HMAC-SHA256 calls.

**After the beginning, I had to research how to make it a tool for everyobdy first not just my environment**


**FrameWork for this project not finalized**

1. The Project Framework: "The Hybrid Controller"
Instead of "FeatureScript + AI," think of it as "External Brain -> Internal Execution."

A. The "Brain" (Your Machine/C++)
This is where the heavy lifting happens. Since you can't run LLMs inside Onshape, your C++ bridge acts as the Interpreter.

Input: Natural Language (e.g., "Make a lightweight go-kart steering rack for a 10-inch wheel").

Logic: Your C++ app calls an LLM (like Gemini or OpenAI) to generate a JSON Specification of the geometry (points, constraints, thicknesses).

Output: The app sends a POST request to the Onshape API.

B. The "Nerve System" (The Onshape API)
You don't want to just "draw" things; you want to manipulate them.

Target: Instead of creating a new part every time, your API calls should target Variables in a Variable Studio.

Effect: When the C++ app updates a variable called #steering_angle, the entire 3D model in Onshape updates instantly.

C. The "Muscle" (The FeatureScript Wrapper)
This is the code you publish for the "everyone" factor.

Role: A native Onshape feature that "reads" the variables your AI just injected and builds the complex geometry that standard Onshape tools can't handle.

**Finalized iterated verison after considerating many things**
1. That this has to be unblocked on MCPS
2. I want to make this into a featureScript on onshape so everybody can use it
3. My C++ doens't have to run all the time to keep the AI running


**1. The Architecture: The "Mailbox" System**
Since the FeatureScript cannot talk to you, and you cannot talk to the FeatureScript, you both talk to a shared document variable or metadata field.

The User's Input: You create a FeatureScript with a text box. When the user types "Make a 4-bar linkage," the FeatureScript writes that string into a Hidden Variable or the Document Description.

The C++ Bridge (The Listener): Your C++ app in VS Code runs a "Polling Loop." Every 2 seconds, it asks the Onshape API: "Has the Description changed in Document X?"

The Brain (LLM): When your C++ app sees a new command, it sends it to the AI.

The Execution: Your C++ app then "inscribes" the answer (coordinates, dimensions, or FeatureScript code) back into a Variable Studio in that same document.

The Result: The user's Onshape screen suddenly flashes, and the linkage appears.

2. Step-by-Step Implementation Framework
Stage 1: The FeatureScript "Interface"
This is what "Everyone" sees. It doesn't need AI logic; it just needs to be a transmitter.

The UI: A simple text input.

The Task: It takes the text and uses setVariable to store the prompt.

The Quality: Use annotation { "UIHint" : UIHint.REMOTE_DATA } if possible, or simply label it as "Architect Command."

Stage 2: The C++ "Polling Agent" (VS Code)
This is your "Engine." Since it runs on your machine, it has full access to the internet and your AI keys.

The Watcher: Use a while(true) loop with a small sleep to avoid hitting API rate limits.

The Logic: 1.  GET the Variable Studio JSON.
2.  Check if Architect_Prompt has changed.
3.  If yes, send that prompt + the current sketch JSON to the AI.
4.  Receive a list of "Movements" or "Constraints."

Stage 3: The "Injection" (Closing the Loop)
This is where you modify the design.

The Post: Your C++ app sends a POST request to /api/variables/... or /api/partstudios/.../sketches.

Native Modification: You aren't just drawing over their work; you are re-defining the geometry they already have.

3. The "Everyone" Problem: Scaling Without a Website
If you want "Everyone" to use this without them downloading your app, you have one high-level option: The Hosted Listener.

You can run your C++ bridge on a Cloud Server (VPS).

How it works: You make a "Master Document" list. When a user wants to use your tool, they simply "Add" your Architect FeatureScript and "Share" their document with your Architect's Service Account email.

The Firewall Bypass: Your server handles all the AI and API calls. The user is just sitting in Onshape. The school firewall sees nothing but Onshape.

4. The College Essay Perspective: "Invisible Infrastructure"
This project is much more impressive than a standard AI app. You are building Middleware.

The Hook: "How I turned a CAD platform into a communication protocol to bypass network restrictions."

The Narrative: You're showing that you understand latency, API polling, and data serialization. You're proving that you can build a professional-grade tool (like Crates.io) that respects the physical constraints of your environment (the school firewall).

The Impact: You didn't just make a "cool script"; you made an Extensible System that other students can use to learn engineering.


**Final iteration of the design**
The Data Flow SummaryComponentLocationRoleFeatureScriptInside OnshapeThe UI. Collects the prompt and writes it to a variable.Variable StudioInside OnshapeThe Mailbox. Holds the "Prompt" and the "Result."C++ AppYour PC (or Server)The Brain. Polls the Mailbox, calls the AI, and writes the CAD data back.Onshape APIThe CloudThe Tunnel. The only thing the school firewall sees.

Updated, we're using OAuth2 to byapss the API key restrictions

Ok, the connection part is messed up, if we're prompting the user for the URL of the elem, we can't even connect to check in the first place. 

**4/18/26**
Realized that this is more complicated than form the surface. Used AI to generate all different possiblies and this is what it camed up with
┌─────────────────────────────────────────────────────┐
│                  USER'S ONSHAPE DOC                 │
│                                                     │
│  [PW_AI FeatureScript]  ──writes──►  [YOUR RELAY    │
│   User types prompt                   Variable      │
│   + their doc URL                     Studio]       │
└─────────────────────────────────────────────────────┘
         ▲                                    │
         │ writes geometry back               │ C++ polls every 3s
         │ via REST API                       ▼
┌─────────────────────────────────────────────────────┐
│              YOUR C++ BRIDGE (runs on PC/VPS)       │
│                                                     │
│  1. Poll relay Variable Studio for new prompts      │
│  2. Read: prompt + target doc URL                   │
│  3. Call AI (Gemini/OpenAI) → geometry params       │
│  4. POST features to TARGET doc via REST API        │
│  5. Mark relay as "DONE"                            │
└─────────────────────────────────────────────────────┘


**My approach after thinking abit**
We do make a website, prompt the user to sign up and copy and paste their API into variables
and then the website would post my C++ code to check if a generated variable studio has been changed or not and we tell the user not to change that file but only throught the AI cad featurescript prompt boxes.

**The website version is a major security risk**
If this doesn't work out after some thinking, I can just switch to a AI that generates featureScripts and then tell the onshape user to just copy and paste the script that creates what they want and then they can manage it from there.
**4/18/26**
I just decided to use OAuth intstead of API keys.

**4/19/26**
File	Purpose
connector.fs	The FeatureScript that lives in Onshape. It creates the "Build" button and writes to the Variable Studio chalkboard.
main.cpp	The Controller. It handles the "polling" (checking the chalkboard) and coordinates the AI.
oauth_handler.cpp	The Security Guard. This code handles the "handshake" and stores your temporary Access Token.
ai_logic.cpp	The Thinker. This file talks to Gemini and translates "Make a desk stand" into "12x4x8 inches."
.env	The Vault. This is a hidden text file where you paste your Client ID and Client Secret from the Developer Portal.

**More information**
Ended with trying to use Groq models of AI, now the challenge is telling the AI where to put or teach the AI how to modify the existing file. My current approach right now is to also include the 3d cordinate and oritations of everything and give it to the AI where it would regenerate everything. The OAuth allows us to modify anyone's documents without limits. It also connect our local code to onshape.
**4/20/26**
Finish all the AI, Auth, Connection code. Created the connection file for the featureScript and the C++ code "cad_ai.exe" throught installing OpenSSL and vcpkg. The "cad_ai.exe" can only run in you local computer though.
**More important info**
To upload to cloud, we have to switch to JavaScript

CAD-AI-JS/
├── node_modules/         # Automatically created (don't touch)
├── public/               # (Optional) For a simple "Success" login page
│   └── index.html
├── src/                  # All your logic lives here
│   ├── auth.js           # Onshape OAuth & Token management
│   ├── ai.js             # Groq SDK & Prompt engineering
│   ├── onshape.js        # API calls to read/write CAD data
│   └── server.js         # The "Brain" (main entry point)
├── .env                  # Your API Keys (DO NOT UPLOAD TO GITHUB)
├── .gitignore            # Tells Git to ignore .env and node_modules
├── package.json          # List of your project dependencies
└── README.md             # Instructions for your teammates


2. The Logic Flow (The "Cloud" Way)In this design, your server.js acts as a 24/7 listener. Unlike the C++ version where you had to manually poll, a JS server can handle "Webhooks"—Onshape telling you exactly when a user clicks a button.ModuleResponsibilityserver.jsStarts the web server (Express). It listens for Onshape "updates" and handles the URL people click to log in.auth.jsHandles the "Handshake." It saves the Access Tokens so users don't have to log in every 5 minutes.ai.jsTakes the prompt from Onshape, adds "System Instructions" (telling the AI to only write FeatureScript), and gets the response from Groq.onshape.jsUses the Token to "reach into" the user's document and paste the AI's code into the FeatureScript element.
**4/21/26**
Onshape keeps rejecting the JS code giving 401 errors. That was because I was back to coding the HMAC signatures which was for the API keys and not OAuth2. And then some twitching with the .env file and then now the local server can detect if there was a prompt sent to a the document or not 
"[poll] Change detected (MV: 0c77c7c27d67361c99216019). Triggering update...
[Bridge] Pulling prompt from Onshape...
[Request] GET https://cad.onshape.com/api/featurestudios/d/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/6f149ec44119f713652256fb"
The AI is getting called but there are currently no edits in the onshape document.
**Current structure of the project**
┌──────────────────────────────────────────────┐
│                USER’S ONSHAPE DOC            │
│                                              │
│  [AI_CAD FeatureScript]                      │
│   - Text box for prompt                      │
│   - Button: “Connect AI”                     │
│   - Writes: #AI_Prompt, #AI_Status           │
│                                              │
│  [Variable Studio]                           │
│   - #AI_Prompt = "make a 50mm cube"          │
│   - #AI_Status = "PENDING"                   │
│   - #AI_Result = ""                          │
└──────────────────────────────────────────────┘
                     │
                     │ OAuth2 token (user logs in ONCE)
                     ▼
┌──────────────────────────────────────────────┐
│              YOUR VPS AI SERVER              │
│                                              │
│  1. Receives OAuth token                     │
│  2. Polls Variable Studio                    │
│  3. Reads #AI_Prompt                         │
│  4. Calls Groq → generates FeatureScript     │
│  5. Writes FeatureScript into user’s doc     │
│  6. Sets #AI_Status = "DONE"                 │
└──────────────────────────────────────────────┘
I also reached how to get a smarter AI model with these commands for onshape:
GET /api/variables/d/:did/w/:wid/e/:eid
GET /api/partstudios/d/:did/w/:wid/e/:eid/sketches
GET /api/partstudios/d/:did/w/:wid/e/:eid/tessellatedfaces
GET /api/partstudios/d/:did/w/:wid/e/:eid/features

**4/22/26**
Did some testing
[Request] GET https://cad.onshape.com/api/featurestudios/d/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/6f149ec44119f713652256fb
[Debug] Full Prompt Pulled: "FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "AI Architect Relay" }
export const aiRelay = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "What do you want to build?" }
        definition.prompt is string;

        annotation { "Name" : "Send to AI Server" }
        definition.sendRequest is boolean;
    }
    {
        // 1. Create the variables. 
        // These will now show up in the "Part Studio 1" section of your Variable Table.
        setVariable(context, "AI_PROMPT", definition.prompt);
        
        if (definition.sendRequest) 
        {
            setVariable(context, "AI_STATUS", "PENDING");
        } 
        else 
        {
            setVariable(context, "AI_STATUS", "IDLE");
        }

        // This prevents the "Error regenerating" if the variable isn't set yet
        try
        {
            setVariable(context, "AI_RESULT", "WAITING");
        }
        catch
        {
            // Do nothing if it fails
        }
    });"
[Bridge] Sending to AI...
[Bridge] Editing Onshape document...
[Request] POST https://cad.onshape.com/api/featurestudios/d/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/e/6f149ec44119f713652256fb
[Request] GET https://cad.onshape.com/api/documents/d/c1fbbbb30348e3d729c9e329/w/f462715c39b4372c5d5dfb96/currentmicroversion
[poll] Sync successful. Next check in 5000ms.


**New model 4/26**
User types prompt in FeatureScript UI panel
        ↓
Bridge reads via /api/featurestudios params
        ↓
Stage 1 (Vision, optional): If image attached, describe geometry
        ↓
Stage 2 (Planner): Break intent into ordered CAD ops
        [Sketch on XY plane] → [Extrude 2in] → [Fillet edges]
        ↓
Stage 3 (Coder): Translate plan → valid FeatureScript
        ↓
POST back to same Feature Studio


// {"authorized":true,"polling":true,"promptMode":"inline","lastMicroversion":"03343ddf17e5b9cfc2263ca9","lastProcessedPrompt":"Describe what you want to create here"} status
// {"triggered":true,"didProcess":false} trigger

I learned how to publish and make others see what I have made and made an AI pipeline process on how to make a featureScript

**4/27/26**
"No prompt found" — after the AI writes back, // AI_PROMPT: gets dropped because the AI output sometimes starts without a newline before FeatureScript 2931;, mangling the header regex
qOriginPlane(context, Plane.XY) — this function signature doesn't exist. Correct is plane(WORLD_ORIGIN, Z_DIRECTION)
isLength in the body — precondition params written in the feature body instead of precondition {} block
The whole inline-comment approach is too fragile — you're essentially relying on the user to preserve a comment format in a file the AI keeps overwriting
**4/30/26**
Ai kept generating the code with errors like missing parameters, I just fixed it by changing and teaching the model how featureScript code worked.
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripFences(text) {
  if (!text) return "";
  const m = text.match(/```(?:featurescript|fs|javascript)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

function stripJson(text) {
  if (!text) return "{}";
  const m = text.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

async function chat(messages, temperature = 0.05) {
  const res = await groq.chat.completions.create({ model: MODEL, temperature, messages });
  return res?.choices?.[0]?.message?.content ?? "";
}

// ─── Stage 1: CAD Planner ────────────────────────────────────────────────────

async function planCad(prompt) {
  const raw = await chat([
    {
      role: "system",
      content: `You are a senior CAD engineer planning Onshape FeatureScript solid modeling operations.
Output ONLY valid JSON. No markdown, no backticks, no extra text.

━━━ CONTEXT ━━━
The user is working in Onshape — a browser-based parametric CAD system.
FeatureScript is Onshape's built-in modeling language. Each operation is a solid-modeling
step (sketch, extrude, fillet, etc.). The output runs live inside Onshape to create 3-D geometry.

━━━ INTERPRETING PROMPTS ━━━
• "box / cube / block / rectangular part" → SKETCH rect on XY + EXTRUDE
• "cylinder / rod / tube / pipe"          → CYLINDER op (or SKETCH circle + EXTRUDE)
• "hole / pocket / cutout / bore"         → second SKETCH + EXTRUDE_CUT
• "fillet / round edges / smooth edges"   → FILLET (always after solid exists)
• "chamfer / bevel / angled edge"         → CHAMFER (always after solid exists)
• Assume INCHES unless user says mm / cm / m
• If a dimension is missing, pick a sensible default (1 inch for small features, 2 inches for main body)
• hasParams is ALWAYS false — hardcode every dimension, never use definition.xxx in the body

━━━ OUTPUT SCHEMA ━━━
{
  "featureName": "camelCase e.g. roundedBox",
  "featureLabel": "Human label e.g. Rounded Box",
  "summary": "one sentence describing what this creates",
  "hasParams": false,
  "operations": [
    {
      "step": 1,
      "op": "SKETCH | EXTRUDE | EXTRUDE_CUT | FILLET | CHAMFER | CYLINDER | BOX",
      "sketchPlane": "XY | XZ | YZ | null",
      "description": "what this step does",
      "dims": { "w": 2, "h": 2, "depth": 2 }
    }
  ]
}

━━━ RULES ━━━
- hasParams MUST be false — never true
- Always start with SKETCH on XY unless specifically needed otherwise
- EXTRUDE adds material; EXTRUDE_CUT removes it and needs its own sketch
- CYLINDER for standalone cylinder from origin
- Fillets/chamfers always LAST, after solid exists
- All dims in inches (plain numbers only, no units in JSON)
- Fewer steps is better — keep it simple
`
    },
    { role: "user", content: prompt.trim() }
  ], 0.0);

  try {
    const plan = JSON.parse(stripJson(raw));
    // Force hasParams false — never allow parametric generation (it breaks the body)
    plan.hasParams = false;
    return plan;
  } catch {
    console.warn("[AI] Plan parse failed, using 2×2×2 box fallback.");
    return {
      featureName: "simpleBox", featureLabel: "Simple Box",
      summary: "A 2×2×2 inch box", hasParams: false,
      operations: [
        { step: 1, op: "SKETCH",  sketchPlane: "XY", description: "2×2 inch square on XY", dims: { w: 2, h: 2 } },
        { step: 2, op: "EXTRUDE", sketchPlane: null,  description: "Extrude 2 inches up",   dims: { depth: 2 } },
      ]
    };
  }
}

// ─── Stage 2: Code Generator ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an Onshape FeatureScript expert. Output ONLY raw FeatureScript. No markdown. No backticks. No explanations.

════════════ FILE STRUCTURE ════════════
Line 1 (exactly): FeatureScript 2931;
Line 2 (exactly): import(path : "onshape/std/geometry.fs", version : "2931.0");
Then ONE annotation + ONE export const. Never more than one.

════════════ PLANE CONSTANTS ════════════
XY → plane(WORLD_ORIGIN, Z_DIRECTION)
XZ → plane(WORLD_ORIGIN, Y_DIRECTION)
YZ → plane(WORLD_ORIGIN, X_DIRECTION)

Extrude from XY sketch → Z_DIRECTION
Extrude from XZ sketch → Y_DIRECTION
Extrude from YZ sketch → X_DIRECTION

❌ NEVER: qOriginPlane, Plane.XY, Plane.XZ, Plane.YZ, evPlane(...).normal

════════════ defineFeature — ONLY VALID FORM ════════════
// Always use this form (no precondition, no definition.xxx):
annotation { "Feature Type Name" : "Simple Box" }
export const simpleBox = defineFeature(function(context is Context, id is Id, definition is map)
{
    // hardcoded geometry here — NO return, NO definition.xxx, NO isLength/isAngle
});

❌ NEVER use precondition blocks
❌ NEVER use definition.width, definition.anything
❌ NEVER use isLength(), isAngle(), isBoolean() anywhere
❌ NEVER write a return statement

════════════ OPERATION PATTERNS ════════════

── SKETCH ──
var sketch1 = newSketch(context, id + "sketch1", {
    "sketchPlane" : plane(WORLD_ORIGIN, Z_DIRECTION)
});
skRectangle(sketch1, "rect1", {
    "firstCorner"  : vector(-1, -1) * inch,
    "secondCorner" : vector(1, 1) * inch
});
skSolve(sketch1);    ← ALWAYS call this, ALWAYS before opExtrude

── EXTRUDE (add material) ──
opExtrude(context, id + "extrude1", {
    "entities"  : qSketchRegion(id + "sketch1"),
    "direction" : Z_DIRECTION,
    "endBound"  : BoundingType.BLIND,
    "endDepth"  : 2 * inch
});

── EXTRUDE CUT (remove material) ──
var sketch2 = newSketch(context, id + "sketch2", {
    "sketchPlane" : plane(WORLD_ORIGIN, Z_DIRECTION)
});
skCircle(sketch2, "hole1", { "center" : vector(0, 0) * inch, "radius" : 0.25 * inch });
skSolve(sketch2);
opExtrude(context, id + "cut1", {
    "entities"      : qSketchRegion(id + "sketch2"),
    "direction"     : Z_DIRECTION,
    "endBound"      : BoundingType.BLIND,
    "endDepth"      : 2 * inch,
    "operationType" : NewBodyOperationType.REMOVE
});

── CYLINDER ──
opCylinder(context, id + "cyl1", {
    "topCenter"     : vector(0, 0, 2) * inch,
    "bottomCenter"  : vector(0, 0, 0) * inch,
    "radius"        : 0.5 * inch,
    "operationType" : NewBodyOperationType.NEW
});

── BOX ──
opBox(context, id + "box1", {
    "corner1" : vector(0, 0, 0) * inch,
    "corner2" : vector(2, 2, 2) * inch
});

── FILLET ──
opFillet(context, id + "fillet1", {
    "entities" : qEdgeTopologyFilter(
                     qOwnedByBody(qCreatedBy(id + "extrude1", EntityType.BODY), EntityType.EDGE),
                     EdgeTopology.TWO_SIDED),
    "radius" : 0.125 * inch
});

════════════ DIMENSION RULES — CRITICAL ════════════
✓ ALWAYS write dimensions as:  2 * inch   or   0.5 * inch
✓ VECTOR SCALING: Apply the unit ONCE at the end: vector(x, y, z) * inch
✗ NEVER write:  2 * inch * inch   (double unit — fatal error)
✗ NEVER write bare numbers:  "endDepth" : 2   (missing unit — fatal error)
✗ NEVER multiply a scaled vector by a unit again: vector(x) * inch * inch
✗ NEVER use definition.xxx for any dimension — hardcode everything

════════════ CHECKLIST ════════════
Before outputting, verify:
□ Starts with exactly: FeatureScript 2931;
□ Exactly ONE export const
□ No precondition block
□ No isLength / isAngle / isBoolean anywhere
□ No definition.width / definition.anything
□ No return statement
□ No qOriginPlane / Plane.XY / Plane.XZ / Plane.YZ
□ No evPlane(...).normal
□ skSolve() called after every sketch, before every opExtrude
□ Every dimension ends with exactly one  * inch  (not * inch * inch)
`;

async function generateCode(plan) {
  const raw = await chat([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Generate FeatureScript for this plan. ONE export const only. No precondition. Hardcode all dimensions.\nStart EXACTLY with: FeatureScript 2931;\n\nPLAN:\n${JSON.stringify(plan, null, 2)}`
    }
  ]);

  const code = stripFences(raw);
  if (!code?.includes("FeatureScript")) throw new Error("Model returned invalid FeatureScript.");
  return code;
}

// ─── Stage 3: Deterministic fixer ────────────────────────────────────────────

function jsFix(code) {
  let out = code;

  // ── Fix squashed headers/imports ──
  out = out.replace(/(import\(.*?\);)\s*(annotation)/g, '$1\n\n$2');

  // ── Fix forbidden plane references ──
  out = out.replace(/qOriginPlane\s*\(\s*context\s*,\s*Plane\.XY\s*\)/g, "plane(WORLD_ORIGIN, Z_DIRECTION)");
  out = out.replace(/qOriginPlane\s*\(\s*context\s*,\s*Plane\.XZ\s*\)/g, "plane(WORLD_ORIGIN, Y_DIRECTION)");
  out = out.replace(/qOriginPlane\s*\(\s*context\s*,\s*Plane\.YZ\s*\)/g, "plane(WORLD_ORIGIN, X_DIRECTION)");
  out = out.replace(/\bPlane\.XY\b/g, "plane(WORLD_ORIGIN, Z_DIRECTION)");
  out = out.replace(/\bPlane\.XZ\b/g, "plane(WORLD_ORIGIN, Y_DIRECTION)");
  out = out.replace(/\bPlane\.YZ\b/g, "plane(WORLD_ORIGIN, X_DIRECTION)");
  out = out.replace(/evPlane\s*\([^)]+\)\.normal/g, "Z_DIRECTION");

  // ── Fix wrong boolean op name ──
  out = out.replace(/BooleanOperationType\.SUBTRACT\b(?!ION)/g, "BooleanOperationType.SUBTRACTION");

  // ── Remove return statements ──
  out = out.replace(/\breturn\s+[^;{}]+;/g, "");

  // ── Aggressive Double Unit Fixes ──
  // Catches standard "* inch * inch" even with weird spacing/newlines
  out = out.replace(/(\*\s*inch)(\s*\*\s*inch)+/g, "$1");
  out = out.replace(/(\*\s*millimeter)(\s*\*\s*millimeter)+/g, "$1");
  // Catches vector double multiplication: vector(1,1) * inch * inch
  out = out.replace(/(vector\(.*?\)\s*\*\s*inch)\s*\*\s*inch/g, "$1");

  // ── Fix MISSING units on known dimension keys (only when not already followed by * ) ──
  out = out.replace(
    /"(endDepth|startDepth|radius|width|depth|height)"\s*:\s*(\d+(?:\.\d+)?)\s*(?!\*)/g,
    (_, key, num) => `"${key}" : ${num} * inch`
  );

  // ── Remove isLength/isAngle/isBoolean calls that sneaked into the feature body ──
  out = out.replace(/^\s*(annotation\s*\{[^}]*\}\s*\n)?\s*is(Length|Angle|Boolean|Integer)\s*\([^)]+\)\s*;.*$/gm, "");

  // ── Remove definition.xxx references ──
  out = out.replace(/definition\.\w+\s*\/\s*2/g, "0.5 * inch");
  out = out.replace(/definition\.\w+/g, "1 * inch");

  // ── Strip extra export const blocks (keep only the last complete one) ──
  const exportCount = (out.match(/\bexport const\b/g) || []).length;
  if (exportCount > 1) {
    console.warn(`[AI] jsFix: found ${exportCount} export const — keeping last one only`);
    const lastAnno = out.lastIndexOf('annotation { "Feature Type Name"');
    if (lastAnno > 0) {
      out = `FeatureScript 2931;\nimport(path : "onshape/std/geometry.fs", version : "2931.0");\n\n` + out.slice(lastAnno);
    }
  }

  return out;
}

// ─── Stage 4: AI reviewer ─────────────────────────────────────────────────────

async function reviewCode(code) {
  const prefixed = jsFix(code); // deterministic fixes first

  const raw = await chat([
    {
      role: "system",
      content: `You are a strict FeatureScript linter. Fix ONLY the specific issues listed below.
Return ONLY the corrected raw FeatureScript. No markdown. No backticks. No explanations.

CRITICAL: Do NOT add, change, or "improve" anything that is not broken.
In particular:
- Do NOT add * inch to values that already end with * inch — that creates "2 * inch * inch" which is WRONG
- Do NOT add a precondition block
- Do NOT add definition.xxx parameters
- Do NOT add isLength / isAngle / isBoolean

ONLY fix these specific issues if present:
1. qOriginPlane(...)             → plane(WORLD_ORIGIN, Z_DIRECTION)
2. Plane.XY / Plane.XZ / Plane.YZ → same replacements
3. evPlane(...).normal           → Z_DIRECTION / Y_DIRECTION / X_DIRECTION
4. isLength/isAngle in feature body (outside precondition) → DELETE that line
5. More than one export const   → DELETE all but the last one
6. return statement in body     → DELETE it
7. Bare number with no unit: "endDepth" : 2  → "endDepth" : 2 * inch
   But ONLY if not already followed by * inch
8. Missing skSolve() after sketch entities → ADD skSolve before opExtrude
9. BooleanOperationType.SUBTRACT → BooleanOperationType.SUBTRACTION
10. definition.xxx in body      → replace with hardcoded 1 * inch
11. Double units ("* inch * inch") MUST be reduced to a single "* inch". Check vector multiplications carefully.
12. Ensure annotations are NOT squished next to import statements (must be on a new line).
`
    },
    { role: "user", content: prefixed }
  ], 0.0);

  const reviewed = stripFences(raw);
  if (!reviewed?.includes("FeatureScript")) {
    console.warn("[AI] Reviewer returned bad output — using jsFix version.");
    return prefixed;
  }

  // Run jsFix AGAIN on reviewer output to catch anything the reviewer introduced
  return jsFix(reviewed);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");
  if (!prompt?.trim()) throw new Error("Empty prompt");

  console.log("[AI] Stage 1: Planning...");
  const plan = await planCad(prompt);
  console.log(`[AI] Plan: ${plan.summary}`);
  plan.operations?.forEach(op => console.log(`  Step ${op.step}: ${op.op} — ${op.description}`));

  console.log("[AI] Stage 2: Generating code...");
  const code = await generateCode(plan);

  console.log("[AI] Stage 3: Reviewing & fixing...");
  const final = await reviewCode(code);

  // ── Sanity checks ──
  if (final.includes("qOriginPlane"))
    console.error("[AI] ⚠ qOriginPlane still present!");
  if (/\bPlane\.[XYZ]{2}\b/.test(final))
    console.error("[AI] ⚠ Plane.XY/XZ/YZ still present!");
  if (/\*\s*inch\s*\*\s*inch/.test(final))
    console.error("[AI] ⚠ Double * inch still present!");
  if (/\bdefinition\.\w+/.test(final))
    console.error("[AI] ⚠ definition.xxx still present — will cause compile error!");
  if (/\bis(Length|Angle|Boolean)\b/.test(final))
    console.error("[AI] ⚠ isLength/isAngle/isBoolean still present in body!");

  const exports = (final.match(/\bexport const\b/g) || []).length;
  if (exports !== 1) console.error(`[AI] ⚠ Expected 1 export const, found ${exports}`);

  console.log(`[AI] ✓ Final output: ${final.length} chars`);
  return final;
} before : 4/30/26

import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripFences(text) {
  if (!text) return "";
  const m = text.match(/```(?:featurescript|fs|javascript)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

function stripJson(text) {
  if (!text) return "{}";
  const m = text.match(/```json?\s*([\s\S]*?)```/i);
  return (m ? m[1] : text).trim();
}

async function chat(messages, temperature = 0.05) {
  const res = await groq.chat.completions.create({ model: MODEL, temperature, messages });
  return res?.choices?.[0]?.message?.content ?? "";
}

// ─── Stage 1: CAD Planner ────────────────────────────────────────────────────

async function planCad(prompt) {
  const raw = await chat([
    {
      role: "system",
      content: `You are a senior CAD engineer planning Onshape FeatureScript solid modeling operations.
Output ONLY valid JSON. No markdown, no backticks, no extra text.

━━━ CONTEXT ━━━
The user works in Onshape. FeatureScript features require the user to SELECT A FACE first
in the Part Studio UI. The feature builds geometry relative to that selected face.
Every feature must therefore have a face-selection precondition.

━━━ SHAPE → SKETCH ENTITY MAPPING ━━━
Use ONLY these sketch functions — no others exist:
  rectangle / box / square         → skRectangle
  circle / cylinder base           → skCircle
  triangle / pyramid base          → skRegularPolygon (sides: 3)
  pentagon                         → skRegularPolygon (sides: 5)
  hexagon                          → skRegularPolygon (sides: 6)
  any regular N-gon                → skRegularPolygon (sides: N)
  irregular polygon / custom shape → skLineSegment (one per edge)
  arc                              → skArc
  line                             → skLineSegment
❌ skPolygon does NOT exist — never plan it

━━━ OPERATION TYPES ━━━
  SKETCH      — create sketch geometry on the selected face
  EXTRUDE     — add material by extruding a sketch region
  EXTRUDE_CUT — remove material (separate sketch + REMOVE operationType)
  FILLET      — round edges (always LAST)
  CHAMFER     — bevel edges (always LAST)
  CYLINDER    — opCylinder primitive (no sketch needed)
  BOX         — opBox primitive (no sketch needed)

━━━ OUTPUT SCHEMA ━━━
{
  "featureName": "camelCase",
  "featureLabel": "Human Label",
  "summary": "one sentence",
  "sketchEntity": "skRectangle | skCircle | skRegularPolygon | skLineSegment",
  "regularPolygonSides": 3,
  "operations": [
    {
      "step": 1,
      "op": "SKETCH | EXTRUDE | EXTRUDE_CUT | FILLET | CHAMFER | CYLINDER | BOX",
      "description": "what this step does",
      "dims": { "w": 2, "h": 2, "depth": 2, "radius": 1, "sides": 3 }
    }
  ]
}

━━━ RULES ━━━
- Always start with SKETCH
- All dims are plain numbers in inches
- Fillets/chamfers always last
- Fewer steps = better
- Never plan skPolygon — it does not exist in FeatureScript
`
    },
    { role: "user", content: prompt.trim() }
  ], 0.0);

  try {
    return JSON.parse(stripJson(raw));
  } catch {
    console.warn("[AI] Plan parse failed, using box fallback.");
    return {
      featureName: "simpleBox", featureLabel: "Simple Box",
      summary: "A 2×2×2 inch box", sketchEntity: "skRectangle",
      operations: [
        { step: 1, op: "SKETCH",  description: "2×2 inch rectangle", dims: { w: 2, h: 2 } },
        { step: 2, op: "EXTRUDE", description: "Extrude 2 inches",   dims: { depth: 2 } },
      ]
    };
  }
}

// ─── Stage 2: Code Generator ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an Onshape FeatureScript expert. Output ONLY raw FeatureScript. No markdown. No backticks. No explanations.

════════════ FILE STRUCTURE ════════════
FeatureScript 2931;
import(path : "onshape/std/geometry.fs", version : "2931.0");

annotation { "Feature Type Name" : "Label Here" }
export const featureName = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        ... precondition body ...
    }
    {
        ... feature body ...
    }
);

════════════ PRECONDITION — ALWAYS REQUIRED ════════════
Every feature MUST have a precondition that lets the user select a face:

    precondition
    {
        annotation { "Name" : "Face", "Filter" : EntityType.FACE, "MaxNumberOfPicks" : 1 }
        definition.face is Query;
    }

════════════ SKETCH PLANE ════════════
ALWAYS use the selected face for the sketch plane — never hardcode a plane:

    var sketch1 = newSketch(context, id + "sketch1", {
        "sketchPlane" : evPlane(context, { "face" : definition.face })
    });

The extrude direction is the face normal:
    "direction" : evPlane(context, { "face" : definition.face }).normal,

════════════ SKETCH ENTITY REFERENCE ════════════
Use ONLY these functions. Others do not exist.

── skRectangle (box / square shapes) ──
skRectangle(sketch1, "rect1", {
    "firstCorner"  : vector(-1, -1) * inch,
    "secondCorner" : vector(1, 1) * inch
});

── skCircle (circle / cylinder base) ──
skCircle(sketch1, "circle1", {
    "center" : vector(0, 0) * inch,
    "radius" : 1 * inch
});

── skRegularPolygon (triangle=3, pentagon=5, hexagon=6, any N-gon) ──
skRegularPolygon(sketch1, "poly1", {
    "center"      : vector(0, 0) * inch,
    "firstVertex" : vector(0, 1) * inch,
    "sides"       : 3
});

── skLineSegment (custom/irregular polygons — one call per edge) ──
skLineSegment(sketch1, "line1", { "start" : vector(0, -1) * inch, "end" : vector(-1, 0.5) * inch });
skLineSegment(sketch1, "line2", { "start" : vector(-1, 0.5) * inch, "end" : vector(1, 0.5) * inch });
skLineSegment(sketch1, "line3", { "start" : vector(1, 0.5) * inch, "end" : vector(0, -1) * inch });

── skArc ──
skArc(sketch1, "arc1", {
    "start"  : vector(1, 0) * inch,
    "mid"    : vector(0, 1) * inch,
    "end"    : vector(-1, 0) * inch
});

❌ skPolygon — does NOT exist, never use it
❌ skPolyline — does NOT exist, never use it

════════════ AFTER SKETCH — ALWAYS CALL skSolve ════════════
skSolve(sketch1);   ← call immediately after the last sketch entity, before opExtrude

════════════ EXTRUDE PATTERNS ════════════

── Add material ──
opExtrude(context, id + "extrude1", {
    "entities"  : qSketchRegion(id + "sketch1"),
    "direction" : evPlane(context, { "face" : definition.face }).normal,
    "endBound"  : BoundingType.BLIND,
    "endDepth"  : 2 * inch
});

── Remove material (hole/pocket) ──
// Make a SEPARATE sketch first, then:
opExtrude(context, id + "cut1", {
    "entities"      : qSketchRegion(id + "sketch2"),
    "direction"     : evPlane(context, { "face" : definition.face }).normal,
    "endBound"      : BoundingType.BLIND,
    "endDepth"      : 2 * inch,
    "operationType" : NewBodyOperationType.REMOVE
});

════════════ OTHER PRIMITIVES ════════════

── CYLINDER (no sketch needed) ──
opCylinder(context, id + "cyl1", {
    "topCenter"     : vector(0, 0, 2) * inch,
    "bottomCenter"  : vector(0, 0, 0) * inch,
    "radius"        : 0.5 * inch,
    "operationType" : NewBodyOperationType.NEW
});

── BOX (no sketch needed) ──
opBox(context, id + "box1", {
    "corner1" : vector(0, 0, 0) * inch,
    "corner2" : vector(2, 2, 2) * inch
});

── FILLET (always last) ──
opFillet(context, id + "fillet1", {
    "entities" : qEdgeTopologyFilter(
                     qOwnedByBody(qCreatedBy(id + "extrude1", EntityType.BODY), EntityType.EDGE),
                     EdgeTopology.TWO_SIDED),
    "radius" : 0.125 * inch
});

── CHAMFER (always last) ──
opChamfer(context, id + "chamfer1", {
    "entities" : qEdgeTopologyFilter(
                     qOwnedByBody(qCreatedBy(id + "extrude1", EntityType.BODY), EntityType.EDGE),
                     EdgeTopology.TWO_SIDED),
    "chamferType" : ChamferType.EQUAL_OFFSETS,
    "width"       : 0.125 * inch
});

════════════ DIMENSION RULES — ABSOLUTE ════════════
✓ Write scalar dimensions as:    2 * inch     0.5 * inch
✓ Write vectors as:              vector(x, y) * inch    vector(x, y, z) * inch
✗ NEVER:  2 * inch * inch        (double unit — compile error)
✗ NEVER:  vector(x,y) * inch * inch   (double unit — compile error)
✗ NEVER:  "endDepth" : 2         (missing unit — compile error)
✗ NEVER:  definition.anything    (no parametric references)
✗ NEVER:  isLength() isAngle() isBoolean() outside precondition

════════════ FINAL CHECKLIST ════════════
□ File starts: FeatureScript 2931;
□ Exactly ONE export const
□ precondition block present with definition.face is Query
□ Sketch plane: evPlane(context, { "face" : definition.face })
□ Extrude direction: evPlane(context, { "face" : definition.face }).normal
□ NO skPolygon / skPolyline (do not exist)
□ skSolve() called after every sketch block
□ Every dimension: exactly ONE * inch
□ No return statement
□ No definition.xxx outside precondition
`;

async function generateCode(plan) {
  const raw = await chat([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Generate FeatureScript for this plan. ONE export const. Include precondition with face selection. Hardcode all dimensions.\nStart EXACTLY with: FeatureScript 2931;\n\nPLAN:\n${JSON.stringify(plan, null, 2)}`
    }
  ]);

  const code = stripFences(raw);
  if (!code?.includes("FeatureScript")) throw new Error("Model returned invalid FeatureScript.");
  return code;
}

// ─── Stage 3: Deterministic fixer ────────────────────────────────────────────
// This runs BEFORE and AFTER the AI reviewer.
// It must never introduce new bugs — only fix known patterns mechanically.

function jsFix(code) {
  let out = code;

  // ── Ensure annotation is on its own line after the import ──
  out = out.replace(/(import\(.*?\);)(annotation)/g, "$1\n\n$2");

  // ── Fix forbidden static planes (only when NOT used with definition.face) ──
  out = out.replace(/qOriginPlane\s*\(\s*context\s*,\s*Plane\.XY\s*\)/g, "plane(WORLD_ORIGIN, Z_DIRECTION)");
  out = out.replace(/qOriginPlane\s*\(\s*context\s*,\s*Plane\.XZ\s*\)/g, "plane(WORLD_ORIGIN, Y_DIRECTION)");
  out = out.replace(/qOriginPlane\s*\(\s*context\s*,\s*Plane\.YZ\s*\)/g, "plane(WORLD_ORIGIN, X_DIRECTION)");
  out = out.replace(/\bPlane\.XY\b/g, "plane(WORLD_ORIGIN, Z_DIRECTION)");
  out = out.replace(/\bPlane\.XZ\b/g, "plane(WORLD_ORIGIN, Y_DIRECTION)");
  out = out.replace(/\bPlane\.YZ\b/g, "plane(WORLD_ORIGIN, X_DIRECTION)");

  // ── Replace skPolygon (doesn't exist) with skRegularPolygon ──
  // Best-effort: convert skPolygon("id", {points:[...]}) shape to skRegularPolygon
  out = out.replace(/\bskPolygon\b/g, "skRegularPolygon");
  // skPolyline also doesn't exist — flag it (can't auto-fix safely)
  if (out.includes("skPolyline")) {
    console.warn("[AI] jsFix: skPolyline found — not a valid FeatureScript function");
  }

  // ── Fix wrong boolean op name ──
  out = out.replace(/BooleanOperationType\.SUBTRACT\b(?!ION)/g, "BooleanOperationType.SUBTRACTION");

  // ── Remove return statements in feature body ──
  out = out.replace(/\breturn\s+[^;{}]+;/g, "");

  // ── Double unit fix — run multiple passes to be thorough ──
  for (let i = 0; i < 3; i++) {
    out = out.replace(/(\*\s*inch)(\s*\*\s*inch)+/g, "$1");
    out = out.replace(/(\*\s*millimeter)(\s*\*\s*millimeter)+/g, "$1");
  }

  // ── Fix MISSING units on scalar dimension keys ──
  out = out.replace(
    /"(endDepth|startDepth|radius|width|depth|height|length)"\s*:\s*(\d+(?:\.\d+)?)\s*(?!\*)/g,
    (_, key, num) => `"${key}" : ${num} * inch`
  );

  // ── Remove isLength/isAngle/isBoolean that sneaked into the feature body ──
  out = out.replace(/^\s*(annotation\s*\{[^}]*\}\s*\n)?\s*is(Length|Angle|Boolean|Integer)\s*\([^)]+\)\s*;.*$/gm, "");

  // ── Remove definition.xxx references from the feature body
  //    (definition.face is OK — only strip other property accesses) ──
  out = out.replace(/\bdefinition\.(?!face\b)\w+\s*\/\s*2/g, "0.5 * inch");
  out = out.replace(/\bdefinition\.(?!face\b)\w+/g, "1 * inch");

  // ── Keep only the last export const if multiple exist ──
  const exportCount = (out.match(/\bexport const\b/g) || []).length;
  if (exportCount > 1) {
    console.warn(`[AI] jsFix: found ${exportCount} export const — keeping last`);
    const lastAnno = out.lastIndexOf('annotation { "Feature Type Name"');
    if (lastAnno > 0) {
      out = `FeatureScript 2931;\nimport(path : "onshape/std/geometry.fs", version : "2931.0");\n\n` + out.slice(lastAnno);
    }
  }

  return out;
}

// ─── Stage 4: AI reviewer ─────────────────────────────────────────────────────

async function reviewCode(code) {
  const prefixed = jsFix(code);

  const raw = await chat([
    {
      role: "system",
      content: `You are a strict FeatureScript linter. Fix ONLY the issues listed. Return ONLY raw FeatureScript.
No markdown. No backticks. No explanations. Do NOT rewrite or restructure working code.

══ WHAT NOT TO TOUCH ══
- Do NOT add * inch to a value that already has * inch  →  causes "* inch * inch" which is a FATAL error
- Do NOT remove the precondition block or definition.face
- Do NOT remove evPlane(context, { "face" : definition.face }) — this is correct
- Do NOT change working sketch geometry

══ FIX THESE IF PRESENT ══
1.  qOriginPlane(context, Plane.XY) → plane(WORLD_ORIGIN, Z_DIRECTION)
2.  Plane.XY / Plane.XZ / Plane.YZ → plane(WORLD_ORIGIN, Z/Y/X_DIRECTION)
3.  skPolygon or skPolyline used    → replace with skRegularPolygon or skLineSegment
4.  isLength/isAngle/isBoolean in feature body (not in precondition) → DELETE the line
5.  More than one export const      → DELETE all but the last
6.  return statement in body        → DELETE it
7.  Bare number: "endDepth" : 2     → "endDepth" : 2 * inch  (ONLY if not already * inch)
8.  "* inch * inch"                 → "* inch"  (remove the duplicate)
9.  Missing skSolve() before opExtrude → add it
10. BooleanOperationType.SUBTRACT   → BooleanOperationType.SUBTRACTION
11. definition.width / .height etc  → replace with 1 * inch  (but keep definition.face)
12. Missing precondition block      → add:
      precondition
      {
          annotation { "Name" : "Face", "Filter" : EntityType.FACE, "MaxNumberOfPicks" : 1 }
          definition.face is Query;
      }
`
    },
    { role: "user", content: prefixed }
  ], 0.0);

  const reviewed = stripFences(raw);
  if (!reviewed?.includes("FeatureScript")) {
    console.warn("[AI] Reviewer returned bad output — using jsFix version.");
    return prefixed;
  }

  // Run jsFix again on reviewer output to catch anything the reviewer broke
  return jsFix(reviewed);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateFeatureScript(prompt) {
  if (!process.env.GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");
  if (!prompt?.trim()) throw new Error("Empty prompt");

  console.log("[AI] Stage 1: Planning...");
  const plan = await planCad(prompt);
  console.log(`[AI] Plan: ${plan.summary}`);
  plan.operations?.forEach(op => console.log(`  Step ${op.step}: ${op.op} — ${op.description}`));

  console.log("[AI] Stage 2: Generating code...");
  const code = await generateCode(plan);

  console.log("[AI] Stage 3: Reviewing & fixing...");
  const final = await reviewCode(code);

  // ── Sanity checks ──
  if (final.includes("qOriginPlane"))
    console.error("[AI] ⚠ qOriginPlane still present!");
  if (/\bPlane\.[XYZ]{2}\b/.test(final))
    console.error("[AI] ⚠ Plane.XY/XZ/YZ still present!");
  if (/\*\s*inch\s*\*\s*inch/.test(final))
    console.error("[AI] ⚠ Double * inch still present!");
  if (/\bdefinition\.(?!face\b)\w+/.test(final))
    console.error("[AI] ⚠ definition.xxx (non-face) still present!");
  if (/\bskPolygon\b/.test(final))
    console.error("[AI] ⚠ skPolygon still present — this function does not exist!");
  if (/\bskPolyline\b/.test(final))
    console.error("[AI] ⚠ skPolyline still present — this function does not exist!");
  if (!final.includes("precondition"))
    console.error("[AI] ⚠ No precondition block — feature will fail to compile!");
  if (!final.includes("definition.face"))
    console.error("[AI] ⚠ definition.face missing — sketch plane will have no reference!");

  const exports = (final.match(/\bexport const\b/g) || []).length;
  if (exports !== 1) console.error(`[AI] ⚠ Expected 1 export const, found ${exports}`);

  console.log(`[AI] ✓ Final output: ${final.length} chars`);
  return final;
} after : 4/30:26

**5/2/26**
finally getting the AI to generate correct featureScript
The AI can finally generate basic 3d shapes however for more complex prompt it fails 
now since onshape connection is finished now it is all a prompt engineering and ML project from now on
Still modified design, this approach was calling API's key so I would just have to using render backend cappabliites to do this 
**Current plan**
ok so here is my desing plan right now, the feature leads to render link and then in that link id where the user puts the prompt probably in like onshape or something idk and then the server post out a json string with the featurescript that they want

**5/3/26**
Got a backend frontend and backend that is unblocked from MCPS technologies and can generate gears and other basic shapes into ones environemtns. It cna also analyize images.

Later this day the code wouldn't deploy 
**The fix**
The Render error is fixed. In ai.js there was a chunk of browser UI code accidentally pasted into the server module, and analyzeImage() ended up inside an unclosed function, which is why Node threw SyntaxError: Unexpected token 'export'.

I removed that frontend-only block from ai.js and restored analyzeImage() so it correctly delegates to analyzeImages(...). Both files now pass syntax checks:


node --check ai.js

node --check server.js


You should be able to redeploy to Render now.

**5/9/26**
After the APUSH exam, I successfully connected the backend and frontend to a database that the AI can access and learn from
**5/10/26**
FeatureScript Documentation Files — What They Reveal About Missing Rules
Reading all the FS docs (toplevel.md, syntaxand_semantics.md, types_and_tags.md, etc.) against the current codebase reveals specific gaps between what the docs say and what the AI system currently knows/enforces:
The Nested Function Problem (confirmed)
toplevel.md is explicit: "Functions may be declared inside other functions or initializers of top-level constants... Unlike top-level functions, lambdas are values." The key word is lambdas — anonymous functions with function keyword or => syntax assigned to variables. Named, typed top-level functions like function invPoint(t is number, rb is number) returns vector { } are only valid at module top-level. The tGear() template puts these inside the feature body, which is a lambda passed to defineFeature — illegal.
Lambda syntax IS valid inside feature bodies
What IS legal inside a feature body: const invPoint = function(t, rb) { ... }; or const invPoint = (t, rb) => ...;. The fix is to either hoist to top-level OR convert to const lambda declarations inside the body.
precondition rules the AI keeps breaking
UI.md is very specific: annotation { "Name": ..., "Default": "1 * inch" } must appear before the isLength(...) call. The AI sometimes swaps the order or writes definition.param is Length which UI.md confirms is not valid — the correct form is isLength(definition.param, LENGTH_BOUNDS).
isInteger behavior
UI.md says isInteger is a valid quantity predicate. The current preconditionInteger() function in AI.js correctly uses isInteger(definition.numTeeth) — that part is fine.
skSolve is required
modeling.md explicitly states: "The skSolve call is still necessary to generate sketch geometry." The current templates always call skSolve — good. But when the AI generates custom code it sometimes omits it. The CUSTOM_FEATURE_SYSTEM and DEBUG_SYSTEM prompts mention it but don't flag it as a fatal error.
Missing from hasFatalFeatureScriptPatterns()
Cross-referencing the docs, these patterns should also be detected as fatal:

Named typed functions inside a feature body (the gear bug)
Missing skSolve before opExtrude
return statements with values inside feature bodies (the docs say features return undefined)
* inch applied to a param already declared with isLength

imports.md — Unused capability
The docs show that Part Studio imports, CSV/JSON data imports, and reference parameters are all possible. The current system doesn't use any of these for more advanced generation strategies, but that's fine for now.

Summary of Everything Across Both Sessions
AreaStatusKey IssueGear template (tGear)BrokenHelper functions inside feature body — illegal FShasFatalFeatureScriptPatterns()IncompleteDoesn't catch nested named functions, missing skSolveCUSTOM_FEATURE_SYSTEM promptMissing ruleDoesn't forbid nested named functionsDEBUG_SYSTEM promptMissing ruleSame gapsanitizeFeatureScript()IncompleteCan't structurally fix nested functionsserver.js import of ai.jsBugCase mismatch — "./ai.js" vs actual AI.jsAll other templates (BOX, CYLINDER, etc.)GoodCorrectly structuredadaptiveNetwork.jsGoodSolid MLP with correct backproplearning.jsGoodRobust with graceful fallbacksserver.js routesGoodClean and completescript.jsGoodSolid frontend

**5/12/26**
Making notes on the many of the files, removing and redesigning things since the AI was use template instead of thinking how to code the Feature itself.

**5/15/26 Breakthrought**
There is other modeling LLM that I can reference my data base off of. Now all the thinking code is done, now it's all importing data. Changing AI models since groq have to little limits while deepseek has better thinking capabilites and better token usage. 

**5/17/26**
Groq model rotation is about to come out. We use mutipel request for one prompt to generate the best of the best FS.
**5/19/26**
Mutiple keys added like the program now uses mutiple keys



Overall structure or final result:
1. Make the AI rely on it's own thinking instead of using tempaltes and references
2. Instead of making a completely new AI, we can already use the Groq model's thinking and understanding for the AI model to make the cadding and user prompt understanding much lighter instead or coding key words or any shape descriptions since the AI already does that
3. Once the AI understands the user's prompt, the AI uses FS documenetation and it's own thinking models to make the featureScript that generates what the user's specificies
