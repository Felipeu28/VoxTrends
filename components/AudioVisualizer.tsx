
import React, { useEffect, useRef } from 'react';

interface Props {
  isPlaying: boolean;
}

const AudioVisualizer: React.FC<Props> = ({ isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const bars = 40;
    const barWidth = 4;
    const spacing = 2;
    const heights = new Array(bars).fill(2);

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      for (let i = 0; i < bars; i++) {
        if (isPlaying) {
          // Random dance for visualization
          heights[i] = Math.max(2, Math.min(canvas.height, (heights[i] || 2) + (Math.random() - 0.5) * 10));
        } else {
          heights[i] = Math.max(2, (heights[i] || 2) * 0.9);
        }

        const x = i * (barWidth + spacing);
        const y = canvas.height - heights[i];
        
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#8B5CF6');
        gradient.addColorStop(1, '#6D28D9');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, heights[i]);
      }
      animationId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [isPlaying]);

  return <canvas ref={canvasRef} width={240} height={40} className="w-full opacity-60" />;
};

export default AudioVisualizer;
