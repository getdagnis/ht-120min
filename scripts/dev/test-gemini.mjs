import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const response = await ai.models.generateContent({
  model: "gemini-3.8-flash",
  contents: "Reply with exactly: HT-120min Gemini works.",
  config: {
    thinkingConfig: {
      thinkingLevel: "low",
    },
  },
});

console.log(response.text);
