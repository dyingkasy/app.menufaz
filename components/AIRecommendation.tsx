
import React, { useState } from 'react';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { getFoodRecommendation } from '../services/geminiService';

interface AIRecommendationProps {
  onCategorySelect: (category: string) => void;
}

const AIRecommendation: React.FC<AIRecommendationProps> = ({ onCategorySelect }) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const handleAskAI = async () => {
    if (!prompt.trim()) return;
    
    setLoading(true);
    setSuggestion(null);
    
    const result = await getFoodRecommendation(prompt);
    
    setSuggestion(result.suggestion);
    if (result.recommendedCategory) {
      onCategorySelect(result.recommendedCategory);
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-to-r from-red-500 to-orange-600 dark:from-red-700 dark:to-orange-800 rounded-2xl p-6 text-white shadow-lg mb-8 relative overflow-hidden">
      <div className="absolute top-0 right-0 opacity-10 transform translate-x-10 -translate-y-10">
        <Sparkles size={150} />
      </div>
      
      <div className="relative z-10">
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Sparkles className="text-yellow-300" />
          MenuFaz AI
        </h2>
        <p className="text-red-100 mb-4">Não sabe o que pedir? Me diga como você está se sentindo ou o que deseja evitar.</p>
        
        <div className="flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ex: Quero algo leve mas que me deixe feliz..."
            className="flex-1 bg-white/20 backdrop-blur-sm border border-white/30 rounded-lg px-4 py-3 text-white placeholder-red-100 focus:outline-none focus:bg-white/30 transition-all"
            onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
          />
          <button 
            onClick={handleAskAI}
            disabled={loading}
            className="bg-white text-red-600 dark:text-red-700 hover:bg-gray-100 rounded-lg px-6 py-3 font-semibold transition-colors flex items-center gap-2 disabled:opacity-70"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Send size={18} />}
            Perguntar
          </button>
        </div>

        {suggestion && (
          <div className="mt-4 bg-white/10 backdrop-blur-md rounded-lg p-4 border border-white/20 animate-fade-in">
            <p className="font-medium text-lg">💡 {suggestion}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIRecommendation;