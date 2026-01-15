
export interface User {
  name: string;
  email: string;
  avatar: string;
  plan: 'Pro' | 'Free';
  memberSince: string;
  region: string;
  language: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface SavedClip {
  id: string;
  title: string;
  date: string;
  type: 'Daily' | 'Research';
  audioData?: string | null;
  text: string;
  intensity?: string;
  imageUrl?: string | null;
  chatHistory?: ChatMessage[];
  flashSummary?: string;
}

export interface GroundingLink {
  uri: string;
  title: string;
}

export interface ResearchDossier {
  title: string;
  summary: string;
  keyPoints: string[];
  links: GroundingLink[];
  fullAnalysis: string;
}

export enum EditionType {
  MORNING = 'Morning',
  MIDDAY = 'Midday',
  EVENING = 'Evening'
}
