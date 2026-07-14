import express from "express";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Google Gen AI with named key configuration and proper telemetry headers
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// AI Oracle endpoint for multi-turn conversational intelligence
app.post("/api/gemini/chat", async (req, res) => {
  const { message, history, currentConfig } = req.body;
  const activeModuleId = currentConfig?.activeModule || "BLOB";

  try {
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Build model prompt context incorporating current active module and visual signal parameters
    const systemInstruction = `You are the VFX Syntech AI Vault Oracle, an intelligence node embedded in an Obsidian Constellation Vault. You have supreme expertise in high-fidelity digital and analog visual effects synthesis, frequency spectrum dynamics, and generative particles.

Your design matches the elegant, premium Obsidian gold-and-black aesthetic. 

When the user queries, you must help them:
1. Customize and optimize visual effect parameters (Vertex Displacement, CRT Emulation, Quantum Gravity, Input Sensitivity, etc.).
2. Generate creative presets or mathematical visual concepts.
3. Understand connections in the Obsidian graph.

CURRENT LIVE VFX CONFIGURATION:
- Active Module: ${activeModuleId}
- Signal Source: ${currentConfig?.signalSource || "unknown"}
- Buffer Size: ${currentConfig?.bufferSize || "unknown"}
- Parameters: ${JSON.stringify(currentConfig?.parameters || {})}

FORMAT RULES:
- Use elegant, clean markdown.
- Maintain a high-tech, precise scientific, slightly poetic tone.
- Keep responses concise, scannable, and highly relevant.
- IMPORTANT: If you suggest changes to parameters, format them nicely. If you suggest specific values for the current active module, you can optionally include a line with JSON formatting like: \`PRESET:{"threshold":96,"datamosh":18}\` using ONLY keys that exist in the Parameters listed above, so the user can apply them instantly. Each parameter entry includes its own "min"/"max" range and a "hint" describing what it controls — every value you suggest MUST lie within that parameter's range (ranges differ per parameter), and parameters hinted as "(on/off switch)" accept only 0 or 1.`;

    // Map message history to standard GenAI parts format
    const formattedContents = [
      ...(history || []).map((msg: any) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
      })),
      {
        role: "user",
        parts: [{ text: message }]
      }
    ];

    // Generate response using gemini-3.5-flash
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction,
        temperature: 0.75,
      }
    });

    const replyText = response.text || "I was unable to retrieve a response from the neural nodes.";
    
    // Check if replyText contains a parameter preset suggestion
    let presetMatch = replyText.match(/PRESET:({.*?})/);
    let extractedPreset = null;
    if (presetMatch) {
      try {
        extractedPreset = JSON.parse(presetMatch[1]);
      } catch (err) {
        // ignore malformed suggestion JSON
      }
    }

    res.json({
      reply: replyText,
      preset: extractedPreset
    });

  } catch (error: any) {
    // Elegant local fallback sequence when upstream is busy, rate-limited, or unconfigured
    
    // Create intelligent offline responses when the API is overloaded/503/key is missing
    let fallbackReply = "The primary Gemini cognitive stream is currently experiencing high request queues or is temporarily unavailable. Local Obsidian Vault archives remain active.\n\n";
    let extractedPreset: any = null;

    if (activeModuleId === "blob_tracker") {
      fallbackReply += "As requested, local sensors suggest a dramatic organic tracking look: **Threshold** at 96 for wide blob coverage, **Datamosh** at 18 with **Glitch** at 12 for digital decay, and **Line Glow** at 65 for luminous connections.\n\nPRESET:{\"threshold\":96,\"datamosh\":18,\"glitch\":12,\"connGlow\":65,\"fxOpacity\":100}";
      extractedPreset = { threshold: 96, datamosh: 18, glitch: 12, connGlow: 65, fxOpacity: 100 };
    } else if (activeModuleId === "analog") {
      fallbackReply += "Local scanlines report an optimal retro calibration: **Tear** at 0.5 with **Chroma** at 0.45 for VHS distortion, **Scanlines** at 0.65 and **Bloom** at 0.4 for phosphor warmth.\n\nPRESET:{\"tearAmt\":0.5,\"chromaAmt\":0.45,\"noiseAmt\":0.3,\"scanlinesAmt\":0.65,\"bloomAmt\":0.4,\"feedbackAmt\":0.35}";
      extractedPreset = { tearAmt: 0.5, chromaAmt: 0.45, noiseAmt: 0.3, scanlinesAmt: 0.65, bloomAmt: 0.4, feedbackAmt: 0.35 };
    } else if (activeModuleId === "blob_reveal") {
      fallbackReply += "Local sensors suggest a cinematic reveal matrix: **Seg Threshold** at 55 with **Feather** at 12 for soft rotoscope edges, and **Audio Expand** at 40 to make the mask pulse with the music.\n\nPRESET:{\"segThreshold\":55,\"feather\":12,\"opacity\":90,\"audioExpand\":40}";
      extractedPreset = { segThreshold: 55, feather: 12, opacity: 90, audioExpand: 40 };
    } else if (activeModuleId === "bokeh") {
      fallbackReply += "Local lens calculations recommend heavy background blur aesthetics: **Bokeh Radius** at 32 with **Bloom** at 1.8, plus a 1.6x **Anamorphic Squeeze** for cinematic ovals.\n\nPRESET:{\"bokehRadius\":32,\"bokehBloom\":1.8,\"bokehFeather\":0.55,\"anamSqueeze\":1.6}";
      extractedPreset = { bokehRadius: 32, bokehBloom: 1.8, bokehFeather: 0.55, anamSqueeze: 1.6 };
    } else {
      fallbackReply += "Anamorphic Lab local calculations suggest majestic horizontal flares: **Flare Amount** at 0.85 with **Flare Length** at 0.9, plus **Halation** at 0.6 for film glow.\n\nPRESET:{\"flareMaster\":1,\"flareAmt\":0.85,\"flareLength\":0.9,\"halation\":0.6,\"squeeze\":1.6}";
      extractedPreset = { flareMaster: 1, flareAmt: 0.85, flareLength: 0.9, halation: 0.6, squeeze: 1.6 };
    }

    res.json({
      reply: fallbackReply,
      preset: extractedPreset,
      isFallback: true,
      info: "Loaded vault offline archives due to upstream API limits."
    });
  }
});
// Gemini Intelligence Agent endpoint
app.post("/api/gemini/agent", async (req, res) => {
  const { prompt, history, currentConfig, compEffects } = req.body;
  try {
    let systemInstruction = `You are the VFX Syntech Agent, an autonomous workflow assistant.
Your job is to read the user request and modify the active Nodal Composition (the graph of effects).
The current graph has these nodes enabled: ${JSON.stringify(compEffects)}.
Available node IDs are: "blob_tracker", "analog", "blob_reveal", "bokeh", "anamorphic_lab".
Return a JSON object with a list of nodes to ENABLE and nodes to DISABLE to achieve the user request.
Example: {"enable": ["analog", "blob_tracker"], "disable": ["bokeh"]}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction,
        
        responseMimeType: "application/json"
      }
    });
    const replyText = response.text?.trim() || "{}";
    const cleanedJson = replyText.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(cleanedJson);
    res.json({ result, message: "Applied automated workflow edits based on your request." });
  } catch (error: any) {
    res.json({ result: {}, message: "Agent encountered a local sensor error.", isFallback: true });
  }
});

// Gemini Intelligence Video Analyzer endpoint
app.post("/api/gemini/analyze-video", async (req, res) => {
  const { videoName } = req.body;
  try {
    let systemInstruction = `You are a video analysis AI. The user has uploaded or selected a video named "${videoName}". 
Provide a brief, high-level analysis of what you detect in this type of video and how the active Nodal Composition could be optimized for it.`;
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: "Analyze the video context." }] }],
      config: {
        systemInstruction,
      }
    });
    res.json({ analysis: response.text?.trim() });
  } catch (error: any) {
    res.json({ analysis: "Offline telemetry: Action sequence detected. Optimize buffer speeds.", isFallback: true });
  }
});


// Gemini Intelligence Parameter Optimizer endpoint
app.post("/api/gemini/optimize", async (req, res) => {
  const { activeModule, parameters, prompt } = req.body;
  
  try {
    let systemInstruction = `You are the VFX Syntech Gemini Optimizer.
Your job is to analyze the active module and its parameters, and return a set of optimized parameter values that would make the visuals extremely high-fidelity, dramatic, and aesthetically stunning.

Return ONLY a valid JSON object mapping parameter keys (exactly as given in CURRENT PARAMETERS) to their recommended numeric values. Do not write any other text, markdown, or code blocks. Just the raw JSON.

CRITICAL RULES:
- Each parameter entry in CURRENT PARAMETERS includes its own "min", "max" and "step"; every value you return MUST lie within that parameter's [min, max] range. Ranges differ per parameter — they are NOT all 0-100.
- Parameters whose hint says "(on/off switch)" accept only 0 or 1.
- Use each parameter's "hint" field to understand what it controls.
- Only include keys you want to change; omit the rest.

Example shape of a valid answer: {"threshold":96,"datamosh":18,"fxInvert":1}

ACTIVE MODULE: ${activeModule}
CURRENT PARAMETERS: ${JSON.stringify(parameters)}`;

    if (prompt && prompt.trim()) {
      systemInstruction += `\n\nCRITICAL USER DIRECTION: The operator has requested the following visual theme/guideline: "${prompt}". You MUST calibrate the parameters strictly to match this style.`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [{ role: "user", parts: [{ text: "Generate the optimized parameter JSON" }] }],
      config: {
        systemInstruction,
        temperature: 0.4,
        responseMimeType: "application/json"
      }
    });

    const replyText = response.text?.trim() || "{}";
    const cleanedJson = replyText.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(cleanedJson);

    res.json({ preset: result });
  } catch (error: any) {
    // Mathematical local fallback calibration when upstream is busy, rate-limited, or unconfigured
    
    // Provide beautifully optimized fallback defaults so the button still works instantly
    let fallbackPreset: Record<string, number> = {};
    if (activeModule === "blob_tracker") {
      fallbackPreset = { threshold: 96, datamosh: 18, glitch: 12, connGlow: 65, fxOpacity: 100 };
    } else if (activeModule === "analog") {
      fallbackPreset = { tearAmt: 0.5, chromaAmt: 0.45, noiseAmt: 0.3, scanlinesAmt: 0.65, bloomAmt: 0.4, feedbackAmt: 0.35 };
    } else if (activeModule === "blob_reveal") {
      fallbackPreset = { segThreshold: 55, feather: 12, opacity: 90, audioExpand: 40 };
    } else if (activeModule === "bokeh") {
      fallbackPreset = { bokehRadius: 32, bokehBloom: 1.8, bokehFeather: 0.55, anamSqueeze: 1.6 };
    } else {
      fallbackPreset = { flareMaster: 1, flareAmt: 0.85, flareLength: 0.9, halation: 0.6, squeeze: 1.6 };
    }

    res.json({ 
      preset: fallbackPreset,
      isFallback: true,
      message: "Upstream busy. Loaded mathematical vault optimal presets."
    });
  }
});

// Gemini Intelligence live aesthetic analyzer critique endpoint
app.post("/api/gemini/analyze", async (req, res) => {
  const { activeModule, parameters, prompt } = req.body;

  try {
    let systemInstruction = `You are the VFX Syntech AI Art Director.
Generate a highly atmospheric, sci-fi poetic, and technically advanced 2-sentence aesthetic analysis or design inspiration for the current active VFX module "${activeModule}" with parameters ${JSON.stringify(parameters)}.
Describe what the wave forms and particles are expressing. Keep it elegant, dramatic, under 45 words, and strictly relevant. No greetings or meta text.`;

    if (prompt && prompt.trim()) {
      systemInstruction += `\n\nUSER DIRECTION / FOCUS: The operator has requested you to focus on or incorporate the following idea: "${prompt}". Tailor your aesthetic analysis or design inspiration around this context.`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [{ role: "user", parts: [{ text: "Perform live canvas aesthetic critique" }] }],
      config: {
        systemInstruction,
        temperature: 0.85,
      }
    });

    res.json({ analysis: response.text?.trim() || "Obsidian nodes align. The stream spectrum is clean." });
  } catch (error: any) {
    // Sci-fi aesthetic backup telemetry generator when upstream is busy, rate-limited, or unconfigured

    // Provide pre-designed beautiful sci-fi critiques specific to the active module
    let fallbackAnalysis = "Obsidian nodes detect active force fields. Visual resonance aligns within high-fidelity tolerances.";
    
    if (activeModule === "blob_tracker") {
      fallbackAnalysis = "Resonant amorphous particles expand outwards, translating dynamic sound pressure waves into beautiful fluid membranes.";
    } else if (activeModule === "analog") {
      fallbackAnalysis = "Phosphor scanlines trace retro waveforms. Minor clock deviations form elegant noise fields with warm chromatic refractions.";
    } else if (activeModule === "blob_reveal") {
      fallbackAnalysis = "A soft negative luminance mask gradually expands outward, peeling back layer after layer of glowing digital blueprints.";
    } else if (activeModule === "bokeh") {
      fallbackAnalysis = "A heavy circular lens aberration field scatters the background nodes, forming beautiful out-of-focus overlapping disks.";
    } else if (activeModule === "anamorphic_lab") {
      fallbackAnalysis = "A majestic horizontal streak projection expands across the ultra-wide lens boundary, creating elegant cinematic flares.";
    }

    res.json({ 
      analysis: fallbackAnalysis,
      isFallback: true,
      message: "Showing local sensor telemetry."
    });
  }
});

// Configure Vite middleware or static route handling depending on production state
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    // Effect builds are self-contained static apps: serve them ahead of the
    // Vite pipeline, which blocks public assets requested as <script src>
    app.use("/effects", express.static(path.join(process.cwd(), "public/effects")));
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on port ${PORT} // Full-stack core ready.`);
  });
};

startServer();
