
import React, { useState, useMemo, useEffect } from 'react';
import Header from './components/Header';
import StoreCard from './components/StoreCard';
import AIRecommendation from './components/AIRecommendation';
import AdminDashboard from './components/AdminDashboard';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import CourierDashboard from './components/CourierDashboard';
import RegisterBusiness from './components/RegisterBusiness';
import Login from './components/Login';
import LocationModal from './components/LocationModal';
import StoreDetails from './components/StoreDetails';
import CartDrawer from './components/CartDrawer'; 
import ClientOrders from './components/ClientOrders'; 
import Checkout from './components/Checkout';
import ClientProfile from './components/ClientProfile';
import FinishSignup from './components/FinishSignup'; // Import
import { ViewState, Address, UserRole, Store, CartItem } from './types';
import { CATEGORIES } from './constants';
import { calculateDistance } from './utils/geo';
import { ArrowRight, ChevronRight, ShoppingBag, MapPinOff, Loader2, ShieldCheck, ClipboardList } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { getStores } from './services/db';

// Inner App Component to access AuthContext
const MenuFazApp: React.FC = () => {
  const { user, loading: authLoading, logout } = useAuth();
  const [currentView, setCurrentView] = useState<ViewState>(ViewState.HOME);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const [globalSearchTerm, setGlobalSearchTerm] = useState<string>('');
  
  // Store Selection State
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);

  // Admin Impersonation State
  const [adminTargetStoreId, setAdminTargetStoreId] = useState<string | null>(null);

  // Cart State
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Location State
  const [currentAddressObj, setCurrentAddressObj] = useState<Address | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(true);
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);
  
  // Signup Flow State
  const [pendingSignupRequestId, setPendingSignupRequestId] = useState<string | null>(null);

  // Remove max radius limit as requested. We will filter by City.
  // const MAX_DELIVERY_RADIUS = 10.0; 

  const currentAddressString = currentAddressObj 
    ? `${currentAddressObj.street}${currentAddressObj.number ? `, ${currentAddressObj.number}` : ''}` 
    : 'Selecione um endereço';

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
        window.history.replaceState({}, document.title, window.location.pathname);
    }

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
          } else if (currentView === ViewState.ADMIN || currentView === ViewState.CLIENT_ORDERS || currentView === ViewState.CLIENT_PROFILE || currentView === ViewState.COURIER_DASHBOARD) {
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
    if (currentAddressObj) {
      setIsLocationModalOpen(false);
    }
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
      if (!user) {
          setCurrentView(ViewState.LOGIN);
      } else {
          setCurrentView(ViewState.CHECKOUT);
      }
  };

  const handleOrderPlaced = () => {
      setCartItems([]);
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

  const filteredStores = useMemo(() => {
    if (!currentAddressObj) return [];

    let filtered = stores;

    // Calculate distance for sorting but NOT for strict filtering by radius (as requested by user)
    // Filter by City Match instead
    const normalize = (s: string) => s?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() || "";
    const userCity = normalize(currentAddressObj.city || "");

    filtered = filtered.map(store => {
        const distance = calculateDistance(currentAddressObj.coordinates, store.coordinates);
        return { ...store, _distance: distance }; 
    });

    // Apply City Filter if user has a city defined.
    // If user doesn't have city (legacy address), we might fallback to radius or show all.
    // User request: "localizar todos os estabelecimentos cadastrado na cidade especifica"
    if (userCity) {
        filtered = filtered.filter(store => {
            const storeCity = normalize(store.city || "");
            return storeCity === userCity;
        });
    }

    // Sort by distance
    filtered.sort((a: any, b: any) => a._distance - b._distance);

    if (selectedCategory !== 'Todos') {
        filtered = filtered.filter(store => store.category === selectedCategory);
    }

    if (globalSearchTerm.trim()) {
        const lowerTerm = globalSearchTerm.toLowerCase();
        filtered = filtered.filter(store => {
            const nameMatch = store.name.toLowerCase().includes(lowerTerm);
            return nameMatch;
        });
    }
    
    return filtered;
  }, [selectedCategory, currentAddressObj, globalSearchTerm, stores]);

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

  if (currentView === ViewState.ADMIN) {
    // If Super Admin AND NOT managing a specific store -> Show Super Dashboard
    if (user?.role === 'ADMIN' && !adminTargetStoreId) {
        return <SuperAdminDashboard onLogout={handleLogout} onManageStore={handleSuperAdminManageStore} />;
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
      return (
          <Checkout 
            store={selectedStore}
            cartItems={cartItems}
            address={currentAddressObj}
            onBack={() => setCurrentView(ViewState.STORE_DETAILS)}
            onOrderPlaced={handleOrderPlaced}
            onChangeAddress={() => setIsLocationModalOpen(true)}
          />
      );
  }

  return (
    <div className="min-h-screen flex flex-col text-gray-800 dark:text-gray-100 font-sans bg-gray-50/50 dark:bg-slate-900 transition-colors duration-300">
      <Header 
        currentView={currentView} 
        onNavigate={setCurrentView} 
        onOpenLocation={() => setIsLocationModalOpen(true)}
        currentAddress={currentAddressString}
        userRole={user?.role || 'GUEST'}
        userName={user?.name}
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        cartItemCount={cartCount}
        cartTotal={cartTotal}
        onOpenCart={() => setIsCartOpen(true)}
        onSearch={setGlobalSearchTerm}
      />

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
            />
         ) : (
             <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10">
              <AIRecommendation onCategorySelect={handleCategorySelect} />
              
              {/* Categories */}
              <div className="mb-12">
                <div className="flex justify-between items-end mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Categorias</h2>
                </div>
                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide px-1">
                   <button 
                      onClick={() => setSelectedCategory('Todos')}
                      className={`flex flex-col items-center min-w-[80px] gap-2 p-3 rounded-xl transition-all border ${selectedCategory === 'Todos' ? 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800 transform scale-105 shadow-sm' : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 hover:border-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-2xl shadow-sm">
                        🏠
                      </div>
                      <span className={`text-sm font-medium ${selectedCategory === 'Todos' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>Todos</span>
                    </button>
                  {CATEGORIES.map((cat) => (
                    <button 
                      key={cat.id} 
                      onClick={() => setSelectedCategory(cat.name)}
                      className={`flex flex-col items-center min-w-[80px] gap-2 p-3 rounded-xl transition-all border ${selectedCategory === cat.name ? 'bg-red-50 border-red-200 dark:bg-red-900/30 dark:border-red-800 transform scale-105 shadow-sm' : 'bg-white dark:bg-slate-800 border-gray-100 dark:border-slate-700 hover:border-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700'}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-2xl shadow-sm">
                        {cat.icon}
                      </div>
                      <span className={`text-sm font-medium ${selectedCategory === cat.name ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>{cat.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Stores Grid */}
              <section id="stores-section" className="mb-12">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex flex-col">
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {globalSearchTerm ? `Resultados para "${globalSearchTerm}"` : (selectedCategory === 'Todos' ? 'Lojas Próximas' : `Melhores em ${selectedCategory}`)}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                         {currentAddressObj 
                                ? `Mostrando lojas em ${currentAddressObj.city || 'sua cidade'}.`
                                : `Informe seu endereço para ver as lojas.`}
                      </p>
                  </div>
                </div>
                
                {filteredStores.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in">
                    {filteredStores.map(store => (
                      <StoreCard 
                        key={store.id} 
                        store={store} 
                        onClick={handleStoreClick}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-slate-800 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 shadow-sm text-center p-8">
                      <div className="w-20 h-20 bg-gray-50 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4 text-gray-300 dark:text-gray-500">
                        <MapPinOff size={40} />
                      </div>
                      <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-2">
                          {!currentAddressObj ? "Onde você está?" : "Nenhuma loja encontrada"}
                      </h3>
                      <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
                          {!currentAddressObj 
                            ? "Precisamos saber seu endereço para mostrar os melhores restaurantes perto de você." 
                            : `Não encontramos lojas ativas em ${currentAddressObj.city} para esta categoria.`}
                      </p>
                      {!currentAddressObj && (
                         <div className="flex gap-3">
                            <button 
                                onClick={() => setIsLocationModalOpen(true)}
                                className="px-6 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                            >
                                Informar Endereço
                            </button>
                         </div>
                      )}
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
