const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const fallbackRecommendation = (prompt: string) => {
  const lower = prompt.toLowerCase();
  if (lower.includes('doce') || lower.includes('sobremesa')) {
    return { suggestion: 'Vai de um doce hoje?', recommendedCategory: 'Doces' };
  }
  if (lower.includes('leve') || lower.includes('saudavel') || lower.includes('salada')) {
    return { suggestion: 'Que tal algo leve e equilibrado?', recommendedCategory: 'Saudavel' };
  }
  if (lower.includes('pizza')) {
    return { suggestion: 'Uma pizza caprichada sempre cai bem.', recommendedCategory: 'Pizza' };
  }
  return { suggestion: 'Que tal um lanche bem feito hoje?', recommendedCategory: 'Lanches' };
};

export const getFoodRecommendation = async (
  userPrompt: string
): Promise<{ suggestion: string; recommendedCategory: string }> => {
  if (!API_BASE_URL) {
    return fallbackRecommendation(userPrompt);
  }

  try {
    const response = await fetch(`${API_BASE_URL}/ai/recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: userPrompt })
    });

    if (!response.ok) {
      throw new Error('Request failed');
    }

    const data = await response.json();
    return {
      suggestion: data.suggestion || 'Que tal experimentar algo novo hoje?',
      recommendedCategory: data.recommendedCategory || ''
    };
  } catch (error) {
    console.error('Error fetching recommendation:', error);
    return fallbackRecommendation(userPrompt);
  }
};
