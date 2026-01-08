export const formatCurrencyBRL = (value: number | null | undefined) => {
  const amount = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
};
