
import { GoogleGenAI } from 'https://esm.sh/@google/genai@1.35.0';

export class GeminiService {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async fetchTrendingNews(region: string, language: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Research the top 5 trending news topics on X (Twitter) for: ${region}. 
        Focus on real-time social velocity. Language: ${language}.
        Provide verified facts and specific details for a podcast summary.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text || 'No trending intelligence found.';
      const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        uri: chunk.web?.uri,
        title: chunk.web?.title,
      })).filter((c: any) => c.uri) || [];

      return { text, grounding };
    } catch (error) {
      console.error('Gemini Search Error:', error);
      throw new Error('Intelligence feed unreachable. Retrying...');
    }
  }

  async generatePodcastScript(trends: string, language: string, duration: string = '1 minute') {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-pro-preview',
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
        config: { temperature: 0.8 },
      });
      return response.text;
    } catch (error) {
      console.error('Script Gen Error:', error);
      throw error;
    }
  }

  async generateAudio(script: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text: script }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                { speaker: 'Joe', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                { speaker: 'Jane', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
              ],
            },
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (error) {
      console.error('TTS Synthesis Error:', error);
      return null;
    }
  }

  async generateCoverArt(topic: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `Futuristic podcast cover art for: ${topic}. Dark violet and cinematic lighting.` }],
        },
        config: {
          imageConfig: { aspectRatio: '16:9' },
        },
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
      }
    } catch (error) {
      console.error('Image Gen Error:', error);
    }
    return null;
  }

  async generateFlashSummary(text: string, language: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `3 punchy bullet points summary of: ${text}. Language: ${language}.`,
      });
      return response.text;
    } catch (error) {
      console.error('Summary Gen Error:', error);
      return '';
    }
  }

  async conductResearch(topic: string, region: string, language: string) {
    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Perform high-intensity research on: "${topic}" in ${region}. Language: ${language}. Provide a deep analysis.`,
        config: { tools: [{ googleSearch: {} }] },
      });

      const grounding = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        uri: chunk.web?.uri,
        title: chunk.web?.title,
      })).filter((c: any) => c.uri) || [];

      return { text: response.text || 'No research findings available.', grounding };
    } catch (error) {
      console.error('Research Error:', error);
      throw error;
    }
  }
}
