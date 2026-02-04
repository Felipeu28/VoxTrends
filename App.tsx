import React, { useState, useEffect, useRef } from 'react';
import { voxService, decodeBase64, decodeAudioData } from './services/gemini';
import { voxDB } from './services/db';
import { auth } from './services/auth';
import { db } from './services/database';
import { storage } from './services/storage';
import { ICONS, COLORS } from './constants';
import { EditionType, User, SavedClip, GroundingLink, ChatMessage } from './types';
import AudioVisualizer from './components/AudioVisualizer';
import { translations } from './translations';
import LoginScreen from './components/auth/LoginScreen';
import SignupScreen from './components/auth/SignupScreen';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { backend } from './services/backend';
import QuotaDisplay from './components/QuotaDisplay';
import UpgradeModal from './components/UpgradeModal';
import PricingPage from './components/PricingPage';
import VoiceSelector from './components/VoiceSelector';
import BroadcastTuner from './components/BroadcastTuner';

interface DailyData {
  text: string;
  script: string;
  audio: string | null;
  links: GroundingLink[];
  imageUrl: string | null;
  flashSummary?: string;
  chatHistory?: ChatMessage[];
  date?: string; // Added date for daily reset check
  // Phase 3: Voice Variants
  edition_id?: string;
  scriptReady?: boolean;
  voiceVariantsAvailable?: string[];
  voiceVariantsGeneratedCount?: number;
}

// Convert base64 audio to blob URL for playback
const createAudioBlobUrl = (base64Audio: string): string => {
  try {
    // Detect MIME type from data URL prefix, default to wav
    let mimeType = 'audio/wav';
    let base64 = base64Audio;

    if (base64Audio.includes(',')) {
      const parts = base64Audio.split(',');
      const prefix = parts[0];
      base64 = parts[1];

      // Extract MIME type from prefix like "data:audio/wav;base64"
      const mimeMatch = prefix.match(/data:([^;]+)/);
      if (mimeMatch) {
        mimeType = mimeMatch[1];
      }
    }

    // Decode base64
    const binaryString = atob(base64.replace(/[\n\r\t\s]/g, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create Blob with detected MIME type
    const blob = new Blob([bytes], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('Failed to create audio blob:', error);
    return '';
  }
};

const VOX_EDITIONS_KEY = 'vox_daily_editions_v3'; // Incremented for new structure

// Helper function to create unique edition keys
const getEditionKey = (type: EditionType, region: string, language: string) =>
  `${type}-${region}-${language}`;

// ==================== HELPER COMPONENTS ====================

const RichText: React.FC<{ text: string; language: string }> = ({ text, language }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-4 md:space-y-6">
      {lines.map((line, i) => {
        if (!line.trim()) return null;
        const isHeader = line.startsWith('#') || (line.toUpperCase() === line && line.length > 5 && !line.includes(':'));
        if (isHeader) {
          return (
            <h4 key={i} className="text-xl md:text-3xl font-serif font-bold text-white tracking-tight border-l-4 border-violet-600 pl-4 md:pl-6 my-6 md:my-10 animate-in slide-in-from-left">
              {line.replace(/#/g, '').trim()}
            </h4>
          );
        }

        // Handle bold text (**)
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <p key={i} className="text-base md:text-xl font-light leading-relaxed text-zinc-300 opacity-90">
            {parts.map((part, index) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={index} className="font-bold text-white">{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
};

const Toast: React.FC<{ message: string; visible: boolean; onHide: () => void }> = ({ message, visible, onHide }) => {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(onHide, 3500);
      return () => clearTimeout(timer);
    }
  }, [visible, onHide]);

  if (!visible) return null;

  return (
    <div translate="no" className="fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 bg-violet-600 text-white px-8 py-4 rounded-2xl shadow-2xl z-[100] font-bold text-sm animate-in slide-in-from-bottom duration-300 flex items-center gap-3">
      {message}
    </div>
  );
};

// Enhanced Audio Player Component
// Enhanced Audio Player Component - Handles both URLs and base64
const AudioPlayer: React.FC<{
  audioData: string | null;
  clipId: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onEnded?: () => void;
}> = ({ audioData, clipId, isPlaying, onPlayPause, onEnded }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!audioData) return;
    if (audioData.startsWith('http')) {
      setAudioSrc(audioData);
    } else {
      const blobUrl = createAudioBlobUrl(audioData);
      setAudioSrc(blobUrl);
      return () => URL.revokeObjectURL(blobUrl);
    }
  }, [audioData]);

  useEffect(() => {
    if (audioRef.current && audioSrc) {
      if (isPlaying) {
        audioRef.current.play().catch(err => console.error('Playback error:', err));
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying, audioSrc]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  if (!audioSrc) return null;

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3.5 w-full max-w-xs">
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        onEnded={onEnded}
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
      />
      <button
        onClick={onPlayPause}
        className="w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-md hover:scale-105 transition-all text-black flex-shrink-0"
      >
        {isPlaying ? <ICONS.Pause className="w-3.5 h-3.5" /> : <ICONS.Play className="w-3.5 h-3.5 ml-0.5" />}
      </button>
      <div className="flex-1 space-y-1.5 min-w-0">
        <div
          className="w-full h-1 bg-zinc-800 rounded-full cursor-pointer group"
          onClick={handleSeek}
        >
          <div className="h-full bg-violet-600 rounded-full relative" style={{ width: `${progress}%` }}>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-zinc-600 font-mono">
          <span>{fmt(currentTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
};

// Progress Bar Component
const ProgressBar: React.FC<{
  loading: boolean;
  status: string;
  estimatedDuration?: number;
}> = ({ loading, status, estimatedDuration = 25000 }) => {
  const [progress, setProgress] = useState(0); //

  useEffect(() => {
    if (!loading) {
      setProgress(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min(95, (elapsed / estimatedDuration) * 100);
      setProgress(newProgress);
    }, 100);

    return () => clearInterval(interval);
  }, [loading, estimatedDuration]);

  if (!loading) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-zinc-950/95 backdrop-blur-xl border-b border-violet-600/30">
      <div className="h-1 bg-zinc-900 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-violet-600 to-purple-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border-3 border-violet-600 border-t-transparent rounded-full animate-spin" />
          <p translate="no" className="text-sm font-mono text-violet-400">{status}</p>
        </div>
        <p translate="no" className="text-xs text-zinc-600">{Math.round(progress)}%</p>
      </div>
    </div>
  );
};

// Expandable Research Display
const ResearchDisplay: React.FC<{
  result: { text: string; grounding: GroundingLink[] };
  language: string;
}> = ({ result, language }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-6">
      <h4 className="text-2xl font-serif font-bold">Research Dossier</h4>

      <div className={`text-sm text-zinc-400 border-l border-zinc-800 pl-4 italic ${expanded ? '' : 'line-clamp-10'}`}>
        <RichText text={result.text} language={language} />
      </div>

      {result.text.split('\n').length > 10 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-violet-400 hover:text-violet-300 text-sm font-bold"
        >
          {expanded ? 'â†‘ Show Less' : 'â†“ Show More'}
        </button>
      )}

      {result.grounding && result.grounding.length > 0 && (
        <div className="space-y-3">
          <h5 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Verified Sources</h5>
          <div className="space-y-2">
            {result.grounding.map((link, i) => (
              <a
                key={i}
                href={link.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-violet-600/50 transition-all group"
              >
                <p className="text-xs font-bold text-white group-hover:text-violet-400 truncate">{link.title}</p>
                <p className="text-[10px] text-zinc-600 truncate">{link.uri}</p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Auto-Scrolling Chat Component with Mobile-Optimized Collapsible Design
const InterrogationHub: React.FC<{
  context: string;
  language: string;
  history: ChatMessage[];
  setHistory: (h: ChatMessage[]) => void;
}> = ({ context, language, history, setHistory }) => {
  const t = translations[language as keyof typeof translations] || translations.English;
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [collapsed, setCollapsed] = useState(true); // Start collapsed on mobile
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const speechLang = language === 'Spanish' ? 'es-ES' : 'en-US';

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const rec = new SpeechRecognition();
    rec.lang = speechLang;
    rec.interimResults = false;
    rec.onstart = () => setListening(true);
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setQuestion(transcript);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  useEffect(() => {
    if (!collapsed && history.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, collapsed]);

  const handleAsk = async () => {
    if (!question.trim()) return;

    // Auto-expand when user asks first question
    if (collapsed) setCollapsed(false);

    setThinking(true);
    const q = question;
    setQuestion('');
    setHistory([...history, { role: 'user', text: q }]);

    try {
      const result = await backend.askQuestion(context, q, history, language);
      setHistory([...history, { role: 'user', text: q }, { role: 'model', text: result }]);
    } catch (error) {
      console.error('Interrogation error:', error);
      setHistory([...history, { role: 'user', text: q }, { role: 'model', text: 'Unable to process inquiry. Please try again.' }]);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="mt-8 md:mt-12 border-t-2 border-violet-600/30 pt-8 md:pt-12 space-y-6 md:space-y-8 pb-10 bg-zinc-950/30 rounded-3xl px-4 md:px-8 -mx-4 md:-mx-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-violet-600 rounded-xl flex items-center justify-center">
            <ICONS.Podcast className="w-5 h-5 md:w-6 md:h-6 text-white" />
          </div>
          <div>
            <h4 className="text-lg md:text-xl font-serif font-bold text-white">Ask Questions</h4>
            <p className="text-xs text-zinc-500">Get deeper insights about this news</p>
          </div>
        </div>
        {history.length > 0 && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 bg-zinc-900 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={collapsed ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
            </svg>
          </button>
        )}
      </div>

      {(!collapsed || history.length === 0) && (
        <>
          {/* Chat History */}
          {history.length > 0 && (
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {history.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 md:p-6 rounded-2xl md:rounded-3xl ${m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-zinc-900 border border-zinc-800'}`}>
                    <RichText text={m.text} language={language} />
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="text-xs text-violet-500 font-mono animate-pulse flex items-center gap-2">
                  <div className="w-2 h-2 bg-violet-500 rounded-full animate-bounce" />
                  Thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Input Field */}
          <div className="relative">
            <input
              type="text"
              placeholder={listening ? (language === 'Spanish' ? 'Escuchando...' : 'Listening...') : 'Ask anything about this news...'}
              className={`w-full bg-zinc-900 border rounded-2xl py-4 md:py-6 px-4 md:px-8 pr-28 md:pr-36 text-base md:text-lg focus:outline-none transition-colors ${listening ? 'border-violet-600 animate-pulse' : 'border-zinc-800 focus:border-violet-600'}`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAsk()}
            />
            <div className="absolute right-2 top-2 bottom-2 flex items-center gap-1.5">
              <button
                onClick={listening ? stopListening : startListening}
                disabled={thinking}
                className={`px-3 h-full rounded-xl flex items-center justify-center transition-all disabled:opacity-40 ${listening ? 'bg-red-600 hover:bg-red-700' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
                title={listening ? 'Stop' : 'Ask with voice'}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  {listening ? (
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="white" />
                  ) : (
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
                  )}
                </svg>
              </button>
              <button
                onClick={handleAsk}
                disabled={thinking || !question.trim()}
                className="px-4 md:px-6 h-full bg-violet-600 text-white rounded-xl font-black text-sm md:text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-violet-700 transition-all"
              >
                ASK
              </button>
            </div>
          </div>
        </>
      )}

      {/* Collapsed State - Show Badge */}
      {collapsed && history.length > 0 && (
        <div className="flex items-center justify-between p-4 bg-zinc-900 rounded-xl border border-zinc-800">
          <span className="text-sm text-zinc-400">{history.length} message{history.length > 1 ? 's' : ''} in conversation</span>
          <button
            onClick={() => setCollapsed(false)}
            className="text-sm font-bold text-violet-400 hover:text-violet-300"
          >
            Show Conversation â†’
          </button>
        </div>
      )}
    </div>
  );
};

// Share Modal Component
// Enhanced Share Modal with Beautiful PDF Export
const ShareModal: React.FC<{
  clip: { title: string; imageUrl: string | null; audio: string | null; text: string };
  language: string;
  onClose: () => void;
}> = ({ clip, language, onClose }) => {
  const t = translations[language as keyof typeof translations] || translations.English;

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to export PDF');
      return;
    }

    // Create beautiful HTML for PDF
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${clip.title} - VoxTrends Intelligence Report</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Playfair+Display:wght@700&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      line-height: 1.8;
      color: #1a1a1a;
      background: #ffffff;
      padding: 60px 80px;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      border-bottom: 4px solid #8B5CF6;
      padding-bottom: 30px;
      margin-bottom: 50px;
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    
    .logo-icon {
      width: 40px;
      height: 40px;
      background: #8B5CF6;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
      font-size: 20px;
    }
    
    .logo-text {
      font-family: 'Playfair Display', serif;
      font-size: 28px;
      font-weight: 700;
      color: #8B5CF6;
    }
    
    .report-type {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #6B7280;
      margin-bottom: 10px;
    }
    
    h1 {
      font-family: 'Playfair Display', serif;
      font-size: 42px;
      font-weight: 700;
      color: #111827;
      line-height: 1.2;
      margin-bottom: 20px;
    }
    
    .meta {
      display: flex;
      gap: 30px;
      font-size: 13px;
      color: #6B7280;
      margin-top: 20px;
    }
    
    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .meta-label {
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .cover-image {
      width: 100%;
      max-height: 500px;
      object-fit: cover;
      border-radius: 20px;
      margin: 40px 0;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.1);
    }
    
    .content {
      font-size: 16px;
      line-height: 1.9;
      color: #374151;
    }
    
    .content p {
      margin-bottom: 24px;
    }
    
    .content h2,
    .content h3,
    .content h4 {
      font-family: 'Playfair Display', serif;
      color: #111827;
      margin: 40px 0 20px 0;
      padding-left: 20px;
      border-left: 4px solid #8B5CF6;
    }
    
    .content h2 {
      font-size: 32px;
      margin-top: 60px;
    }
    
    .content h3 {
      font-size: 26px;
    }
    
    .content h4 {
      font-size: 20px;
    }
    
    .footer {
      margin-top: 80px;
      padding-top: 40px;
      border-top: 2px solid #E5E7EB;
      text-align: center;
      color: #9CA3AF;
      font-size: 12px;
    }
    
    .footer-logo {
      font-family: 'Playfair Display', serif;
      font-weight: 700;
      color: #8B5CF6;
      font-size: 16px;
      margin-bottom: 10px;
    }
    
    @media print {
      body {
        padding: 40px;
      }
      
      .cover-image {
        page-break-before: always;
        page-break-after: always;
      }
      
      .content h2 {
        page-break-after: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-icon">V</div>
      <div class="logo-text">VoxTrends</div>
    </div>
    
    <div class="report-type">Intelligence Report</div>
    <h1>${clip.title}</h1>
    
    <div class="meta">
      <div class="meta-item">
        <span class="meta-label">Generated:</span>
        <span>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Type:</span>
        <span>VoxTrends AI Analysis</span>
      </div>
    </div>
  </div>
  
  ${clip.imageUrl ? `<img src="${clip.imageUrl}" alt="Cover Image" class="cover-image" />` : ''}
  
  <div class="content">
    ${clip.text.split('\n\n').map(para => {
      if (para.startsWith('#')) {
        const level = para.match(/^#+/)?.[0].length || 2;
        const text = para.replace(/^#+\s*/, '');
        return `<h${level}>${text}</h${level}>`;
      }
      return `<p>${para}</p>`;
    }).join('')}
  </div>
  
  <div class="footer">
    <div class="footer-logo">VoxTrends</div>
    <p>This report was generated by VoxTrends AI Intelligence Platform</p>
    <p>Â© ${new Date().getFullYear()} VoxTrends. All rights reserved.</p>
  </div>
</body>
</html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Wait for content to load, then trigger print
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl animate-in fade-in">
      <div className="w-full max-w-5xl bg-zinc-950 border border-zinc-900 rounded-[3rem] overflow-hidden flex flex-col md:flex-row shadow-[0_0_100px_rgba(139,92,246,0.1)] relative max-h-[90vh]">
        <button
          onClick={onClose}
          className="absolute top-8 right-8 text-zinc-500 hover:text-white z-20"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="w-full md:w-1/2 p-12 bg-zinc-900/20 flex flex-col gap-8 justify-center items-center text-center">
          <div className="w-full aspect-video rounded-3xl overflow-hidden shadow-2xl border border-zinc-800 relative">
            {clip.imageUrl && <img src={clip.imageUrl} className="w-full h-full object-cover" alt={clip.title} />}
          </div>
          <h4 className="text-3xl font-serif font-bold text-white">{clip.title}</h4>
        </div>

        <div className="w-full md:w-1/2 p-12 flex flex-col justify-center gap-6">
          <button
            onClick={handleExportPDF}
            className="w-full p-8 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-violet-600 transition-all text-left flex items-center gap-6 group"
          >
            <div className="w-16 h-16 bg-zinc-950 rounded-2xl flex items-center justify-center text-violet-500 group-hover:bg-violet-600 group-hover:text-white transition-all">
              <ICONS.FileText className="w-8 h-8" />
            </div>
            <div>
              <p className="text-xl font-bold text-white group-hover:text-violet-400 transition-colors">{t.exportPDF}</p>
              <p className="text-sm text-zinc-600">Professional intelligence report with branding</p>
            </div>
          </button>

          <button
            onClick={() => {
              navigator.clipboard.writeText(clip.text);
              alert('Content copied to clipboard!');
            }}
            className="w-full p-8 bg-zinc-900 border border-zinc-800 rounded-3xl hover:border-emerald-600 transition-all text-left flex items-center gap-6 group"
          >
            <div className="w-16 h-16 bg-zinc-950 rounded-2xl flex items-center justify-center text-emerald-500 group-hover:bg-emerald-600 group-hover:text-white transition-all">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <p className="text-xl font-bold text-white group-hover:text-emerald-400 transition-colors">Copy Text</p>
              <p className="text-sm text-zinc-600">Copy all content to clipboard</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
// ==================== LANDING PAGE ====================
const LandingPage: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  const bars = Array.from({ length: 80 }, (_, i) => {
    const w1 = Math.sin(i * Math.PI / 20) * 0.5 + 0.5;
    const w2 = Math.sin(i * Math.PI / 8 + 1) * 0.25;
    return 0.15 + w1 * 0.55 + w2 * 0.2;
  });

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center relative overflow-hidden">
      <style>{`@keyframes vox-pulse{0%,100%{transform:scaleY(0.3)}50%{transform:scaleY(1)}}`}</style>

      {/* Animated waveform — fills background */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex items-center gap-[3px] w-full px-4 md:px-16" style={{ height: '70vh' }}>
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: `${h * 100}%`,
                background: `rgba(139, 92, 246, ${0.04 + h * 0.07})`,
                animation: `vox-pulse ${1.4 + (i % 6) * 0.22}s ease-in-out infinite`,
                animationDelay: `${i * 0.04}s`,
                transformOrigin: 'center',
              }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 text-center px-6 flex flex-col items-center">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8" style={{ width: 72, height: 72 }}>
          <div className="w-full h-full bg-violet-600 rounded-[1.5rem] flex items-center justify-center shadow-2xl shadow-violet-600/40">
            <ICONS.Podcast className="w-10 h-10 text-white" />
          </div>
        </div>

        {/* Brand */}
        <p className="text-violet-400 font-mono text-xs tracking-[0.35em] uppercase mb-5">VoxTrends</p>

        {/* Headline */}
        <h1 className="text-5xl md:text-6xl font-serif font-bold text-white leading-[1.1] mb-5">
          The truth,<br />one story at a time.
        </h1>

        {/* Sub */}
        <p className="text-zinc-500 text-base md:text-lg max-w-md mx-auto mb-12 leading-relaxed">
          AI-curated daily news briefings. Multiple perspectives, no spin — delivered as a podcast you actually want to listen to.
        </p>

        {/* CTA */}
        <button
          onClick={onStart}
          className="px-10 py-4 bg-violet-600 hover:bg-violet-500 text-white font-black text-base rounded-2xl shadow-lg shadow-violet-600/30 hover:shadow-violet-600/50 transition-all"
        >
          Start Listening Today
        </button>

        {/* Value props */}
        <div className="mt-14 flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
          {['Morning · Midday · Evening', '3 AI voice pairs', 'Deep-dive any story'].map((label) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-600" />
              <span className="text-xs text-zinc-600 font-mono">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ==================== MAIN APP COMPONENT ====================

const App: React.FC = () => {
  // Authentication state
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [authView, setAuthView] = useState<'landing' | 'login' | 'signup'>('landing');
  const [authLoading, setAuthLoading] = useState(true);

  // Application state
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'broadcast' | 'intel' | 'vault'>('broadcast');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [region, setRegion] = useState('Global');
  const [language, setLanguage] = useState('English');
  const [activeTab, setActiveTab] = useState<EditionType>(EditionType.MORNING);
  const [dailyEditions, setDailyEditions] = useState<Record<string, DailyData>>({});
  const [savedClips, setSavedClips] = useState<SavedClip[]>([]);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shareClip, setShareClip] = useState<{
    title: string;
    imageUrl: string | null;
    audio: string | null;
    text: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [researchResult, setResearchResult] = useState<{ text: string; grounding: GroundingLink[] } | null>(null);
  const [step, setStep] = useState(0);
  const [showMobileSettings, setShowMobileSettings] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [quotaRefreshTrigger, setQuotaRefreshTrigger] = useState(0);
  const [selectedVoiceId, setSelectedVoiceId] = useState('originals');
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);

  const t = translations[language as keyof typeof translations] || translations.English;

  // ==================== AUTHENTICATION LOGIC ====================

  useEffect(() => {
    const initAuth = async () => {
      try {
        const currentUser = await auth.getCurrentUser();
        setAuthUser(currentUser);

        if (currentUser) {
          const profile = await db.getUser(currentUser.id);
          if (profile) {
            setUserProfile(profile);
            setUser({
              name: profile.name || 'User',
              email: profile.email,
              avatar: profile.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Vox',
              plan: profile.plan as 'Pro' | 'Free',
              memberSince: new Date(profile.created_at).getFullYear().toString(),
              region: profile.region,
              language: profile.language,
            });
            setRegion(profile.region);
            setLanguage(profile.language);
            setView('broadcast');

            // Load user's saved clips
            const clips = await db.getUserClips(currentUser.id);
            setSavedClips(clips.map(clip => ({
              id: clip.id,
              title: clip.title,
              date: new Date(clip.created_at).toLocaleDateString(),
              type: clip.clip_type,
              text: clip.content,
              imageUrl: clip.image_url,
              audioData: clip.audio_url,
              flashSummary: clip.flash_summary || '',
              chatHistory: clip.chat_history || [],
            })));

            // Update last login
            await db.updateLastLogin(currentUser.id);
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setAuthLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = auth.onAuthStateChange(async (user) => {
      setAuthUser(user);
      if (user) {
        const profile = await db.getUser(user.id);
        if (profile) {
          setUserProfile(profile);
          setUser({
            name: profile.name || 'User',
            email: profile.email,
            avatar: profile.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Vox',
            plan: profile.plan as 'Pro' | 'Free',
            memberSince: new Date(profile.created_at).getFullYear().toString(),
            region: profile.region,
            language: profile.language,
          });
          setView('broadcast');
        }
      } else {
        setUserProfile(null);
        setUser(null);
        setView('broadcast'); // Reset to broadcast instead of landing for public access
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load cached editions on mount
  useEffect(() => {
    const init = async () => {
      const dbEditions = await voxDB.get(VOX_EDITIONS_KEY);
      if (dbEditions) setDailyEditions(dbEditions);

      const h = new Date().getHours();
      if (h < 12) setActiveTab(EditionType.MORNING);
      else if (h < 18) setActiveTab(EditionType.MIDDAY);
      else setActiveTab(EditionType.EVENING);
    };
    init();
  }, []);

  // ==================== MAIN FUNCTIONS ====================

  const handleGenerateDaily = async (ed: EditionType, forceRefresh = false) => {
    if (!authUser) {
      setToastMessage('Please log in to generate editions');
      return;
    }

    const editionKey = getEditionKey(ed, region, language);
    const todayStr = new Date().toLocaleDateString(); // Local date string

    // Check if edition exists locally AND matches today's date
    const cachedEdition = dailyEditions[editionKey];
    const isToday = cachedEdition?.date === todayStr;

    // If edition exists locally, matches today, and not forcing refresh, just show it
    if (!forceRefresh && cachedEdition && isToday) {
      setToastMessage(`✨ Already loaded: ${ed} · ${region} · ${language}`);
      return;
    }

    setLoading(true);
    setStatus(forceRefresh ? 'Refreshing edition...' : 'Checking limits & cache...');

    try {
      // ✅ NOW USING BACKEND FUNCTION THAT CHECKS LIMITS!
      const result = await backend.generateEdition(ed, region, language, forceRefresh, selectedVoiceId);

      if (result.cached) {
        setStatus('Loading cached edition...');
      } else {
        setStatus('Generating fresh edition...');
      }

      const {
        text,
        script,
        audio,
        imageUrl,
        links,
        flashSummary,
        // Phase 3: Voice Variants
        edition_id,
        scriptReady,
        voiceVariantsAvailable,
        voiceVariantsGeneratedCount,
      } = result.data;

      const newData: DailyData = {
        text,
        script,
        audio: audio || null,
        links: links || [],
        imageUrl: imageUrl || null,
        flashSummary: flashSummary,
        chatHistory: [],
        date: todayStr, // Save today's date
        // Phase 3: Voice Variants
        edition_id,
        scriptReady,
        voiceVariantsAvailable,
        voiceVariantsGeneratedCount,
      };

      setDailyEditions(prev => {
        const updated = { ...prev, [editionKey]: newData };
        // Sync with Local DB inside the functional update to ensure we use the freshest state
        voxDB.set(VOX_EDITIONS_KEY, updated).catch(e => console.error('Local DB Sync Error:', e));
        return updated;
      });

      setToastMessage(`🎉 ${ed} edition ready!`);
      setQuotaRefreshTrigger(prev => prev + 1); // Refresh quota display

    } catch (error: any) {
      console.error('Generate edition error:', error);

      // ✅ CHECK IF IT'S A LIMIT ERROR
      if (error.upgrade) {
        setShowPricing(true);
        setToastMessage(`Daily limit reached! Upgrade for unlimited.`);
        return;
      }

      if (error.workerLimit) {
        setToastMessage(`⚡ Server is busy. Please wait a few seconds and try again.`);
        return;
      }

      setToastMessage(error.message || 'Failed to generate edition. Please try again.');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };


  const handleConductResearch = async () => {
    if (!searchQuery.trim() || !authUser) return;

    setLoading(true);
    setStatus('Checking research limits...');
    setStep(1);

    try {
      // ✅ NOW USING BACKEND FUNCTION THAT CHECKS LIMITS!
      const result = await backend.conductResearch(searchQuery, region, language);

      if (result.data) {
        setResearchResult(result.data);
        setStep(2);
        setQuotaRefreshTrigger(prev => prev + 1); // Refresh quota display
      }
    } catch (error: any) {
      console.error('Research error:', error);

      // ✅ CHECK IF IT'S A LIMIT ERROR
      if (error.upgrade) {
        setShowPricing(true);
        setToastMessage(`Daily research limit reached! Upgrade for unlimited.`);
        setStep(0);
        return;
      }

      setToastMessage('Research failed. Please try refining your query.');
      setStep(0);
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  const saveToVault = async (
    title: string,
    data: DailyData | { text: string; grounding: GroundingLink[] },
    type: 'Daily' | 'Research'
  ) => {
    if (!authUser) {
      setToastMessage('Please log in to save clips');
      return;
    }

    try {
      setLoading(true);
      setStatus('Saving to vault...');

      let audioUrl: string | undefined;
      let imageUrl: string | undefined;

      if ((data as DailyData).audio) {
        setStatus('Uploading audio to cloud...');
        try {
          // If it's already a URL, use it directly
          if ((data as DailyData).audio!.startsWith('http')) {
            audioUrl = (data as DailyData).audio!;
          } else {
            audioUrl = await storage.uploadAudio(
              authUser.id,
              (data as DailyData).audio!,
              `${type}-${Date.now()}`
            );
          }
        } catch (error) {
          console.error('Audio upload error:', error);
        }
      }

      if ((data as DailyData).imageUrl) {
        setStatus('Uploading image to cloud...');
        try {
          imageUrl = await storage.uploadImage(
            authUser.id,
            (data as DailyData).imageUrl!,
            `${type}-${Date.now()}`
          );
        } catch (error) {
          console.error('Image upload error:', error);
        }
      }

      setStatus('Saving metadata...');
      const clip = await db.saveClip(
        authUser.id,
        title,
        type,
        data.text,
        {
          flashSummary: (data as DailyData).flashSummary,
          audioUrl: audioUrl,
          imageUrl: imageUrl,
          chatHistory: (data as DailyData).chatHistory,
        }
      );

      const newClip: SavedClip = {
        id: clip.id,
        title: clip.title,
        date: new Date(clip.created_at).toLocaleDateString(),
        type: clip.clip_type,
        text: clip.content,
        imageUrl: clip.image_url,
        audioData: clip.audio_url,
        flashSummary: clip.flash_summary || '',
        chatHistory: clip.chat_history || [],
      };

      setSavedClips(prev => [newClip, ...prev]);
      setToastMessage('âœ… Saved to cloud vault!');
      setStatus('');

      await db.logUsage(authUser.id, 'save_clip', { type, title });

    } catch (error) {
      console.error('Save to vault error:', error);
      setToastMessage('Failed to save. Please try again.');
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const removeFromVault = async (id: string) => {
    try {
      await db.deleteClip(id);
      setSavedClips(prev => prev.filter(c => c.id !== id));
      setToastMessage(t.deletedSuccess);
    } catch (error) {
      console.error('Delete clip error:', error);
      setToastMessage('Failed to delete. Please try again.');
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setUser(null);
      setUserProfile(null);
      setUser(null);
      setUserProfile(null);
      setView('broadcast');
      setAuthView('landing');
      setToastMessage('Logged out successfully');
    } catch (error) {
      console.error('Logout error:', error);
      setToastMessage('Failed to log out');
    }
  };

  const handleClearCache = async () => {
    try {
      await voxDB.clearAll();
      setDailyEditions({});
      setShowMobileSettings(false);
      setShowClearCacheConfirm(false);
      setToastMessage('✨ Cache cleared successfully. Refresh to load new editions.');
    } catch (error) {
      console.error('Clear cache error:', error);
      setToastMessage('Failed to clear cache');
    }
  };

  // ==================== RENDER ====================

  if (authLoading) {
    return (
      <div className="h-screen bg-[#050505] flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 bg-violet-600 rounded-[2rem] flex items-center justify-center mb-6 mx-auto shadow-2xl shadow-violet-600/30 animate-pulse">
            <ICONS.Podcast className="w-12 h-12 text-white" />
          </div>
          <p className="text-zinc-500 font-mono text-sm">Loading VoxTrends...</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    if (authView === 'landing') {
      return <LandingPage onStart={() => setAuthView('login')} />;
    }
    if (authView === 'login') {
      return <LoginScreen onSwitchToSignup={() => setAuthView('signup')} />;
    }
    return <SignupScreen onSwitchToLogin={() => setAuthView('login')} />;
  }

  const currentEditionKey = getEditionKey(activeTab, region, language);
  const currentDaily = dailyEditions[currentEditionKey];

  // Count how many versions of this edition type exist
  const editionVariants = Object.keys(dailyEditions).filter(k => k.startsWith(activeTab)).length;

  return (
    <div className="h-screen bg-[#050505] text-zinc-100 flex flex-col md:flex-row overflow-hidden font-sans">
      <Toast message={toastMessage || ''} visible={!!toastMessage} onHide={() => setToastMessage(null)} />
      <ProgressBar loading={loading} status={status} />

      {
        shareClip && (
          <ShareModal
            clip={shareClip}
            language={language}
            onClose={() => setShareClip(null)}
          />
        )
      }

      {/* Pricing Modal */}
      {
        showPricing && (
          <PricingPage
            onClose={() => setShowPricing(false)}
            userPlan={user?.plan || 'Free'}
          />
        )
      }

      {/* Mobile Settings Modal */}
      {
        showMobileSettings && (
          <div className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-xl flex items-end animate-in fade-in md:hidden">
            <div className="w-full bg-zinc-950 rounded-t-[3rem] p-10 border-t border-zinc-800 animate-in slide-in-from-bottom duration-500">
              <div className="flex justify-between items-center mb-10">
                <h3 className="text-2xl font-serif font-bold">{t.preferences}</h3>
                <button onClick={() => setShowMobileSettings(false)} className="p-3 bg-zinc-900 rounded-full">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="text-xs font-black text-zinc-600 uppercase tracking-widest">{t.region}</label>
                  <select
                    value={region}
                    onChange={(e) => {
                      setRegion(e.target.value);
                      if (authUser && userProfile) {
                        db.updateUser(authUser.id, { region: e.target.value });
                      }
                      setShowMobileSettings(false);
                    }}
                    className="w-full bg-black border border-zinc-800 rounded-2xl py-4 px-6 text-sm font-bold text-white focus:outline-none appearance-none cursor-pointer"
                  >
                    <option value="Global">Global 🌎</option>
                    <option value="USA">USA 🇺🇸</option>
                    <option value="Europe">Europe 🇪🇺</option>
                    <option value="Asia">Asia 🌏</option>
                    <option value="Colombia">Colombia 🇨🇴</option>
                    <option value="Venezuela">Venezuela 🇻🇪</option>
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-black text-zinc-600 uppercase tracking-widest">{t.language}</label>
                  <select
                    value={language}
                    onChange={(e) => {
                      setLanguage(e.target.value);
                      if (authUser && userProfile) {
                        db.updateUser(authUser.id, { language: e.target.value });
                      }
                      setShowMobileSettings(false);
                    }}
                    className="w-full bg-black border border-zinc-800 rounded-2xl py-4 px-6 text-sm font-bold text-white focus:outline-none appearance-none cursor-pointer"
                  >
                    <option value="English">English 🇬🇧</option>
                    <option value="Spanish">Spanish 🇪🇸</option>
                  </select>
                </div>
                <div className="pt-6 border-t border-zinc-800 space-y-3">
                  <button
                    onClick={() => setShowClearCacheConfirm(true)}
                    className="w-full px-4 py-3 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded-2xl font-bold text-sm transition"
                  >
                    🗑️ Clear Cache
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Clear Cache Confirmation Modal */}
      {
        showClearCacheConfirm && (
          <div className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 animate-in fade-in">
            <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-[2rem] p-8 space-y-6 shadow-2xl animate-in zoom-in">
              <div className="space-y-3 text-center">
                <h3 className="text-2xl font-serif font-bold">Clear Cache?</h3>
                <p className="text-sm text-zinc-400">
                  This will remove all locally cached editions. You'll need to refresh to load new content.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearCacheConfirm(false)}
                  className="flex-1 px-4 py-3 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-700 rounded-xl font-bold transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearCache}
                  className="flex-1 px-4 py-3 bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30 rounded-xl font-bold transition"
                >
                  Clear Cache
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Sidebar */}
      <aside className="hidden md:flex w-72 border-r border-zinc-900 flex-col p-8 gap-10 bg-zinc-950/20 shrink-0 h-screen sticky top-0 overflow-y-auto">
        <div className="flex items-center gap-3">
          <ICONS.Podcast className="w-8 h-8 text-violet-600" />
          <span className="text-2xl font-serif font-bold">VoxTrends</span>
        </div>

        <nav className="flex-1 space-y-2">
          <button
            onClick={() => setView('broadcast')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${view === 'broadcast' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            <ICONS.Podcast className="w-5 h-5" />
            <span className="font-bold">Broadcast</span>
          </button>

          <button
            onClick={() => setView('intel')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${view === 'intel' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            <ICONS.Search className="w-5 h-5" />
            <span className="font-bold">Intel Center</span>
          </button>

          <button
            onClick={() => setView('vault')}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl transition-all ${view === 'vault' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-white'}`}
          >
            <ICONS.FileText className="w-5 h-5" />
            <span className="font-bold">Profile & Vault</span>
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-4 p-4 rounded-2xl text-zinc-500 hover:text-red-400 transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="font-bold">Logout</span>
          </button>
        </nav>

        {/* Upgrade Section */}
        <div className="space-y-4">
          {user?.plan === 'Free' && (
            <>
              {/* Quota Display */}
              <QuotaDisplay
                userPlan={user.plan}
                onUpdate={quotaRefreshTrigger}
              />

              {/* Upgrade Button */}
              <button
                onClick={() => setShowPricing(true)}
                className="w-full p-4 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-2xl font-bold text-sm hover:from-violet-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-violet-600/50"
              >
                ⭐ Upgrade to Pro - $5/mo
              </button>
            </>
          )}

          {user?.plan === 'Pro' && (
            <div className="p-4 bg-emerald-600/10 border border-emerald-600/20 rounded-2xl text-center">
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">✨ Pro Member</p>
              <p className="text-xs text-zinc-500 mt-1">Unlimited Everything</p>
            </div>
          )}
        </div>

        <div className="p-6 bg-zinc-900/50 rounded-3xl border border-zinc-800 space-y-4">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{t.region}</label>
            <select
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                if (authUser && userProfile) {
                  db.updateUser(authUser.id, { region: e.target.value });
                }
              }}
              className="px-4 py-2.5 bg-black border border-zinc-800 rounded-xl text-sm font-bold text-zinc-300 focus:border-violet-600 focus:ring-1 focus:ring-violet-600 outline-none hover:border-zinc-700 transition-all appearance-none cursor-pointer"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0\' stroke=\'currentColor\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1rem' }}
            >
              <option value="Global">Global 🌎</option>
              <option value="USA">USA 🇺🇸</option>
              <option value="Europe">Europe 🇪🇺</option>
              <option value="Asia">Asia 🌏</option>
              <option value="Colombia">Colombia 🇨🇴</option>
              <option value="Venezuela">Venezuela 🇻🇪</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5 min-w-[140px]">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 ml-1">Language</label>
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                if (authUser && userProfile) {
                  db.updateUser(authUser.id, { language: e.target.value });
                }
              }}
              className="px-4 py-2.5 bg-black border border-zinc-800 rounded-xl text-sm font-bold text-zinc-300 focus:border-violet-600 focus:ring-1 focus:ring-violet-600 outline-none hover:border-zinc-700 transition-all appearance-none cursor-pointer"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0\' stroke=\'currentColor\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1rem' }}
            >
              <option value="English">English 🇬🇧</option>
              <option value="Spanish">Spanish 🇪🇸</option>
            </select>
          </div>

          <div className="pt-4 border-t border-zinc-800">
            <button
              onClick={() => setShowClearCacheConfirm(true)}
              className="w-full px-4 py-2.5 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-sm font-bold rounded-xl transition"
            >
              🗑️ Clear Cache
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="px-6 md:px-10 py-6 border-b border-zinc-900 flex justify-between items-center backdrop-blur-3xl bg-[#050505]/80 sticky top-0 z-50">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg md:text-2xl font-serif font-bold uppercase tracking-wide md:tracking-widest">
                {view === 'broadcast' ? 'Live Feed' : view === 'intel' ? 'Intel Center' : 'My Vault'}
              </h2>
              <button
                onClick={() => setShowMobileSettings(true)}
                className="md:hidden p-2 bg-zinc-900 rounded-lg text-zinc-400"
              >
                <ICONS.Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Desktop profile button only */}
            <button
              onClick={() => setView(view === 'vault' ? 'broadcast' : 'vault')}
              className="hidden md:flex p-3 bg-zinc-900 rounded-xl text-white items-center gap-2"
            >
              <ICONS.FileText className="w-5 h-5" />
              <span className="text-sm font-bold">Vault</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-10 pb-24 md:pb-32">
          {/* Broadcast View */}
          {view === 'broadcast' && (
            <div className="flex flex-col lg:grid lg:grid-cols-12 gap-10">

              {/* Broadcast Tuner - Top of Feed */}
              <div className="lg:col-span-12">
                <BroadcastTuner
                  region={region}
                  language={language}
                  activeEdition={activeTab}
                  loading={loading}
                  onRegionChange={(r) => {
                    setRegion(r);
                    if (authUser && userProfile) {
                      db.updateUser(authUser.id, { region: r });
                    }
                  }}
                  onLanguageChange={(l) => {
                    setLanguage(l);
                    if (authUser && userProfile) {
                      db.updateUser(authUser.id, { language: l });
                    }
                  }}
                  onEditionChange={setActiveTab}
                  onRefresh={() => handleGenerateDaily(activeTab, true)}
                />
              </div>

              {/* Main Broadcast Section */}
              <div className="lg:col-span-8 lg:col-start-3 space-y-8">
                <section className="bg-zinc-900/10 border border-zinc-900 rounded-[3rem] p-8 md:p-12 relative overflow-hidden">
                  {/* Header: Title and Edition Info */}
                  <div className="animate-in slide-in-from-top duration-700">
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {editionVariants > 1 && (
                        <span className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-bold text-zinc-500">
                          {editionVariants} version{editionVariants > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <span className="text-violet-500 text-xs md:text-[10px] font-bold md:font-black uppercase tracking-wide md:tracking-widest mb-2 block">
                      {activeTab} Edition
                    </span>
                    <h3 className="text-3xl md:text-4xl lg:text-5xl font-serif font-bold tracking-tight">Today's Briefing</h3>
                  </div>

                  {currentDaily && (
                    <div className="mt-8">
                      <button
                        onClick={() => saveToVault(`${activeTab} ${region} Broadcast`, currentDaily, 'Daily')}
                        className="px-6 py-3 bg-emerald-600 border border-emerald-700 rounded-xl text-sm font-black tracking-wide text-white hover:bg-emerald-700 transition-all shadow-lg"
                      >
                        💾 SAVE
                      </button>
                    </div>
                  )}
                </section>

                {/* Phase 3: Voice Selector - Full Width Below Header */}
                {currentDaily && currentDaily.scriptReady && !currentDaily.audio && (
                  <section className="bg-zinc-900/10 border border-zinc-900 rounded-[3rem] p-8 md:p-12 relative overflow-hidden">
                    <VoiceSelector
                      editionId={currentDaily.edition_id || ''}
                      isScriptReady={true}
                      onAudioGenerated={(voiceId, audioUrl) => {
                        // Update currentDaily with generated audio
                        const updatedDaily = { ...currentDaily, audio: audioUrl };
                        const updatedEditions = { ...dailyEditions, [currentEditionKey]: updatedDaily };
                        setDailyEditions(updatedEditions);
                        voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
                      }}
                    />
                  </section>
                )}

                {/* Audio Player - Show if audio exists */}
                {currentDaily && currentDaily.audio && (
                  <>
                    <section className="bg-zinc-900/10 border border-zinc-900 rounded-2xl p-4 relative overflow-hidden flex justify-center">
                      <AudioPlayer
                        audioData={currentDaily.audio}
                        clipId={`edition-${activeTab}`}
                        isPlaying={playingClipId === `edition-${activeTab}`}
                        onPlayPause={() => {
                          if (playingClipId === `edition-${activeTab}`) {
                            setPlayingClipId(null);
                          } else {
                            setPlayingClipId(`edition-${activeTab}`);
                          }
                        }}
                        onEnded={() => setPlayingClipId(null)}
                      />
                    </section>
                    <div className="flex justify-center">
                      <button
                        onClick={() => {
                          const updatedDaily = { ...currentDaily, audio: null };
                          const updatedEditions = { ...dailyEditions, [currentEditionKey]: updatedDaily };
                          setDailyEditions(updatedEditions);
                          voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
                        }}
                        className="text-xs text-zinc-600 hover:text-violet-400 transition-colors"
                      >
                        Try a different voice →
                      </button>
                    </div>
                  </>
                )}

                {/* No Current Daily - Show Generate Button */}
                {!currentDaily && (
                  <section className="bg-zinc-900/10 border border-zinc-900 rounded-[3rem] p-8 md:p-12 relative overflow-hidden flex flex-col items-center justify-center gap-6 py-20">
                    {Object.keys(dailyEditions).some(k => k.startsWith(activeTab)) && (
                      <p className="text-sm text-zinc-500 text-center max-w-xs">
                        💡 Changed settings? Generate a new version for {region} in {language}
                      </p>
                    )}
                    <button
                      onClick={() => handleGenerateDaily(activeTab)}
                      disabled={loading}
                      className="px-10 py-4 bg-white text-black font-black rounded-2xl hover:bg-violet-600 hover:text-white transition-all shadow-xl disabled:opacity-50"
                    >
                      {loading ? 'SYNCING...' : `${t.sync} ${activeTab.toUpperCase()}`}
                    </button>
                  </section>
                )}

                {/* Content: Image, Text, Links, Chat */}
                {currentDaily && (
                  <div className="space-y-10 animate-in fade-in duration-1000">
                    <div className="w-full aspect-video rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl relative group">
                      {currentDaily.imageUrl && (
                        <img
                          src={currentDaily.imageUrl}
                          className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                          alt={`${activeTab} Edition`}
                          onError={(e) => {
                            console.error('Frontend Image Load Error');
                            (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1478737270239-2fccd2c7862a?auto=format&fit=crop&q=80&w=1200';
                          }}
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-8">
                        <p className="text-xs font-mono text-violet-400 tracking-widest uppercase">
                          VOX HOSTS: {
                            selectedVoiceId === 'deep-divers' ? 'MARCUS & ELENA' :
                              selectedVoiceId === 'trendspotters' ? 'KAI & SOPHIA' :
                                'ALEX & JORDAN'
                          }
                        </p>
                      </div>
                    </div>

                    <RichText text={currentDaily.text} language={language} />

                    {/* Grounding Links */}
                    {currentDaily.links && currentDaily.links.length > 0 && (
                      <details open className="group border-t border-zinc-800 pt-6 md:pt-8">
                        <summary className="flex items-center justify-between cursor-pointer list-none">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center">
                              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <div>
                              <h5 className="text-sm font-bold text-white">Verified Sources</h5>
                              <p className="text-xs text-zinc-500">{currentDaily.links.length} source{currentDaily.links.length > 1 ? 's' : ''}</p>
                            </div>
                          </div>
                          <svg className="w-5 h-5 text-zinc-500 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </summary>
                        <div className="mt-4 space-y-3">
                          {currentDaily.links.map((link, i) => (
                            <a
                              key={i}
                              href={link.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-violet-600/50 transition-all group"
                            >
                              <p className="text-xs font-bold text-white group-hover:text-violet-400 truncate">
                                {link.title}
                              </p>
                              <p className="text-[10px] text-zinc-600 truncate">{link.uri}</p>
                            </a>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* InterrogationHub moved to right research panel */}
                  </div>
                )}

                {!currentDaily && !loading && (
                  <div className="py-24 flex flex-col items-center justify-center text-zinc-800 opacity-20">
                    <ICONS.Podcast className="w-20 h-20 mb-4" />
                    <p className="font-serif italic text-lg">Broadcast offline. Sync to begin.</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Intel Center View - Dedicated Research Tab */}
          {view === 'intel' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
              <section className="bg-zinc-950 border border-zinc-900 rounded-[3rem] p-6 md:p-8 relative">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-violet-600/20">
                    <ICONS.Search className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-3xl font-serif font-bold text-white">Intel Center</h3>
                  <p className="text-zinc-500 mt-2">
                    {currentDaily
                      ? `Interrogating: ${activeTab} Edition · ${region}`
                      : 'Select a broadcast to begin interrogation'}
                  </p>
                </div>

                {currentDaily ? (
                  <InterrogationHub
                    context={currentDaily.text}
                    language={language}
                    history={currentDaily.chatHistory || []}
                    setHistory={async (h) => {
                      const updatedDaily = { ...currentDaily, chatHistory: h };
                      const updatedEditions = { ...dailyEditions, [currentEditionKey]: updatedDaily };
                      setDailyEditions(updatedEditions);
                      await voxDB.set(VOX_EDITIONS_KEY, updatedEditions);
                    }}
                  />
                ) : (
                  <div className="py-20 text-center border-2 border-dashed border-zinc-900 rounded-3xl">
                    <p className="text-zinc-600 font-serif italic">
                      No active intelligence package loaded.<br />
                      Go to <strong>Broadcast</strong> and sync an edition first.
                    </p>
                    <button
                      onClick={() => setView('broadcast')}
                      className="mt-6 px-6 py-2 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition"
                    >
                      Go to Broadcast
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Profile/Vault View */}
          {view === 'vault' && user && (
            <div className="max-w-4xl mx-auto space-y-12 pb-20 animate-in fade-in">
              <section className="flex flex-col md:flex-row items-center gap-10 p-12 bg-zinc-900/20 border border-zinc-900 rounded-[3rem]">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-violet-600 shadow-2xl">
                  <img src={user.avatar} className="w-full h-full object-cover" alt={user.name} />
                </div>
                <div className="space-y-2 text-center md:text-left">
                  <h3 className="text-4xl font-serif font-bold text-white">{user.name}</h3>
                  <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">
                    Vox Investigator // Since {user.memberSince}
                  </p>
                  <div className="flex justify-center md:justify-start gap-4 pt-4">
                    <div className="px-4 py-2 bg-violet-600/10 border border-violet-600/20 rounded-xl">
                      <p className="text-[10px] text-violet-500 font-black uppercase">Plan</p>
                      <p className="text-sm font-bold">{user.plan}</p>
                    </div>
                    <div className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl">
                      <p className="text-[10px] text-zinc-500 font-black uppercase">Vault Storage</p>
                      <p className="text-sm font-bold">{savedClips.length} items</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-8">
                <h4 className="text-2xl font-serif font-bold flex items-center gap-4">
                  Intelligence Vault
                  <div className="h-[1px] flex-1 bg-zinc-900" />
                </h4>

                {savedClips.length === 0 ? (
                  <div className="py-20 text-center bg-zinc-950 border border-dashed border-zinc-800 rounded-[3rem] text-zinc-600 font-serif italic">
                    Your vault is currently empty. Start investigating to store intel here.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {savedClips.map(clip => (
                      <div
                        key={clip.id}
                        className="p-8 bg-zinc-900/50 border border-zinc-800 rounded-[2.5rem] hover:border-violet-600/50 transition-all group relative overflow-hidden"
                      >
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button
                            onClick={() => removeFromVault(clip.id)}
                            className="p-2 bg-zinc-950 rounded-lg text-zinc-600 hover:text-red-500 transition-colors"
                          >
                            <ICONS.Trash className="w-4 h-4" />
                          </button>
                        </div>

                        <span className="text-[9px] font-black text-violet-500 uppercase tracking-widest mb-2 block">
                          {clip.type} // {clip.date}
                        </span>
                        <h5 className="text-xl font-bold text-white mb-4">{clip.title}</h5>

                        <div className="flex gap-4">
                          {clip.audioData && (
                            <button
                              onClick={() => {
                                if (playingClipId === clip.id) {
                                  setPlayingClipId(null);
                                } else {
                                  setPlayingClipId(clip.id);
                                }
                              }}
                              className="flex-1 py-3 bg-white text-black text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-violet-600 hover:text-white transition-all"
                            >
                              {playingClipId === clip.id ? 'PAUSE' : 'PLAY'}
                            </button>
                          )}
                          <button
                            onClick={() =>
                              setShareClip({
                                title: clip.title,
                                audio: clip.audioData || null,
                                imageUrl: clip.imageUrl || null,
                                text: clip.text,
                              })
                            }
                            className="px-6 py-3 bg-zinc-950 text-zinc-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:text-white transition-all"
                          >
                            OPEN
                          </button>
                        </div>

                        {/* Hidden Audio Element for Playback - INSIDE clip card */}
                        {clip.audioData && (
                          <div className="hidden">
                            <AudioPlayer
                              audioData={clip.audioData}
                              clipId={clip.id}
                              isPlaying={playingClipId === clip.id}
                              onPlayPause={() => {
                                if (playingClipId === clip.id) {
                                  setPlayingClipId(null);
                                } else {
                                  setPlayingClipId(clip.id);
                                }
                              }}
                              onEnded={() => setPlayingClipId(null)}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Mobile Bottom Navigation - OUTSIDE profile view */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 z-[100] bg-zinc-950 border-t border-zinc-800 safe-area-pb">
            <div className="flex items-center justify-around py-3 px-4">
              <button
                onClick={() => setView('broadcast')}
                className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${view === 'broadcast'
                  ? 'bg-violet-600/20 text-violet-400'
                  : 'text-zinc-500'
                  }`}
              >
                <ICONS.Podcast className="w-6 h-6" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Broadcast</span>
              </button>

              <button
                onClick={() => setView('intel')}
                className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${view === 'intel'
                  ? 'bg-violet-600/20 text-violet-400'
                  : 'text-zinc-500'
                  }`}
              >
                <ICONS.Search className="w-6 h-6" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Intel</span>
              </button>

              <button
                onClick={() => setView('vault')}
                className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${view === 'vault'
                  ? 'bg-violet-600/20 text-violet-400'
                  : 'text-zinc-500'
                  }`}
              >
                <ICONS.FileText className="w-6 h-6" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Vault</span>
              </button>
              {/* Closing the nested divs inside main */}
            </div>
          </div>
        </div>
      </main>

      {/* Floating Audio Player - OUTSIDE main, INSIDE root */}
      {
        playingClipId && (
          <div className="fixed bottom-20 md:bottom-8 right-4 left-4 md:left-auto md:right-8 z-[150] md:w-80 bg-zinc-950 border border-violet-600/30 p-4 rounded-3xl shadow-2xl animate-in slide-in-from-right">
            <div className="flex items-center gap-4 mb-3">
              <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center animate-pulse">
                <ICONS.Podcast className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 overflow-hidden">
                <p className="text-[10px] font-black text-violet-500 uppercase">On Air</p>
                <p className="text-xs font-bold truncate">Broadcast Intelligence</p>
              </div>
              <button
                onClick={() => setPlayingClipId(null)}
                className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white"
              >
                <ICONS.Pause className="w-4 h-4" />
              </button>
            </div>
            <AudioVisualizer isPlaying={true} />
          </div>
        )
      }

    </div >
  );
};

export default App;
