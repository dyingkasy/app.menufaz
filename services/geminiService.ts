const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const getFoodRecommendation = async (
  userPrompt: string
): Promise<{
  suggestion: string;
  recommendedCategory?: string;
  recommendedProducts?: Array<{
    productId: string;
    productName: string;
    storeId: string;
    storeName?: string;
  }>;
}> => {
  if (!API_BASE_URL) {
    return {
      suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
      recommendedCategory: ''
    };
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
      suggestion: data.suggestion || 'As lojas ainda estão trabalhando para atender a esse pedido.',
      recommendedCategory: data.recommendedCategory || '',
      recommendedProducts: Array.isArray(data.recommendedProducts) ? data.recommendedProducts : []
    };
  } catch (error) {
    console.error('Error fetching recommendation:', error);
    return {
      suggestion: 'As lojas ainda estão trabalhando para atender a esse pedido.',
      recommendedCategory: ''
    };
  }
};
