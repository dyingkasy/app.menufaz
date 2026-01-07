import { Store, Category, AdminStats, ChartData, Address, SearchResult, Product, Order, Courier, PaymentMethod, Review } from './types';

// Base Point: Av. Paulista, São Paulo (approx)
const BASE_LAT = -23.561684;
const BASE_LNG = -46.655981;

export const CATEGORIES: Category[] = [
  { id: '1', name: 'Lanches', icon: '🍔' },
  { id: '2', name: 'Pizza', icon: '🍕' },
  { id: '3', name: 'Japonesa', icon: '🍣' },
  { id: '4', name: 'Brasileira', icon: '🥘' },
  { id: '5', name: 'Açaí', icon: '🍧' },
  { id: '6', name: 'Doces', icon: '🍰' },
  { id: '7', name: 'Saudável', icon: '🥗' },
];

// Dados mockados removidos para garantir uso de dados reais
export const MOCK_STORES: Store[] = [];
export const MOCK_PRODUCTS: Product[] = [];
export const MOCK_ADDRESSES: Address[] = [];
export const MOCK_SEARCH_RESULTS: SearchResult[] = [];
export const MOCK_REVIEWS: Review[] = [];
export const MOCK_ORDERS: Order[] = [];
export const MOCK_COURIERS: Courier[] = [];

// Tipos padrão que são úteis como configuração inicial
export const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
    { id: 'pm1', name: 'Cartão de Crédito (Visa/Master)', active: true, type: 'CREDIT' },
    { id: 'pm2', name: 'Cartão de Débito', active: true, type: 'DEBIT' },
    { id: 'pm3', name: 'Pix', active: true, type: 'PIX' },
    { id: 'pm4', name: 'Dinheiro', active: true, type: 'MONEY' },
    { id: 'pm5', name: 'Vale Refeição', active: false, type: 'MEAL_VOUCHER' },
];