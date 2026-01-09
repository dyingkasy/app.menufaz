

export enum ViewState {
  HOME = 'HOME',
  ADMIN = 'ADMIN',
  REGISTER_BUSINESS = 'REGISTER_BUSINESS',
  LOGIN = 'LOGIN',
  STORE_DETAILS = 'STORE_DETAILS',
  CLIENT_ORDERS = 'CLIENT_ORDERS',
  CHECKOUT = 'CHECKOUT',
  CLIENT_PROFILE = 'CLIENT_PROFILE',
  FINISH_SIGNUP = 'FINISH_SIGNUP',
  COURIER_DASHBOARD = 'COURIER_DASHBOARD',
  TABLE_TRACKING = 'TABLE_TRACKING'
}

export type UserRole = 'GUEST' | 'CLIENT' | 'BUSINESS' | 'ADMIN' | 'COURIER';

export type DashboardSection = 'OVERVIEW' | 'ORDERS' | 'MENU' | 'SETTINGS' | 'CUSTOMERS' | 'COURIERS' | 'GLOBAL_ADDONS' | 'COUPONS' | 'FINANCE' | 'EXPENSES' | 'REQUESTS' | 'SALES' | 'TABLES';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ClosedPeriod {
  id: string;
  startDate: string;
  endDate: string;
  reason?: string;
  isActive: boolean;
}

export interface ScheduleDay {
  day: string; // 'Domingo', 'Segunda', etc.
  morningOpenTime: string; // '00:00'
  morningCloseTime: string; // '12:00'
  afternoonOpenTime: string; // '12:01'
  afternoonCloseTime: string; // '23:59'
  isMorningOpen: boolean; // Se funciona de manhã
  isAfternoonOpen: boolean; // Se funciona de tarde
}

export interface Store {
  id: string;
  name: string;
  category: string;
  description?: string;
  rating: number;
  ratingCount?: number;
  deliveryTime: string;
  pickupTime?: string;
  deliveryFee: number;
  minOrderValue?: number; 
  imageUrl: string;
  isPopular: boolean;
  isActive: boolean;
  coordinates: Coordinates;
  phone?: string;
  whatsapp?: string;
  email?: string;
  cep?: string;
  street?: string;
  number?: string;
  district?: string;
  state?: string;
  complement?: string;
  closedPeriods?: ClosedPeriod[];
  schedule?: ScheduleDay[];
  autoOpenClose?: boolean;
  acceptsCardOnDelivery?: boolean;
  // Novas configurações
  acceptsDelivery: boolean;
  acceptsPickup: boolean; 
  acceptsTableOrders?: boolean;
  tableCount?: number;
  // Endereço para filtro
  city?: string;
  state?: string;
  ownerId?: string;
  customUrl?: string;

  // Dados de Bloqueio Administrativo
  blockReason?: string;
  isFinancialBlock?: boolean;
  financialValue?: number;
  financialInstallments?: number;

  // Segurança
  adminPassword?: string; // Senha administrativa para exclusões
  logoUrl?: string;
}

export interface StoreRequest {
  id: string;
  ownerName: string;
  storeName: string;
  phone: string;
  whatsapp?: string;
  email: string; // Novo campo
  cep?: string;
  street?: string;
  number?: string;
  district?: string;
  state?: string;
  complement?: string;
  city: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

export interface Review {
  id: string;
  storeId: string;
  userName: string;
  rating: number; // 1 a 5
  comment: string;
  date: string;
  reply?: string; // Resposta do estabelecimento
}

export interface ProductOption {
  id: string;
  name: string;
  price: number; // 0 se for grátis
  isAvailable: boolean;
}

export interface ProductOptionGroup {
  id: string;
  name: string; // Ex: "Escolha a Borda", "Adicionais", "Sabor 2"
  min: number; // 0 = Opcional, 1 = Obrigatório
  max: number; // 1 = Única escolha, >1 = Múltipla escolha
  options: ProductOption[];
}

export interface PizzaFlavor {
    id: string;
    storeId: string;
    name: string;
    description?: string;
    isAvailable: boolean;
}

export interface Product {
    id: string;
    storeId: string;
    name: string;
    description: string;
    price: number;
    
    // Promoção Avançada
    promoPrice?: number; 
    discountPercent?: number; 
    discountExpiresAt?: string; 
    
    imageUrl: string;
    category: string;
    isAvailable: boolean;
    
    // Delivery avançado
    isPizza: boolean;
    allowHalfHalf: boolean; // Deprecated in favor of maxFlavors logic, but kept for legacy
    maxFlavors?: number; // 1 = Inteira, 2 = Meio a Meio, 3 = 3 Sabores, 4 = 4 Sabores
    splitSurcharge?: number; // Valor adicional se a pizza for dividida (opcional)
    availableFlavorIds?: string[]; // IDs dos sabores permitidos para esta pizza
    
    optionGroups: ProductOptionGroup[]; 
}

export interface Coupon {
  id: string;
  code: string;
  description?: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  minOrderValue: number; // 0 para sem mínimo
  usageLimit?: number; // Limite total de usos (opcional)
  usageCount: number;
  expiresAt?: string; // Data ISO (opcional)
  isActive: boolean;
}

export interface ChatMessage {
  sender: 'CLIENT' | 'STORE';
  message: string;
  timestamp: string;
}

export interface OrderItem {
    name: string;
    quantity: number;
    notes?: string;
    options?: string[]; 
}

export interface Order {
    id: string;
    storeId?: string;
    userId?: string;
    createdAt?: string;
    customerName: string;
    items: string[]; 
    total: number;
    status: 'PENDING' | 'PREPARING' | 'WAITING_COURIER' | 'DELIVERING' | 'COMPLETED' | 'CANCELLED';
    time: string;
    notes?: string; 
    paymentMethod?: string;
    courierId?: string; 
    
    // Geolocation para rastreio
    storeCoordinates?: Coordinates;
    deliveryCoordinates?: Coordinates;

    // Cidade para filtro de motoboy
    storeCity?: string;
    
    // Reembolso e Chat
    refundStatus?: 'NONE' | 'REQUESTED' | 'APPROVED' | 'REJECTED';
    refundReason?: string;
    chat?: ChatMessage[];
    
    type?: 'DELIVERY' | 'PICKUP' | 'TABLE';
    tableNumber?: string;
    tableSessionId?: string;
    
    // Dados opcionais do cliente
    cpf?: string;
}

export interface Courier {
    id: string;
    name: string;
    phone: string;
    plate: string;
    commissionRate: number;
    isActive: boolean;
    coordinates?: Coordinates; // Localização em tempo real
}

export interface PaymentMethod {
    id: string;
    name: string;
    active: boolean;
    type: 'CREDIT' | 'DEBIT' | 'MONEY' | 'PIX' | 'MEAL_VOUCHER';
    pixKey?: string; // Chave PIX opcional
}

export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface AdminStats {
  totalRevenue: number;
  activeClients: number;
  pendingApprovals: number;
  dailyOrders: number;
}

export interface ChartData {
  name: string;
  value: number;
}

export interface Address {
  id: string;
  label: string;
  street: string;
  number: string;
  coordinates: Coordinates;
  city?: string;
  state?: string;
  district?: string;
}

export interface SearchResult {
    street: string;
    district: string;
    fullAddress: string; // Endereço completo formatado
    coordinates: Coordinates;
    city?: string;
    state?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR';
  time: string;
  read: boolean;
}

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  options: { groupName: string; optionName: string; price: number }[];
  notes?: string;
  totalPrice: number;
}

// --- FINANCIAL TYPES ---

export type TransactionType = 'INCOME' | 'EXPENSE';

export interface FinancialTransaction {
    id: string;
    description: string;
    type: TransactionType;
    amount: number;
    date: string; // ISO Date string
    category: 'VENDAS' | 'INSUMOS' | 'ALUGUEL' | 'ENERGIA' | 'ENTREGADORES' | 'OUTROS' | 'MARKETING' | 'REEMBOLSO' | 'PERDAS' | 'OUTROS_SAIDA' | 'APORTE' | 'VENDA_OFF' | 'OUTROS_ENTRADA';
    status: 'PAID' | 'PENDING';
}

// --- APP SETTINGS ---
export interface AppSettings {
    emailJsServiceId?: string;
    emailJsTemplateId?: string;
    emailJsPublicKey?: string;
    errorNotifyEmailEnabled?: boolean;
    errorNotifyEmailTo?: string;
    errorNotifyEmailTemplateId?: string;
    errorNotifyCooldownSec?: number;
}

export interface ErrorLogEntry {
    id: string;
    source: string;
    level: string;
    message: string;
    stack?: string | null;
    context: Record<string, unknown>;
    createdAt: string;
    resolved: boolean;
}
