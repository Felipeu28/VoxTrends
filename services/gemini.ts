
import { GoogleGenAI, Modality, Type } from "@google/genai";

export class VoxService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  async fetchTrendingNews(region: string = "Global", language: string = "English") {
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Research the top 5 trending news topics on X (Twitter) for: ${region}. 
        Focus on real-time social velocity. Language: ${language}.
        Provide verified facts and specific details for a podcast summary.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text || "No trending intelligence found.";
      const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        uri: chunk.web?.uri,
        title: chunk.web?.title
      })).filter((c: any) => c.uri) || [];
      
      return { text, grounding };
    } catch (error) {
      console.error("Gemini Search Error:", error);
      throw new Error("Intelligence feed unreachable. Retrying...");
    }
  }

  async generatePodcastScript(trends: string, language: string = "English", duration: string = "1 minute") {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Showrunner: 'VoxTrends'. Create a ${duration} podcast briefing for these trends: ${trends}.
      Language: ${language}.
      
      Hosts:
      - Joe: High-energy, charismatic main host.
      - Jane: Intelligent, analytical research expert.
      
      Format:
      Joe: [Welcome and hook]
      Jane: [Detailed analysis of trends]
      Joe: [Closing and sign-off]
      
      Output only the script text.`,
      config: { temperature: 0.8 }
    });
    return response.text;
  }

  async generateAudio(script: string) {
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
                { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
              ]
            }
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch (e) {
      console.error("TTS Synthesis Error:", e);
      return null;
    }
  }

  async generateCoverArt(topic: string) {
    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: `Futuristic podcast cover art for: ${topic}. Dark violet and cinematic lighting.` }],
      },
      config: {
        imageConfig: { aspectRatio: "16:9" }
      }
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
    }
    return null;
  }

  async generateFlashSummary(text: string, language: string = "English") {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `3 punchy bullet points summary of: ${text}. Language: ${language}.`,
    });
    return response.text;
  }

  async conductResearch(topic: string, intensity: string, target: string, region: string = "Global", language: string = "English") {
    const response = await this.ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `Perform high-intensity research on: "${topic}" in ${region}. Target Audience: ${target}. Language: ${language}. Provide a deep analysis.`,
      config: { tools: [{ googleSearch: {} }] }
    });
    
    const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
      uri: chunk.web?.uri,
      title: chunk.web?.title
    })).filter((c: any) => c.uri) || [];

    return { text: response.text || "No research findings available.", grounding };
  }

  async interrogate(context: string, question: string, history: any[], language: string = "English") {
    const chat = this.ai.chats.create({
      model: "gemini-3-flash-preview",
      config: {
        systemInstruction: `You are the Vox Intelligence Agent. Use context: ${context}. Language: ${language}.`,
      }
    });
    const response = await chat.sendMessage({ message: question });
    return response.text;
  }
}

export const voxService = new VoxService();

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64.replace(/[\n\r\t\s]/g, ''));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number = 24000, numChannels: number = 1): Promise<AudioBuffer> {
  const numSamples = Math.floor(data.byteLength / 2);
  const frameCount = numSamples / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      const byteIndex = (i * numChannels + channel) * 2;
      if (byteIndex + 1 < data.byteLength) {
        const sample = view.getInt16(byteIndex, true);
        channelData[i] = sample / 32768.0;
      }
    }
  }
  return buffer;
}
