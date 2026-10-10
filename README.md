<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c045ad8a-86b0-4e20-8736-007d8402468f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Optional — only the Gemini 3.8 panel (Art Director, Agent, Optimizer) needs a
   Gemini API key (free at https://aistudio.google.com/apikey). Paste it in the
   Gemini 3.8 panel, or put `GEMINI_API_KEY` in [.env.local](.env.local) (see
   `.env.example`). Without a key the AI modes are simply locked; every non-AI
   feature works without one.
3. Run the app:
   `npm run dev`
