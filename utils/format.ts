export const formatCurrencyBRL = (value: number | null | undefined) => {
  const amount = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
};

export const formatOrderNumber = (order: { orderNumber?: number; id?: string } | null | undefined) => {
  if (!order) return '';
  const raw = (order as any).orderNumber;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return String(value);
  const fallback = typeof order.id === 'string' ? order.id : '';
  return fallback ? fallback.slice(0, 5) : '';
};
