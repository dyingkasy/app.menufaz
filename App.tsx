
import React, { useState, useMemo, useEffect, useRef } from 'react';
import Lenis from 'lenis';
import Header from './components/Header';
import StoreCard from './components/StoreCard';
import AIRecommendation from './components/AIRecommendation';
import AdminDashboard from './components/AdminDashboard';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import ApiDocs from './components/ApiDocs';
import CourierDashboard from './components/CourierDashboard';
import RegisterBusiness from './components/RegisterBusiness';
import Login from './components/Login';
import LocationModal from './components/LocationModal';
import StoreDetails from './components/StoreDetails';
import CartDrawer from './components/CartDrawer'; 
import ClientOrders from './components/ClientOrders'; 
import Checkout from './components/Checkout';
import PixPayment from './components/PixPayment';
import ClientProfile from './components/ClientProfile';
import FinishSignup from './components/FinishSignup'; // Import
import TableTracking from './components/TableTracking';
import { ViewState, Address, UserRole, Store, CartItem } from './types';
import { CATEGORIES } from './constants';
import { calculateDistance } from './utils/geo';
import { ArrowRight, ChevronRight, ShoppingBag, MapPinOff, Loader2, ShieldCheck, ClipboardList } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { getStores, getStoreById, searchCatalog, getFavoriteStores, addFavoriteStore, removeFavoriteStore, claimTabletToken } from './services/db';
import { logClientError } from './services/logging';

// Inner App Component to access AuthContext
const MenuFazApp: React.FC = () => {
  const { user, loading: authLoading, logout } = useAuth();
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.HOME);
  const [pixPaymentOrderId, setPixPaymentOrderId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [globalSearchTerm, setGlobalSearchTerm] = useState<string>('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<{
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
  }>({ stores: [], products: [] });
  const [isOrderLookupOpen, setIsOrderLookupOpen] = useState(false);
  const [orderLookupPhone, setOrderLookupPhone] = useState('');
  const [orderLookupError, setOrderLookupError] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({
      duration: 1.15,
      smoothWheel: true,
      smoothTouch: false
    });
    let rafId: number;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);


  const [favoriteStoreIds, setFavoriteStoreIds] = useState<string[]>([]);
  
  // Store Selection State
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [tableContext, setTableContext] = useState<{ storeId: string; tableNumber: string; sessionId: string } | null>(null);
  const [initialTableParam, setInitialTableParam] = useState(() => {
      const params = new URLSearchParams(window.location.search);
      return (params.get('mesa') || '').trim();
  });
  const [initialTabletToken] = useState(() => {
      const params = new URLSearchParams(window.location.search);
      return (params.get('tablet_token') || '').trim();
  });
  const [initialTabletDeviceId] = useState(() => {
      const params = new URLSearchParams(window.location.search);
      return (params.get('tablet_device_id') || '').trim();
  });

  // Admin Impersonation State
  const [adminTargetStoreId, setAdminTargetStoreId] = useState<string | null>(null);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);

  // Cart State
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Location State
  const [currentAddressObj, setCurrentAddressObj] = useState<Address | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  
  // Signup Flow State
  const [pendingSignupRequestId, setPendingSignupRequestId] = useState<string | null>(null);
  const [pendingStoreSlug, setPendingStoreSlug] = useState<string | null>(null);
  const initialPathRef = useRef<string>(typeof window !== 'undefined' ? window.location.pathname : '/');

  // Remove max radius limit as requested. We will filter by City.
  // const MAX_DELIVERY_RADIUS = 10.0; 

  const currentAddressString = currentAddressObj 
    ? `${currentAddressObj.street}${currentAddressObj.number ? `, ${currentAddressObj.number}` : ''}` 
    : 'Selecione um endereço';

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      logClientError({
        message: event.message || 'Unhandled error',
        stack: event.error?.stack,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      logClientError({
        message: reason?.message || String(reason),
        stack: reason?.stack,
        context: { type: 'unhandledrejection' }
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  const normalizeSlug = (value: string) =>
      (value || '')
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');
  const restoreLastPathIfNeeded = () => {
    if (typeof window === 'undefined') return;
    const isRoot = window.location.pathname === '/' && !window.location.search;
    if (!isRoot) return;
    const stored = localStorage.getItem('last_path');
    if (!stored || !stored.startsWith('/')) return;
    if (stored === '/') return;
    try {
      const url = new URL(stored, window.location.origin);
      window.history.replaceState({}, document.title, url.pathname + url.search);
      const mesa = new URLSearchParams(url.search).get('mesa');
      if (mesa) {
        setInitialTableParam(mesa.trim());
      }
    } catch {}
  };

  const applyPath = (pathname: string) => {
    const trimmed = pathname.replace(/^\/+|\/+$/g, '');
    if (!trimmed) {
      setCurrentView(ViewState.HOME);
      return;
    }

    const pixMatch = trimmed.match(/^pedido\/([^/]+)\/pagamento\/pix$/i);
    if (pixMatch) {
      setPixPaymentOrderId(pixMatch[1]);
      setCurrentView(ViewState.PIX_PAYMENT);
      return;
    }

    const viewMap: Record<string, ViewState> = {
      login: ViewState.LOGIN,
      admin: ViewState.ADMIN,
      'api-menufaz': ViewState.API_DOCS,
      'cadastro-loja': ViewState.REGISTER_BUSINESS,
      pedidos: ViewState.CLIENT_ORDERS,
      perfil: ViewState.CLIENT_PROFILE,
      checkout: ViewState.CHECKOUT,
      'finalizar-cadastro': ViewState.FINISH_SIGNUP,
      courier: ViewState.COURIER_DASHBOARD,
      'acompanhar-mesa': ViewState.TABLE_TRACKING
    };

    if (viewMap[trimmed]) {
      setCurrentView(viewMap[trimmed]);
      return;
    }

    setPendingStoreSlug(trimmed);
  };
  const isKnownRoute = (pathname: string) => {
    const trimmed = pathname.replace(/^\/+|\/+$/g, '');
    if (!trimmed) return true;
    if (trimmed.match(/^pedido\/([^/]+)\/pagamento\/pix$/i)) return true;
    const viewMap: Record<string, ViewState> = {
      login: ViewState.LOGIN,
      admin: ViewState.ADMIN,
      'api-menufaz': ViewState.API_DOCS,
      'cadastro-loja': ViewState.REGISTER_BUSINESS,
      pedidos: ViewState.CLIENT_ORDERS,
      perfil: ViewState.CLIENT_PROFILE,
      checkout: ViewState.CHECKOUT,
      'finalizar-cadastro': ViewState.FINISH_SIGNUP,
      courier: ViewState.COURIER_DASHBOARD,
      'acompanhar-mesa': ViewState.TABLE_TRACKING
    };
    return Boolean(viewMap[trimmed]);
  };

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
      setIsDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDarkMode(false);
      document.documentElement.classList.remove('dark');
    }

    // Check for URL params (simulation for "Clicking Email Link")
    const urlParams = new URLSearchParams(window.location.search);
    const finishSignupId = urlParams.get('finish_signup');
    if (finishSignupId) {
        setPendingSignupRequestId(finishSignupId);
        setCurrentView(ViewState.FINISH_SIGNUP);
        // Clean URL
        window.history.replaceState({}, document.title, '/finalizar-cadastro');
        return;
    }

    restoreLastPathIfNeeded();
    applyPath(window.location.pathname);

  }, []);

  const getTableParam = () => {
      const params = new URLSearchParams(window.location.search);
      return (params.get('mesa') || '').trim();
  };

  const getTableSessionId = (storeId: string, tableNumber: string) => {
      const key = `table_session_${storeId}_${tableNumber}`;
      let sessionId = localStorage.getItem(key);
      if (!sessionId) {
          sessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          localStorage.setItem(key, sessionId);
      }
      return sessionId;
  };

  useEffect(() => {
    const handlePopState = () => {
      applyPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Fetch Stores from DB
  useEffect(() => {
      const fetchStoresData = async () => {
          try {
              const dbStores = await getStores();
              if (dbStores.length > 0) {
                  // Show all stores except administratively blocked ones. 
                  // Closed stores (!isActive) are shown but disabled in UI.
                  setStores(dbStores.filter(s => !s.blockReason)); 
              } else {
                  setStores([]); 
              }
          } catch (e) {
              console.error("Error loading stores:", e);
              setStores([]);
          }
      };
      fetchStoresData();
  }, []);

  useEffect(() => {
      const loadFavorites = async () => {
          if (!user) {
              setFavoriteStoreIds([]);
              return;
          }
          try {
              const favorites = await getFavoriteStores();
              setFavoriteStoreIds(favorites);
          } catch (error) {
              console.error('Erro ao carregar favoritos', error);
          }
      };
      loadFavorites();
  }, [user]);

  useEffect(() => {
      if (!pendingStoreSlug || stores.length === 0) return;

      const slug = normalizeSlug(decodeURIComponent(pendingStoreSlug));
      const found = stores.find((store) => {
          const custom = store.customUrl ? normalizeSlug(store.customUrl) : '';
          return custom === slug || normalizeSlug(store.name) === slug || store.id === pendingStoreSlug;
      });

      if (found) {
          setSelectedStore(found);
          setCurrentView(ViewState.STORE_DETAILS);
      }
      setPendingStoreSlug(null);
  }, [pendingStoreSlug, stores]);

  useEffect(() => {
      if (!selectedStore) {
          setTableContext(null);
          return;
      }
      const tableParam = (initialTableParam || getTableParam()).trim();
      if (!tableParam || !selectedStore.acceptsTableOrders) {
          setTableContext(null);
          return;
      }
      const sessionId = getTableSessionId(selectedStore.id, tableParam);
      setTableContext({ storeId: selectedStore.id, tableNumber: tableParam, sessionId });
      if (initialTableParam) {
          setInitialTableParam('');
      }
  }, [selectedStore, initialTableParam]);

  const isTabletMode =
      new URLSearchParams(window.location.search).get('tablet') === '1' || !!initialTabletToken;
  const tabletToken = initialTabletToken;
  const tabletDeviceParam = initialTabletDeviceId;
  useEffect(() => {
      if (!isTabletMode) return;
      try {
          localStorage.setItem('tablet_mode', '1');
      } catch {}
  }, [isTabletMode]);
  useEffect(() => {
      if (!isTabletMode || typeof window === 'undefined') return;
      const flagKey = 'tablet_sw_cleared';
      if (sessionStorage.getItem(flagKey)) return;
      if (!('serviceWorker' in navigator) || !('caches' in window)) return;
      const clear = async () => {
          try {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map((reg) => reg.unregister()));
              const cacheNames = await caches.keys();
              await Promise.all(cacheNames.map((name) => caches.delete(name)));
          } catch {}
          sessionStorage.setItem(flagKey, '1');
          window.location.reload();
      };
      clear();
  }, [isTabletMode]);
  const requestTabletReset = () => {
      try {
          localStorage.removeItem('tablet_device_id');
          localStorage.removeItem('tablet_mode');
      } catch {}
      try {
          const bridge = (window as any).MenufazTablet;
          if (bridge && typeof bridge.requestReset === 'function') {
              bridge.requestReset();
              return;
          }
          window.location.href = 'menufaz://reset';
      } catch {}
  };
  const ensureTabletDeviceId = () => {
      let stored = '';
      try {
          stored = localStorage.getItem('tablet_device_id') || '';
      } catch {}
      let deviceId = stored || tabletDeviceParam || '';
      try {
          const bridge = (window as any).MenufazTablet;
          if (bridge && typeof bridge.getDeviceId === 'function') {
              const nativeId = String(bridge.getDeviceId() || '').trim();
              if (nativeId) deviceId = nativeId;
          }
      } catch {}
      if (!deviceId) {
          deviceId =
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                  ? `tab-${crypto.randomUUID()}`
                  : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
      if (deviceId && deviceId !== stored) {
          try {
              localStorage.setItem('tablet_device_id', deviceId);
          } catch {}
      }
      return deviceId;
  };
  useEffect(() => {
      if (!tabletToken) return;
      const deviceId = ensureTabletDeviceId();
      if (!deviceId) return;
      const label = tableContext?.tableNumber ? `Mesa ${tableContext.tableNumber}` : 'Tablet';
      const apiBase = (() => {
          const base = import.meta.env.VITE_API_BASE_URL || '';
          if (!base) return window.location.origin;
          if (base.startsWith('http')) return base;
          return `${window.location.origin}${base}`;
      })();
      const ping = () => {
          claimTabletToken(tabletToken, deviceId, label)
              .catch((error) => {
                  if (String(error?.message || '').includes('revoked')) {
                      requestTabletReset();
                  }
              });
          if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
              try {
                  const payload = JSON.stringify({ token: tabletToken, deviceId, deviceLabel: label });
                  const url = `${apiBase}/tablets/claim`;
                  const blob = new Blob([payload], { type: 'application/json' });
                  navigator.sendBeacon(url, blob);
              } catch {}
          }
          try {
              const img = new Image();
              const url = `${apiBase}/tablets/claim?token=${encodeURIComponent(tabletToken)}&deviceId=${encodeURIComponent(deviceId)}&deviceLabel=${encodeURIComponent(label)}`;
              img.src = url;
          } catch {}
      };
      ping();
      const interval = setInterval(ping, 60000);
      return () => clearInterval(interval);
  }, [tabletToken, tabletDeviceParam, tableContext?.tableNumber]);

  useEffect(() => {
      if (pendingStoreSlug && !selectedStore) return;

      const currentPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
      let nextPath = '';

      if (currentView === ViewState.HOME && !selectedStore && !pendingStoreSlug) {
          const initialPath = initialPathRef.current || '';
          if (initialPath !== '/' && !isKnownRoute(initialPath)) {
              return;
          }
      }

      if (currentView === ViewState.STORE_DETAILS && selectedStore) {
          const custom = selectedStore.customUrl ? normalizeSlug(selectedStore.customUrl) : '';
          nextPath = custom || normalizeSlug(selectedStore.name);
      } else if (currentView === ViewState.TABLE_TRACKING) {
          nextPath = 'acompanhar-mesa';
      } else if (currentView === ViewState.LOGIN) {
          nextPath = 'login';
      } else if (currentView === ViewState.ADMIN) {
          nextPath = 'admin';
      } else if (currentView === ViewState.API_DOCS) {
          nextPath = 'api-menufaz';
      } else if (currentView === ViewState.REGISTER_BUSINESS) {
          nextPath = 'cadastro-loja';
      } else if (currentView === ViewState.CLIENT_ORDERS) {
          nextPath = 'pedidos';
      } else if (currentView === ViewState.CLIENT_PROFILE) {
          nextPath = 'perfil';
      } else if (currentView === ViewState.CHECKOUT) {
          nextPath = 'checkout';
      } else if (currentView === ViewState.FINISH_SIGNUP) {
          nextPath = 'finalizar-cadastro';
      } else if (currentView === ViewState.COURIER_DASHBOARD) {
          nextPath = 'courier';
      } else if (currentView === ViewState.PIX_PAYMENT && pixPaymentOrderId) {
          nextPath = `pedido/${pixPaymentOrderId}/pagamento/pix`;
      }

      if (nextPath !== currentPath) {
          const mesaValue = tableContext?.tableNumber || initialTableParam;
          const shouldKeepMesa = mesaValue && (currentView === ViewState.STORE_DETAILS || currentView === ViewState.TABLE_TRACKING);
          const searchParams = new URLSearchParams();
          if (shouldKeepMesa) {
              searchParams.set('mesa', mesaValue);
          }
          if (isTabletMode) {
              searchParams.set('tablet', '1');
              if (tabletToken) searchParams.set('tablet_token', tabletToken);
              if (tabletDeviceParam) searchParams.set('tablet_device_id', tabletDeviceParam);
          }
          const search = searchParams.toString() ? `?${searchParams.toString()}` : '';
          const url = `/${nextPath}${search}`;
          window.history.pushState({}, '', url);
      }
  }, [currentView, selectedStore, pendingStoreSlug, tableContext, initialTableParam, pixPaymentOrderId, isTabletMode, tabletToken, tabletDeviceParam]);
  useEffect(() => {
      if (typeof window === 'undefined') return;
      const path = window.location.pathname + window.location.search;
      if (path) {
          localStorage.setItem('last_path', path);
      }
  }, [currentView, selectedStore, pendingStoreSlug, tableContext, initialTableParam, pixPaymentOrderId, isTabletMode, tabletToken, tabletDeviceParam]);

  // Auto-login behavior and redirection
  useEffect(() => {
      if (!authLoading) {
          if (user) {
              // User is logged in
              if (currentView === ViewState.LOGIN || currentView === ViewState.FINISH_SIGNUP) {
                   // Force redirect if stuck on login/signup page
                   if (user.role === 'ADMIN') {
                       setCurrentView(ViewState.ADMIN);
                   } else if (user.role === 'BUSINESS') {
                       setCurrentView(ViewState.ADMIN); 
                   } else if (user.role === 'COURIER') {
                       setCurrentView(ViewState.COURIER_DASHBOARD);
                   } else {
                       setCurrentView(ViewState.HOME);
                   }
              }
              
              // Role specific routing enforcement
              if (user.role === 'COURIER' && currentView === ViewState.HOME) {
                  setCurrentView(ViewState.COURIER_DASHBOARD);
              }

              if (user.role === 'CLIENT') {
                   // If user has saved addresses in DB, load them
                   if (user.addresses && user.addresses.length > 0) {
                       setSavedAddresses(user.addresses);
                       // If no current address selected, pick the first one
                       if (!currentAddressObj) {
                           setCurrentAddressObj(user.addresses[0]);
                           setIsLocationModalOpen(false);
                       }
                   }
              }
          } else if (currentView === ViewState.ADMIN || currentView === ViewState.CLIENT_PROFILE || currentView === ViewState.COURIER_DASHBOARD) {
              // Protected routes redirect to login if no user
              setCurrentView(ViewState.LOGIN);
          }
      }
  }, [user, authLoading, currentView]);

  const toggleTheme = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setIsDarkMode(true);
    }
  };

  const handleCloseLocationModal = () => {
    setIsLocationModalOpen(false);
  };

  const handleSaveAddress = (newAddress: Address) => {
      setSavedAddresses(prev => {
          const filtered = prev.filter(a => a.id !== newAddress.id);
          return [newAddress, ...filtered];
      });
      setCurrentAddressObj(newAddress);
      setIsLocationModalOpen(false); 
  };

  const handleStoreClick = (store: Store) => {
      setSelectedStore(store);
      setCurrentView(ViewState.STORE_DETAILS);
  };

  const toggleFavorite = async (storeId: string) => {
      if (!user) {
          setCurrentView(ViewState.LOGIN);
          return;
      }
      const isFavorited = favoriteStoreIds.includes(storeId);
      setFavoriteStoreIds((prev) =>
          isFavorited ? prev.filter((id) => id !== storeId) : [...prev, storeId]
      );
      try {
          if (isFavorited) {
              await removeFavoriteStore(storeId);
          } else {
              await addFavoriteStore(storeId);
          }
      } catch (error) {
          console.error('Erro ao atualizar favorito', error);
          setFavoriteStoreIds((prev) =>
              isFavorited ? [...prev, storeId] : prev.filter((id) => id !== storeId)
          );
      }
  };

  const openStoreById = async (storeId?: string) => {
      if (!storeId) return;
      let store = stores.find((item) => item.id === storeId) || null;
      if (!store) {
          try {
              store = await getStoreById(storeId);
          } catch (error) {
              console.error('Erro ao carregar loja', error);
          }
      }
      if (store) {
          setSelectedStore(store);
          setCurrentView(ViewState.STORE_DETAILS);
      }
  };

  const handleSearchSelectStore = async (storeId: string) => {
      setPendingProductId(null);
      await openStoreById(storeId);
      setGlobalSearchTerm('');
      setSearchResults({ stores: [], products: [] });
  };

  const handleSearchSelectProduct = async (storeId?: string, productId?: string) => {
      if (productId) setPendingProductId(productId);
      await openStoreById(storeId);
      setGlobalSearchTerm('');
      setSearchResults({ stores: [], products: [] });
  };
  const handleAiProductSelect = async (storeId: string, productId: string) => {
      setPendingProductId(productId);
      await openStoreById(storeId);
  };

  const handleAddToCart = (item: CartItem) => {
      setCartItems(prev => [...prev, item]);
  };

  const handleRemoveFromCart = (id: string) => {
      setCartItems(prev => prev.filter(item => item.id !== id));
  };

  const handleClearCart = () => {
      setCartItems([]);
  };

  const handleCheckout = () => {
      setCurrentView(ViewState.CHECKOUT);
  };

  const handleOrderPlaced = () => {
      setCartItems([]);
      setCurrentView(tableContext ? ViewState.TABLE_TRACKING : ViewState.CLIENT_ORDERS);
  };

  const handlePixPayment = (orderId: string) => {
      setPixPaymentOrderId(orderId);
      setCurrentView(ViewState.PIX_PAYMENT);
  };
  const handleOpenOrderLookup = () => {
      setOrderLookupError('');
      setIsOrderLookupOpen(true);
  };

  const handleConfirmOrderLookup = () => {
      const digits = orderLookupPhone.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 11) {
          setOrderLookupError('Informe DDD + número.');
          return;
      }
      localStorage.setItem('customerPhone', digits);
      setIsOrderLookupOpen(false);
      setCurrentView(ViewState.CLIENT_ORDERS);
  };

  const handleLogout = async () => {
      await logout();
      setCurrentView(ViewState.HOME);
      setAdminTargetStoreId(null);
  };

  const handleSuperAdminManageStore = (store: Store) => {
      setAdminTargetStoreId(store.id);
      // Force update to trigger re-render of AdminDashboard with new props if already mounted, 
      // though React handles prop changes. We just need to ensure we render the component.
  };

  const handleBackFromStoreAdmin = () => {
      setAdminTargetStoreId(null);
  };

  const cartTotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    const term = globalSearchTerm.trim();
    if (term.length < 2) {
      setSearchResults({ stores: [], products: [] });
      setSearchLoading(false);
      return;
    }
    let active = true;
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await searchCatalog(term);
        if (active) setSearchResults(data);
      } catch (error) {
        console.error('Erro ao buscar catálogo', error);
        if (active) setSearchResults({ stores: [], products: [] });
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [globalSearchTerm]);

  const filteredStores = useMemo(() => {
    let filtered = stores;

    // Calculate distance for sorting but NOT for strict filtering by radius (as requested by user)
    // Filter by City Match instead
    const normalize = (s: string) =>
        String(s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const userCity = normalize(currentAddressObj?.city || "");

    if (currentAddressObj) {
        filtered = filtered.map(store => {
            const distance = calculateDistance(currentAddressObj.coordinates, store.coordinates);
            return { ...store, _distance: distance }; 
        });
    }

    // Apply City Filter if user has a city defined.
    // If user doesn't have city (legacy address), we might fallback to radius or show all.
    // User request: "localizar todos os estabelecimentos cadastrado na cidade especifica"
    if (userCity) {
        filtered = filtered.filter(store => {
            const storeCity = normalize(store.city || "");
            return storeCity === userCity;
        });
    }

    // Sort by distance when available
    if (currentAddressObj) {
        filtered.sort((a: any, b: any) => a._distance - b._distance);
    }

    if (selectedCategory !== 'Todos') {
        const selectedNorm = normalize(selectedCategory);
        filtered = filtered.filter(store => {
            const rawCategory = store.category || '';
            const normalized = normalize(rawCategory);
            if (!normalized) return false;
            if (normalized === selectedNorm) return true;
            if (normalized.includes(selectedNorm)) return true;
            const parts = normalized.split(/[,/|]+/).map(part => part.trim()).filter(Boolean);
            return parts.some(part => part === selectedNorm);
        });
    }

    return filtered;
  }, [selectedCategory, currentAddressObj, stores]);

  const handleCategorySelect = (catName: string) => {
    setSelectedCategory(catName);
    const element = document.getElementById('stores-section');
    if (element) element.scrollIntoView({ behavior: 'smooth' });
  };

  if (authLoading) {
      return (
          <div className="min-h-screen bg-white dark:bg-slate-900 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-red-600 animate-spin" />
          </div>
      );
  }

  // --- ROUTING LOGIC ---

  if (currentView === ViewState.COURIER_DASHBOARD) {
      return <CourierDashboard onLogout={handleLogout} />;
  }

  if (currentView === ViewState.API_DOCS) {
      return <ApiDocs onBack={() => setCurrentView(ViewState.ADMIN)} />;
  }

  if (currentView === ViewState.ADMIN) {
    // If Super Admin AND NOT managing a specific store -> Show Super Dashboard
    if (user?.role === 'ADMIN' && !adminTargetStoreId) {
        return (
          <SuperAdminDashboard
            onLogout={handleLogout}
            onManageStore={handleSuperAdminManageStore}
            onAccessApi={() => setCurrentView(ViewState.API_DOCS)}
          />
        );
    }
    // If Business User OR Super Admin managing a store -> Show Store Dashboard
    return (
        <AdminDashboard 
            onBack={user?.role === 'ADMIN' ? handleBackFromStoreAdmin : handleLogout} 
            userRole={user?.role || 'GUEST'} 
            targetStoreId={adminTargetStoreId}
            isDarkMode={isDarkMode}
            toggleTheme={toggleTheme}
        />
    );
  }

  if (currentView === ViewState.REGISTER_BUSINESS) {
    return <RegisterBusiness onBack={() => setCurrentView(ViewState.HOME)} />;
  }

  if (currentView === ViewState.LOGIN) {
    return <Login onNavigate={setCurrentView} onLoginSuccess={() => {}} />;
  }

  if (currentView === ViewState.FINISH_SIGNUP && pendingSignupRequestId) {
      return <FinishSignup requestId={pendingSignupRequestId} onNavigate={setCurrentView} />;
  }

  if (currentView === ViewState.CLIENT_ORDERS) {
      return <ClientOrders onBack={() => setCurrentView(ViewState.HOME)} />;
  }

  if (currentView === ViewState.CLIENT_PROFILE) {
      return <ClientProfile onBack={() => setCurrentView(ViewState.HOME)} onLogout={handleLogout} />;
  }

  if (currentView === ViewState.CHECKOUT && selectedStore) {
      const activeTableContext = tableContext && tableContext.storeId === selectedStore.id ? tableContext : undefined;
      return (
          <>
              <Checkout 
                store={selectedStore}
                cartItems={cartItems}
                address={currentAddressObj}
                onBack={() => setCurrentView(ViewState.STORE_DETAILS)}
                onOrderPlaced={handleOrderPlaced}
                onPixPayment={handlePixPayment}
                onChangeAddress={() => setIsLocationModalOpen(true)}
                tableContext={activeTableContext}
              />
              <LocationModal 
                isOpen={isLocationModalOpen} 
                onClose={handleCloseLocationModal}
                onSelectAddress={setCurrentAddressObj}
                onSaveAddress={handleSaveAddress}
                savedAddresses={savedAddresses}
                canClose={!!currentAddressObj} 
              />
          </>
      );
  }

  if (currentView === ViewState.TABLE_TRACKING && selectedStore && tableContext) {
      return (
          <TableTracking
              store={selectedStore}
              tableNumber={tableContext.tableNumber}
              tableSessionId={tableContext.sessionId}
              onBack={() => setCurrentView(ViewState.STORE_DETAILS)}
          />
      );
  }

  if (currentView === ViewState.PIX_PAYMENT && pixPaymentOrderId) {
      return (
          <PixPayment
              orderId={pixPaymentOrderId}
              onBack={() => setCurrentView(ViewState.CLIENT_ORDERS)}
              onPaid={handleOrderPlaced}
          />
      );
  }

  return (
    <div className="min-h-screen flex flex-col text-gray-800 dark:text-gray-100 font-sans bg-gray-50/50 dark:bg-slate-900 transition-colors duration-300">
      {!isTabletMode && (
        <Header 
          currentView={currentView} 
          onNavigate={setCurrentView} 
          storeName={currentView === ViewState.STORE_DETAILS ? selectedStore?.name : undefined}
          onOpenLocation={() => setIsLocationModalOpen(true)}
          onOpenOrderHistory={handleOpenOrderLookup}
          currentAddress={currentAddressString}
          userRole={user?.role || 'GUEST'}
          userName={user?.name}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
          cartItemCount={cartCount}
          cartTotal={cartTotal}
          onOpenCart={() => setIsCartOpen(true)}
          onSearch={setGlobalSearchTerm}
          searchValue={globalSearchTerm}
          searchLoading={searchLoading}
          searchResults={searchResults}
          onSearchSelectStore={handleSearchSelectStore}
          onSearchSelectProduct={handleSearchSelectProduct}
        />
      )}

      {!isTabletMode && (
        <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-3">
          {user?.role === 'ADMIN' || user?.role === 'BUSINESS' ? (
            <button 
                onClick={() => setCurrentView(ViewState.ADMIN)}
                className="bg-slate-900 dark:bg-slate-700 text-white px-6 py-3 rounded-full shadow-xl font-bold flex items-center gap-2 hover:bg-slate-800 dark:hover:bg-slate-600 transition-transform hover:scale-105"
            >
                <ShieldCheck size={20} /> {user.role === 'ADMIN' ? 'Super Admin' : 'Painel Loja'}
            </button>
          ) : (user && user.role !== 'GUEST' && user.role !== 'COURIER' && (
              <button 
                onClick={() => setCurrentView(ViewState.CLIENT_ORDERS)}
                className="bg-white dark:bg-slate-800 text-slate-800 dark:text-white px-6 py-3 rounded-full shadow-xl font-bold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 transition-transform hover:scale-105"
              >
                  <ClipboardList size={20} /> Meus Pedidos
              </button>
          ))}
        </div>
      )}
      
      <CartDrawer 
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          cartItems={cartItems}
          store={selectedStore}
          onRemoveItem={handleRemoveFromCart}
          onClearCart={handleClearCart}
          onCheckout={handleCheckout}
      />

      <LocationModal 
        isOpen={isLocationModalOpen} 
        onClose={handleCloseLocationModal}
        onSelectAddress={setCurrentAddressObj}
        onSaveAddress={handleSaveAddress}
        savedAddresses={savedAddresses}
        canClose={!!currentAddressObj} 
      />

      {isOrderLookupOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Acompanhar pedido</h3>
                <p className="text-xs text-slate-500">Informe o telefone usado no pedido.</p>
              </div>
              <button
                onClick={() => setIsOrderLookupOpen(false)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <input
                type="tel"
                placeholder="(11) 99999-9999"
                value={orderLookupPhone}
                onChange={(e) => {
                  setOrderLookupPhone(e.target.value);
                  setOrderLookupError('');
                }}
                className={`w-full p-4 rounded-2xl border bg-slate-50 dark:bg-slate-800 dark:text-white outline-none focus:ring-2 ${orderLookupError ? 'border-red-500 focus:ring-red-200' : 'border-slate-200 dark:border-slate-700 focus:ring-red-500'}`}
              />
              {orderLookupError && <p className="text-xs text-red-600 font-bold">{orderLookupError}</p>}
              <button
                onClick={handleConfirmOrderLookup}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-2xl shadow-lg shadow-red-600/20 moving-border"
                style={{ '--moving-border-bg': '#dc2626' } as React.CSSProperties}
              >
                Ver pedidos
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-grow">
         {currentView === ViewState.STORE_DETAILS && selectedStore ? (
            <StoreDetails 
                store={selectedStore} 
                onBack={() => setCurrentView(ViewState.HOME)}
                onAddToCart={handleAddToCart}
                cartItems={cartItems}
                onRemoveFromCart={handleRemoveFromCart}
                onClearCart={handleClearCart}
                onOpenCart={() => setIsCartOpen(true)}
                address={currentAddressObj}
                tableNumber={tableContext?.storeId === selectedStore.id ? tableContext.tableNumber : undefined}
                onTrackTable={() => setCurrentView(ViewState.TABLE_TRACKING)}
                isFavorited={favoriteStoreIds.includes(selectedStore.id)}
                onToggleFavorite={() => toggleFavorite(selectedStore.id)}
                initialProductId={pendingProductId || undefined}
                onProductOpened={() => setPendingProductId(null)}
            />
         ) : (
             <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
              <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-rose-50/80 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-10 shadow-sm mb-10">
                <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-red-200/40 blur-3xl dark:bg-red-900/20" />
                <div className="pointer-events-none absolute -bottom-20 -left-12 h-52 w-52 rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-900/20" />
                <div className="relative grid lg:grid-cols-[1.1fr,0.9fr] gap-8 items-center">
                  <div>
                    <span className="text-xs font-bold tracking-[0.2em] text-red-500 uppercase">MenuFaz</span>
                    <h1 className="text-3xl md:text-5xl font-extrabold text-slate-900 dark:text-white mt-3 leading-tight font-display">
                      O que voce quer pedir hoje?
                    </h1>
                    <p className="text-sm md:text-base text-slate-500 dark:text-slate-400 mt-3 max-w-xl">
                      Descubra lojas perto de voce e finalize em poucos toques. Sem friccao, com foco no sabor.
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                        {currentAddressObj ? `Entregando em ${currentAddressObj.city || 'sua cidade'}` : 'Escolha sua localizacao'}
                      </div>
                      <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                        {stores.length} lojas ativas
                      </div>
                    </div>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <a
                        href="#stores-section"
                        className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-bold transition-colors inline-flex items-center gap-2 shadow-lg shadow-red-600/30"
                      >
                        Explorar lojas <ArrowRight size={18} />
                      </a>
                      <button
                        onClick={() => setIsLocationModalOpen(true)}
                        className="bg-white dark:bg-slate-800 text-slate-700 dark:text-white border border-slate-200 dark:border-slate-700 px-6 py-3 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        Ajustar local
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-4">
                    <div className="bg-white/90 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Destaques de agora</p>
                      <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2 font-display">
                        {filteredStores.length > 0 ? `${filteredStores.length} opcoes para voce` : 'Nenhuma loja para esta categoria'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Escolha uma categoria e aproveite a melhor selecao perto de voce.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-4">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Entrega</p>
                        <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-2 font-display">Ultra rapida</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Tempo medio reduzido</p>
                      </div>
                      <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-4">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Retirada</p>
                        <p className="text-xl font-extrabold text-slate-900 dark:text-white mt-2 font-display">Sem fila</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Agilidade na retirada</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <AIRecommendation onCategorySelect={handleCategorySelect} onProductSelect={handleAiProductSelect} />
              
              <section className="mb-12">
                <div className="flex items-end justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white font-display">Categorias</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Explore por tipo de comida.</p>
                  </div>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-1">
                   <button 
                      onClick={() => setSelectedCategory('Todos')}
                      className={`flex flex-col items-center min-w-[90px] gap-2 p-3 rounded-2xl transition-all border ${selectedCategory === 'Todos' ? 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800 transform scale-105 shadow-sm' : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 hover:border-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-2xl shadow-sm">
                        🏠
                      </div>
                      <span className={`text-sm font-semibold ${selectedCategory === 'Todos' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>Todos</span>
                    </button>
                  {CATEGORIES.map((cat) => (
                    <button 
                      key={cat.id} 
                      onClick={() => setSelectedCategory(cat.name)}
                      className={`flex flex-col items-center min-w-[90px] gap-2 p-3 rounded-2xl transition-all border ${selectedCategory === cat.name ? 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800 transform scale-105 shadow-sm' : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 hover:border-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-2xl shadow-sm">
                        {cat.icon}
                      </div>
                      <span className={`text-sm font-semibold ${selectedCategory === cat.name ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>{cat.name}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Stores Grid */}
              <section id="stores-section" className="mb-12">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <div className="flex flex-col">
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white font-display">
                        {globalSearchTerm ? `Resultados para "${globalSearchTerm}"` : (selectedCategory === 'Todos' ? 'Lojas Próximas' : `Melhores em ${selectedCategory}`)}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                         {currentAddressObj 
                                ? `Mostrando lojas em ${currentAddressObj.city || 'sua cidade'}.`
                                : `Mostrando todas as lojas cadastradas.`}
                      </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="px-3 py-1.5 rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-600">
                      {filteredStores.length} resultados
                    </div>
                    {(globalSearchTerm || selectedCategory !== 'Todos') && (
                      <button
                        onClick={() => {
                          setGlobalSearchTerm('');
                          setSelectedCategory('Todos');
                        }}
                        className="px-3 py-1.5 rounded-full border border-red-200 bg-red-50 text-xs font-bold text-red-600 hover:bg-red-100 transition-colors"
                      >
                        Limpar filtros
                      </button>
                    )}
                  </div>
                </div>
                
                {filteredStores.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in">
                    {filteredStores.map(store => (
                      <StoreCard 
                        key={store.id} 
                        store={store} 
                        onClick={handleStoreClick}
                        isFavorited={favoriteStoreIds.includes(store.id)}
                        onToggleFavorite={() => toggleFavorite(store.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-800 rounded-3xl border border-dashed border-gray-200 dark:border-slate-700 shadow-sm text-center p-8">
                      <div className="w-20 h-20 bg-gray-50 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4 text-gray-300 dark:text-gray-500">
                        <MapPinOff size={40} />
                      </div>
                      <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2 font-display">
                          Nenhuma loja encontrada
                      </h3>
                      <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                          {currentAddressObj 
                            ? `Não encontramos lojas ativas em ${currentAddressObj.city} para esta categoria.` 
                            : "Não encontramos lojas para esta categoria."}
                      </p>
                  </div>
                )}
              </section>
              
              <div className="bg-slate-900 dark:bg-slate-800 rounded-2xl p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8 text-white overflow-hidden relative shadow-2xl border border-slate-800 dark:border-slate-700">
                 <div className="relative z-10 max-w-lg">
                     <h2 className="text-3xl font-bold mb-4">Tem um estabelecimento?</h2>
                     <p className="text-gray-300 mb-6">Cadastre seu restaurante no MenuFaz e alcance milhares de novos clientes na sua região. Taxa zero no primeiro mês.</p>
                     <button 
                        onClick={() => setCurrentView(ViewState.REGISTER_BUSINESS)}
                        className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-lg font-bold transition-colors inline-flex items-center gap-2 shadow-lg hover:-translate-y-1"
                     >
                         Cadastrar Agora <ArrowRight size={18} />
                     </button>
                 </div>
                 {/* ... (Banner visuals same as before) ... */}
              </div>
            </div>
         )}
      </main>

      {currentView !== ViewState.STORE_DETAILS && currentView !== ViewState.CHECKOUT && (
          <footer className="bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 py-12 mt-auto transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-2">
                 <div className="w-8 h-8 bg-red-50 dark:bg-red-900/30 rounded-lg flex items-center justify-center text-red-600 dark:text-red-400">
                   <ShoppingBag size={18} />
                 </div>
                 <span className="font-bold text-gray-800 dark:text-white">MenuFaz © 2025</span>
              </div>
              <div className="flex gap-6 text-sm text-gray-500 dark:text-gray-400">
                <a href="#" className="hover:text-red-600 dark:hover:text-red-400 transition-colors">Termos de Uso</a>
                <a href="#" className="hover:text-red-600 dark:hover:text-red-400 transition-colors">Privacidade</a>
              </div>
            </div>
          </footer>
      )}
    </div>
  );
};

const App: React.FC = () => {
    return (
        <AuthProvider>
            <MenuFazApp />
        </AuthProvider>
    );
};

export default App;
