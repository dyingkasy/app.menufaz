import {
  Address,
  AppSettings,
  Coordinates,
  Coupon,
  Courier,
  FinancialTransaction,
  Order,
  PizzaFlavor,
  Product,
  Review,
  Store,
  StoreAvailability,
  StoreRequest,
  ErrorLogEntry
} from '../types';
import { getAuthToken } from './auth';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'GUEST' | 'CLIENT' | 'BUSINESS' | 'ADMIN' | 'COURIER';
  addresses?: Address[];
  phone?: string;
  storeId?: string;
  city?: string;
  cpf?: string;
}

export interface EncryptedCard {
  id: string;
  brand: string;
  last4: string;
  holder: string;
  encryptedPayload: string;
}

type OrderListener = (orders: Order[]) => void;
type CourierLocationListener = (coords: Coordinates | null) => void;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const POLL_INTERVAL_MS = 5000;

const apiFetch = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const token = getAuthToken();
  const headers = new Headers(options?.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const poller = <T>(fn: () => Promise<T>, listener: (value: T) => void) => {
  let cancelled = false;
  const run = async () => {
    try {
      const value = await fn();
      if (!cancelled) listener(value);
    } catch (err) {
      console.error(err);
    }
  };
  run();
  const interval = setInterval(run, POLL_INTERVAL_MS);
  return () => {
    cancelled = true;
    clearInterval(interval);
  };
};

const ensureApi = () => {
  if (!API_BASE_URL) {
    throw new Error('API base URL not configured');
  }
};

export const getStores = async (): Promise<Store[]> => {
  ensureApi();
  return apiFetch<Store[]>('/stores');
};

export const getStoreById = async (storeId: string): Promise<Store | null> => {
  ensureApi();
  try {
    return await apiFetch<Store>(`/stores/${storeId}`);
  } catch {
    return null;
  }
};

export const updateStore = async (storeId: string, updates: Partial<Store>) => {
  ensureApi();
  await apiFetch(`/stores/${storeId}`, {
    method: 'PUT',
    body: JSON.stringify({ id: storeId, ...updates })
  });
};

export const updateStoreSchedule = async (
  storeId: string,
  schedule: Store['schedule'],
  autoOpenClose?: boolean
) => {
  ensureApi();
  return apiFetch<{ storeId: string; schedule: Store['schedule']; autoOpenClose: boolean }>(
    `/stores/${storeId}/schedule`,
    {
      method: 'PUT',
      body: JSON.stringify({
        schedule,
        ...(typeof autoOpenClose === 'boolean' ? { autoOpenClose } : {})
      })
    }
  );
};

export const updateStoreAutoAccept = async (storeId: string, enabled: boolean) => {
  ensureApi();
  return apiFetch<{ storeId: string; autoAcceptOrders: boolean }>(`/stores/${storeId}/auto-accept`, {
    method: 'PUT',
    body: JSON.stringify({ enabled })
  });
};

export const updateStoreAutoOpen = async (storeId: string, enabled: boolean) => {
  ensureApi();
  return apiFetch<{ storeId: string; autoOpenClose: boolean }>(`/stores/${storeId}/auto-open`, {
    method: 'PUT',
    body: JSON.stringify({ enabled })
  });
};

export const getStoreAvailability = async (storeId: string): Promise<StoreAvailability> => {
  ensureApi();
  return apiFetch<StoreAvailability>(`/stores/${storeId}/availability`);
};

export const pauseStore = async (storeId: string, minutes: number, reason: string) => {
  ensureApi();
  return apiFetch<{ storeId: string; pause: Store['pause'] }>(`/stores/${storeId}/pause`, {
    method: 'POST',
    body: JSON.stringify({ minutes, reason })
  });
};

export const resumeStorePause = async (storeId: string) => {
  ensureApi();
  return apiFetch<{ storeId: string; pause: Store['pause'] }>(`/stores/${storeId}/pause`, {
    method: 'DELETE'
  });
};

export interface StoreCompanyProfile {
  storeId: string;
  store: Store;
  owner: (UserProfile & { id: string }) | null;
}

export const getStoreCompanyProfile = async (storeId: string): Promise<StoreCompanyProfile> => {
  ensureApi();
  return apiFetch<StoreCompanyProfile>(`/stores/${storeId}/company-profile`);
};

export const generateMerchantId = async (storeId: string) => {
  ensureApi();
  return apiFetch<{ merchantId: string; createdAt: string; status?: 'existing' | 'created' }>(
    `/stores/${storeId}/merchant-id`,
    {
      method: 'POST'
    }
  );
};

export const revokeMerchantId = async (storeId: string) => {
  ensureApi();
  return apiFetch<{ revokedAt: string }>(`/stores/${storeId}/merchant-id`, {
    method: 'DELETE'
  });
};

export const toggleStoreStatus = async (storeId: string, updates: Partial<Store>) => {
  await updateStore(storeId, updates);
};

export const deleteStore = async (storeId: string) => {
  ensureApi();
  await apiFetch(`/stores/${storeId}`, { method: 'DELETE' });
};

export const getFavoriteStores = async (): Promise<string[]> => {
  ensureApi();
  return apiFetch<string[]>('/favorites');
};

export const addFavoriteStore = async (storeId: string) => {
  ensureApi();
  await apiFetch('/favorites', {
    method: 'POST',
    body: JSON.stringify({ storeId })
  });
};

export const removeFavoriteStore = async (storeId: string) => {
  ensureApi();
  await apiFetch(`/favorites/${storeId}`, { method: 'DELETE' });
};

export const createStore = async (store: Omit<Store, 'id'>) => {
  ensureApi();
  return apiFetch<Store>('/stores', {
    method: 'POST',
    body: JSON.stringify(store)
  });
};

export const createStoreWithUser = async (payload: {
  ownerName: string;
  email: string;
  password: string;
  phone?: string;
  store: Omit<Store, 'id' | 'ownerId'>;
}) => {
  ensureApi();
  return apiFetch('/stores/with-user', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getProductsByStore = async (storeId: string): Promise<Product[]> => {
  ensureApi();
  return apiFetch<Product[]>(`/products?storeId=${encodeURIComponent(storeId)}`);
};

export const saveProduct = async (product: Omit<Product, 'id'> & { id?: string }) => {
  ensureApi();
  if (product.id) {
    return apiFetch<Product>(`/products/${product.id}`, {
      method: 'PUT',
      body: JSON.stringify(product)
    });
  }
  return apiFetch<Product>('/products', {
    method: 'POST',
    body: JSON.stringify(product)
  });
};

export const importProductsBulk = async (items: Array<Omit<Product, 'id'>>) => {
  ensureApi();
  return apiFetch<{ inserted: number }>('/products/bulk', {
    method: 'POST',
    body: JSON.stringify({ items })
  });
};

export const deleteProduct = async (productId: string) => {
  ensureApi();
  await apiFetch(`/products/${productId}`, { method: 'DELETE' });
};

const PIZZA_SIZE_KEYS = ['brotinho', 'pequena', 'media', 'grande', 'familia'] as const;

const normalizePricesBySize = (value?: Record<string, unknown>) => {
  if (!value || typeof value !== 'object') return {};
  const allowed = new Set(PIZZA_SIZE_KEYS);
  return Object.entries(value).reduce<Record<string, number>>((acc, [key, raw]) => {
    if (!allowed.has(key as typeof PIZZA_SIZE_KEYS[number])) return acc;
    if (raw === '' || raw === null || raw === undefined) return acc;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      acc[key] = parsed;
    }
    return acc;
  }, {});
};

export const getPizzaFlavorsByStore = async (storeId: string): Promise<PizzaFlavor[]> => {
  ensureApi();
  const flavors = await apiFetch<PizzaFlavor[]>(`/pizza-flavors?storeId=${encodeURIComponent(storeId)}`);
  return flavors.map((flavor) => ({
    ...flavor,
    pricesBySize: normalizePricesBySize(flavor.pricesBySize as Record<string, unknown>)
  }));
};

export const savePizzaFlavor = async (flavor: PizzaFlavor) => {
  ensureApi();
  const payload = {
    ...flavor,
    pricesBySize: normalizePricesBySize(flavor.pricesBySize as Record<string, unknown>)
  };
  if (flavor.id) {
    return apiFetch<PizzaFlavor>(`/pizza-flavors/${flavor.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }
  return apiFetch<PizzaFlavor>('/pizza-flavors', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const deletePizzaFlavor = async (flavorId: string) => {
  ensureApi();
  await apiFetch(`/pizza-flavors/${flavorId}`, { method: 'DELETE' });
};

export const getCouponsByStore = async (storeId: string): Promise<Coupon[]> => {
  ensureApi();
  return apiFetch<Coupon[]>(`/coupons?storeId=${encodeURIComponent(storeId)}`);
};

export const saveCoupon = async (coupon: Coupon & { storeId?: string }) => {
  ensureApi();
  if (coupon.id) {
    return apiFetch<Coupon>(`/coupons/${coupon.id}`, {
      method: 'PUT',
      body: JSON.stringify(coupon)
    });
  }
  return apiFetch<Coupon>('/coupons', {
    method: 'POST',
    body: JSON.stringify(coupon)
  });
};

export const deleteCoupon = async (couponId: string) => {
  ensureApi();
  await apiFetch(`/coupons/${couponId}`, { method: 'DELETE' });
};

export const getReviewsByStore = async (storeId: string): Promise<Review[]> => {
  ensureApi();
  return apiFetch<Review[]>(`/reviews?storeId=${encodeURIComponent(storeId)}`);
};

export const addReview = async (payload: {
  storeId: string;
  rating: number;
  comment: string;
  userName?: string;
}) => {
  ensureApi();
  return apiFetch<Review>('/reviews', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getCouriersByStore = async (storeId: string): Promise<Courier[]> => {
  ensureApi();
  return apiFetch<Courier[]>(`/couriers?storeId=${encodeURIComponent(storeId)}`);
};

export const saveCourier = async (courier: Courier & { storeId?: string }) => {
  ensureApi();
  if (courier.id) {
    return apiFetch<Courier>(`/couriers/${courier.id}`, {
      method: 'PUT',
      body: JSON.stringify(courier)
    });
  }
  return apiFetch<Courier>('/couriers', {
    method: 'POST',
    body: JSON.stringify(courier)
  });
};

export const deleteCourier = async (courierId: string) => {
  ensureApi();
  await apiFetch(`/couriers/${courierId}`, { method: 'DELETE' });
};

export const getExpensesByStore = async (storeId: string): Promise<FinancialTransaction[]> => {
  ensureApi();
  return apiFetch<FinancialTransaction[]>(`/expenses?storeId=${encodeURIComponent(storeId)}`);
};

export const saveExpense = async (expense: FinancialTransaction & { storeId?: string }) => {
  ensureApi();
  if (expense.id) {
    return apiFetch<FinancialTransaction>(`/expenses/${expense.id}`, {
      method: 'PUT',
      body: JSON.stringify(expense)
    });
  }
  return apiFetch<FinancialTransaction>('/expenses', {
    method: 'POST',
    body: JSON.stringify(expense)
  });
};

export const deleteExpense = async (expenseId: string) => {
  ensureApi();
  await apiFetch(`/expenses/${expenseId}`, { method: 'DELETE' });
};

export const getOrders = async (filters: {
  storeId?: string;
  userId?: string;
  courierId?: string;
  status?: string;
  city?: string;
  tableNumber?: string;
  tableSessionId?: string;
} = {}): Promise<Order[]> => {
  ensureApi();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  const query = params.toString();
  return apiFetch<Order[]>(`/orders${query ? `?${query}` : ''}`);
};

export const searchCatalog = async (query: string) => {
  ensureApi();
  return apiFetch<{
    stores: Array<{
      id: string;
      name?: string;
      category?: string;
      imageUrl?: string;
      logoUrl?: string;
    }>;
    products: Array<{
      id: string;
      name?: string;
      description?: string;
      storeId?: string;
      storeName?: string;
      storeCategory?: string;
      storeImageUrl?: string;
      storeLogoUrl?: string;
    }>;
  }>(`/search?q=${encodeURIComponent(query)}`);
};

export const createOrder = async (order: Omit<Order, 'id' | 'status' | 'createdAt'> & Partial<Order>) => {
  ensureApi();
  return apiFetch<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(order)
  });
};

export const subscribeToCustomerOrders = (customerId: string, listener: OrderListener) => {
  ensureApi();
  return poller(() => apiFetch<Order[]>(`/orders?customerId=${encodeURIComponent(customerId)}`), listener);
};

export const subscribeToCustomerPhoneOrders = (customerPhone: string, listener: OrderListener) => {
  ensureApi();
  return poller(() => apiFetch<Order[]>(`/orders?customerPhone=${encodeURIComponent(customerPhone)}`), listener);
};

export const subscribeToOrders = (storeId: string, listener: OrderListener) => {
  ensureApi();
  return poller(() => apiFetch<Order[]>(`/orders?storeId=${encodeURIComponent(storeId)}`), listener);
};

export const subscribeToClientOrders = (userId: string, listener: OrderListener) => {
  ensureApi();
  return poller(() => apiFetch<Order[]>(`/orders?userId=${encodeURIComponent(userId)}`), listener);
};

export const subscribeToTableOrders = (
  storeId: string,
  tableNumber: string,
  tableSessionId: string,
  listener: OrderListener
) => {
  ensureApi();
  const query = `/orders?storeId=${encodeURIComponent(storeId)}&tableNumber=${encodeURIComponent(
    tableNumber
  )}&tableSessionId=${encodeURIComponent(tableSessionId)}`;
  return poller(() => apiFetch<Order[]>(query), listener);
};

export const updateOrderStatus = async (orderId: string, status: Order['status'], reason?: string) => {
  ensureApi();
  await apiFetch(`/orders/${orderId}/status`, {
    method: 'PUT',
    body: JSON.stringify(reason ? { status, reason } : { status })
  });
};

export const updateOrderRefundStatus = async (
  orderId: string,
  refundStatus: Order['refundStatus'],
  refundReason?: string
) => {
  ensureApi();
  await apiFetch(`/orders/${orderId}/refund`, {
    method: 'PUT',
    body: JSON.stringify({ refundStatus, refundReason })
  });
};

export const updateOrderChat = async (orderId: string, chat: Order['chat']) => {
  ensureApi();
  await apiFetch(`/orders/${orderId}/chat`, {
    method: 'PUT',
    body: JSON.stringify({ chat })
  });
};

export const updateOrderPayment = async (orderId: string, paymentMethod: string) => {
  ensureApi();
  await apiFetch(`/orders/${orderId}/payment`, {
    method: 'PUT',
    body: JSON.stringify({ paymentMethod })
  });
};

export const printOrder = async (orderId: string) => {
  ensureApi();
  return apiFetch(`/orders/${orderId}/print`, { method: 'POST' });
};

export const deleteOrder = async (orderId: string) => {
  ensureApi();
  await apiFetch(`/orders/${orderId}`, { method: 'DELETE' });
};

export const getOpenOrdersForCity = (city: string, listener: OrderListener) => {
  ensureApi();
  return poller(
    async () => {
      const orders = await apiFetch<Order[]>(
        `/orders?status=WAITING_COURIER&city=${encodeURIComponent(city)}`
      );
      return orders.filter((order) => !order.courierId);
    },
    listener
  );
};

export const acceptOrder = async (orderId: string, courierId: string) => {
  ensureApi();
  await apiFetch(`/orders/${orderId}/assign`, {
    method: 'PUT',
    body: JSON.stringify({ courierId })
  });
};

export const getCourierActiveOrders = (courierId: string, listener: OrderListener) => {
  ensureApi();
  return poller(
    async () => {
      const orders = await apiFetch<Order[]>(`/orders?courierId=${encodeURIComponent(courierId)}`);
      return orders.filter((order) => order.status !== 'COMPLETED' && order.status !== 'CANCELLED');
    },
    listener
  );
};

export const getCourierHistory = async (courierId: string) => {
  ensureApi();
  const orders = await apiFetch<Order[]>(`/orders?courierId=${encodeURIComponent(courierId)}`);
  return orders.filter((order) => order.status === 'COMPLETED' || order.status === 'CANCELLED');
};

export const updateCourierLocation = async (courierId: string, coords: Coordinates) => {
  ensureApi();
  await apiFetch(`/couriers/${courierId}/location`, {
    method: 'PUT',
    body: JSON.stringify(coords)
  });
};

export const updateOrderCourierStage = async (orderId: string, stage: string) => {
  ensureApi();
  await apiFetch(`/orders/${orderId}/courier-stage`, {
    method: 'PUT',
    body: JSON.stringify({ stage })
  });
};

export const subscribeToCourier = (courierId: string, listener: CourierLocationListener) => {
  ensureApi();
  return poller(
    async () => {
      const data = await apiFetch<{ lat: number; lng: number } | null>(`/couriers/${courierId}/location`);
      if (!data) return null;
      return { lat: data.lat, lng: data.lng };
    },
    listener
  );
};

export const updateCourierCity = async (courierId: string, city: string) => {
  const profile = await getUserProfile(courierId);
  if (!profile) return;
  await updateUserProfile(courierId, { ...profile, city });
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  ensureApi();
  try {
    return await apiFetch<UserProfile>(`/users/${uid}/profile`);
  } catch {
    return null;
  }
};

export const createUserProfile = async (uid: string, profile: Omit<UserProfile, 'uid'>) => {
  ensureApi();
  await apiFetch(`/users/${uid}/profile`, {
    method: 'PUT',
    body: JSON.stringify({ ...profile, uid })
  });
};

export const updateUserProfile = async (uid: string, updates: Partial<UserProfile>) => {
  ensureApi();
  await apiFetch(`/users/${uid}/profile`, {
    method: 'PUT',
    body: JSON.stringify({ ...updates, uid })
  });
};

export const addUserAddress = async (uid: string, address: Address) => {
  ensureApi();
  await apiFetch(`/users/${uid}/addresses`, {
    method: 'POST',
    body: JSON.stringify(address)
  });
};

export const getUserCards = async (uid: string): Promise<EncryptedCard[]> => {
  ensureApi();
  return apiFetch<EncryptedCard[]>(`/users/${uid}/cards`);
};

export const saveUserCard = async (
  uid: string,
  card: { number: string; name: string; expiry: string; cvv: string; brand: string }
) => {
  ensureApi();
  const payload = {
    brand: card.brand,
    last4: card.number.slice(-4),
    holder: card.name,
    encryptedPayload: btoa(unescape(encodeURIComponent(JSON.stringify(card))))
  };
  await apiFetch(`/users/${uid}/cards`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const deleteUserCard = async (uid: string, cardId: string) => {
  ensureApi();
  await apiFetch(`/users/${uid}/cards/${cardId}`, { method: 'DELETE' });
};

export const getStoreRequests = async (): Promise<StoreRequest[]> => {
  ensureApi();
  return apiFetch<StoreRequest[]>('/store-requests');
};

export const getStoreRequestById = async (requestId: string): Promise<StoreRequest | null> => {
  ensureApi();
  try {
    return await apiFetch<StoreRequest>(`/store-requests/${requestId}`);
  } catch {
    return null;
  }
};

export const checkEmailExists = async (email: string): Promise<boolean> => {
  ensureApi();
  const data = await apiFetch<{ exists: boolean }>(`/users/exists?email=${encodeURIComponent(email)}`);
  return data.exists;
};

export const createStoreRequest = async (
  data: Omit<StoreRequest, 'id' | 'status' | 'createdAt'>
) => {
  ensureApi();
  await apiFetch('/store-requests', {
    method: 'POST',
    body: JSON.stringify(data)
  });
};

export const approveStoreRequest = async (request: StoreRequest) => {
  ensureApi();
  await apiFetch(`/store-requests/${request.id}/approve`, { method: 'PUT' });
};

export const rejectStoreRequest = async (requestId: string) => {
  ensureApi();
  await apiFetch(`/store-requests/${requestId}/reject`, { method: 'PUT' });
};

export const finalizeStoreRegistration = async (requestId: string, password: string) => {
  ensureApi();
  await apiFetch(`/store-requests/${requestId}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ password })
  });
};

export const getAppSettings = async (): Promise<AppSettings> => {
  ensureApi();
  return apiFetch<AppSettings>('/settings');
};

export const saveAppSettings = async (settings: AppSettings) => {
  ensureApi();
  await apiFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
};

export const getErrorLogs = async (params: {
  source?: string;
  level?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ErrorLogEntry[]; total: number }> => {
  ensureApi();
  const query = new URLSearchParams();
  if (params.source) query.set('source', params.source);
  if (params.level) query.set('level', params.level);
  if (params.search) query.set('search', params.search);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));

  return apiFetch<{ items: ErrorLogEntry[]; total: number }>(`/logs?${query.toString()}`);
};

export const setErrorLogResolved = async (logId: string, resolved: boolean) => {
  ensureApi();
  await apiFetch(`/logs/${logId}/resolve`, {
    method: 'PUT',
    body: JSON.stringify({ resolved })
  });
};

export const clearErrorLogs = async () => {
  ensureApi();
  await apiFetch('/logs', { method: 'DELETE' });
};
