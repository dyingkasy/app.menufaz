
import React, { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Star, Clock, Search, Plus, Minus, Info, ChevronRight, MapPin, Heart, Share2, Sparkles, Bike, ShoppingBag, X, Slice, Check, Layers, Database, Lock, Utensils } from 'lucide-react';
import { Store, Product, CartItem, Review, PizzaFlavor } from '../types';
import { getProductsByStore, getPizzaFlavorsByStore } from '../services/db';
import { formatCurrencyBRL } from '../utils/format';
import StoreReviews from './StoreReviews';

interface StoreDetailsProps {
  store: Store;
  onBack: () => void;
  onAddToCart: (item: CartItem) => void;
  cartItems: CartItem[];
  onRemoveFromCart: (id: string) => void;
  onClearCart: () => void;
  onOpenCart: () => void; 
  tableNumber?: string;
  onTrackTable?: () => void;
}

const StoreDetails: React.FC<StoreDetailsProps> = ({ 
    store, 
    onBack, 
    onAddToCart, 
    cartItems, 
    onOpenCart,
    tableNumber,
    onTrackTable
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [storeProducts, setStoreProducts] = useState<Product[]>([]);
  const [storeFlavors, setStoreFlavors] = useState<PizzaFlavor[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  
  // Scroll logic
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
      const handleScroll = () => setScrolled(window.scrollY > 200);
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Load Products & Flavors from DB
  useEffect(() => {
      const loadData = async () => {
          try {
              const products = await getProductsByStore(store.id);
              const flavors = await getPizzaFlavorsByStore(store.id);
              setStoreProducts(
                  products.map((product) => ({
                      ...product,
                      category: product.category || 'Lanches',
                      isAvailable: product.isAvailable ?? true
                  }))
              );
              setStoreFlavors(flavors);
          } catch (e) {
              console.error("Erro ao carregar dados da loja", e);
          } finally {
              setLoadingProducts(false);
          }
      };
      loadData();
  }, [store.id]);

  // Product Modal State
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState('');

  // Pizza State
  const [splitCount, setSplitCount] = useState(1);
  const [selectedFlavorIds, setSelectedFlavorIds] = useState<(string | null)[]>([]); 
  const [selectingFlavorIndex, setSelectingFlavorIndex] = useState<number | null>(null); 

  // Reviews
  const [reviews, setReviews] = useState<Review[]>([]); 

  const handleAddReview = (rating: number, comment: string) => {
      // Placeholder
  };

  // Group products
  const categories = useMemo(() => {
      const cats = new Set(storeProducts.map(p => p.category));
      return Array.from(cats);
  }, [storeProducts]);

  // Filtered by search
  const displayProducts = useMemo(() => {
      if (!searchTerm) return storeProducts;
      return storeProducts.filter(p => (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()));
  }, [storeProducts, searchTerm]);

  // Available flavors for the *currently selected product*
  const validFlavorsForCurrentProduct = useMemo(() => {
      if (!selectedProduct || !selectedProduct.isPizza) return [];
      
      // First, filter only active flavors defined by the store
      const activeStoreFlavors = storeFlavors.filter(f => f.isAvailable !== false);

      if (!selectedProduct.availableFlavorIds || selectedProduct.availableFlavorIds.length === 0) {
          return activeStoreFlavors;
      }
      
      const allowedFlavors = activeStoreFlavors.filter(f => selectedProduct.availableFlavorIds!.includes(f.id));
      return allowedFlavors.length > 0 ? allowedFlavors : activeStoreFlavors;
  }, [selectedProduct, storeFlavors]);

  // --- HANDLERS ---

  const handleOpenProduct = (product: Product) => {
      setSelectedProduct(product);
      setQuantity(1);
      setSelectedOptions({});
      setNotes('');
      
      // Reset Pizza State
      setSplitCount(1);
      setSelectedFlavorIds([null, null, null, null]); 
      setSelectingFlavorIndex(null);
  };

  const handleCloseProduct = () => {
      setSelectedProduct(null);
  };

  const handleOptionToggle = (groupId: string, optionId: string, max: number) => {
      setSelectedOptions(prev => {
          const current = prev[groupId] || [];
          if (max === 1) {
              if (current.includes(optionId)) return prev; 
              return { ...prev, [groupId]: [optionId] };
          }
          if (current.includes(optionId)) {
              return { ...prev, [groupId]: current.filter(id => id !== optionId) };
          }
          if (current.length < max) {
              return { ...prev, [groupId]: [...current, optionId] };
          }
          return prev; 
      });
  };

  const calculateTotal = () => {
      if (!selectedProduct) return 0;
      
      let basePrice = selectedProduct.promoPrice || selectedProduct.price;
      
      if (selectedProduct.isPizza && splitCount > 1) {
          const surcharge = selectedProduct.splitSurcharge || 0;
          basePrice += surcharge;
      }
      
      let optionsTotal = 0;
      selectedProduct.optionGroups.forEach(group => {
          const selectedIds = selectedOptions[group.id] || [];
          selectedIds.forEach(optId => {
              const opt = group.options.find(o => o.id === optId);
              if (opt) optionsTotal += opt.price;
          });
      });
      
      return (basePrice + optionsTotal) * quantity;
  };

  const handleConfirmAdd = () => {
      if (!selectedProduct) return;

      // Validate Pizza Splits
      if (selectedProduct.isPizza) {
          for(let i=0; i < splitCount; i++) {
              if (!selectedFlavorIds[i]) {
                  if ((selectedProduct.maxFlavors || 1) > 1 || validFlavorsForCurrentProduct.length > 0) {
                       alert(`Por favor, escolha o Sabor ${i+1}.`);
                       return;
                  }
              }
          }
      }

      for (const group of selectedProduct.optionGroups) {
          const selectedCount = (selectedOptions[group.id] || []).length;
          if (selectedCount < group.min) {
              alert(`Por favor, selecione pelo menos ${group.min} opção(ões) em "${group.name}"`);
              return;
          }
      }

      const optionsSummary: { groupName: string; optionName: string; price: number }[] = [];
      selectedProduct.optionGroups.forEach(group => {
          const selectedIds = selectedOptions[group.id] || [];
          selectedIds.forEach(optId => {
              const opt = group.options.find(o => o.id === optId);
              if (opt) {
                  optionsSummary.push({
                      groupName: group.name,
                      optionName: opt.name,
                      price: opt.price
                  });
              }
          });
      });

      // Construct Item Name
      let finalName = selectedProduct.name;
      if (selectedProduct.isPizza) {
          const selectedFlavorNames = selectedFlavorIds
              .slice(0, splitCount)
              .map(id => storeFlavors.find(f => f.id === id)?.name)
              .filter(Boolean);
          
          if (selectedFlavorNames.length > 0) {
              if (splitCount === 1) {
                  finalName = `${selectedProduct.name} - ${selectedFlavorNames[0]}`;
              } else {
                  finalName = `${selectedProduct.name} (${splitCount} Sabores): ${selectedFlavorNames.join(' / ')}`;
              }
          }
      }

      const productForCart = { ...selectedProduct, name: finalName };

      const cartItem: CartItem = {
          id: Date.now().toString(),
          product: productForCart,
          quantity,
          options: optionsSummary,
          notes,
          totalPrice: calculateTotal()
      };

      onAddToCart(cartItem);
      handleCloseProduct();
      onOpenCart(); 
  };

  const deliveryFee = Number(store.deliveryFee) || 0;
  const cartSubtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const cartTotal = cartSubtotal + deliveryFee;

  const pickupTime = store.pickupTime || '';

  const scrollToSection = (id: string) => {
      const el = document.getElementById(id);
      if (el) {
          const headerOffset = 180;
          const elementPosition = el.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
          window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
  };

  const handleSelectFlavor = (flavorId: string) => {
      if (selectingFlavorIndex !== null) {
          const newFlavorIds = [...selectedFlavorIds];
          newFlavorIds[selectingFlavorIndex] = flavorId;
          setSelectedFlavorIds(newFlavorIds);
          setSelectingFlavorIndex(null); 
      }
  };

  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen pb-24 font-sans">
        {/* Navbar */}
        <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white dark:bg-slate-900 shadow-md py-2' : 'bg-transparent py-4'}`}>
            <div className="max-w-5xl mx-auto px-4 flex justify-between items-center">
                <button 
                    onClick={onBack}
                    className={`p-2 rounded-full transition-colors ${scrolled ? 'text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-800' : 'bg-black/30 text-white hover:bg-black/50 backdrop-blur-md'}`}
                >
                    <ArrowLeft size={20} />
                </button>
                {scrolled && (
                    <span className="font-bold text-gray-800 dark:text-white truncate max-w-[200px] animate-fade-in">
                        {store.name}
                    </span>
                )}
                <div className="flex gap-2">
                    <button className={`p-2 rounded-full transition-colors ${scrolled ? 'text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-800' : 'bg-black/30 text-white hover:bg-black/50 backdrop-blur-md'}`}>
                        <Search size={20} />
                    </button>
                </div>
            </div>
        </nav>

        {/* Hero Banner */}
        <div className="relative bg-white dark:bg-slate-900 mb-4 pb-4">
            <div className="h-[280px] md:h-[350px] w-full relative">
                <img src={store.imageUrl} alt={store.name} className={`w-full h-full object-cover ${!store.isActive ? 'grayscale' : ''}`} />
                <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />
            </div>
            
            <div className="max-w-5xl mx-auto px-4 relative -mt-16 md:-mt-20 z-10">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-6 border border-gray-100 dark:border-slate-800">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-4">
                            {store.logoUrl && (
                                <img
                                    src={store.logoUrl}
                                    alt={`Logo ${store.name}`}
                                    className="w-14 h-14 rounded-full border border-white/80 shadow-md object-cover"
                                />
                            )}
                            <h1 className="text-2xl md:text-4xl font-extrabold text-slate-800 dark:text-white leading-tight">
                                {store.name}
                            </h1>
                        </div>
                        <button className="p-2 bg-gray-50 dark:bg-slate-800 rounded-full text-gray-400 hover:text-red-500 transition-colors">
                            <Heart size={24} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-sm text-gray-600 dark:text-gray-300 mb-4">
                         <span className="flex items-center gap-1 text-yellow-500 font-bold bg-yellow-50 dark:bg-yellow-900/20 px-2 py-0.5 rounded-lg">
                             <Star size={14} fill="currentColor"/> {store.rating}
                         </span>
                         <span className="flex items-center gap-1">
                             <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                             {store.category}
                         </span>
                         <span className="flex items-center gap-1">
                             <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                             <MapPin size={14} /> 2.4km
                         </span>
                    </div>

                    <div className="flex items-center gap-4 pt-4 border-t border-gray-100 dark:border-slate-800">
                        <div className="flex-1">
                            <p className="text-xs text-gray-400 uppercase font-bold mb-1">Entrega</p>
                            <div className="flex items-center gap-1 font-bold text-slate-800 dark:text-white">
                                <Clock size={16} className="text-gray-400" /> {store.deliveryTime}
                            </div>
                        </div>
                        {store.acceptsPickup && pickupTime && (
                            <>
                                <div className="w-px h-8 bg-gray-100 dark:bg-slate-800"></div>
                                <div className="flex-1">
                                    <p className="text-xs text-gray-400 uppercase font-bold mb-1">Retirada</p>
                                    <div className="flex items-center gap-1 font-bold text-slate-800 dark:text-white">
                                        <Clock size={16} className="text-gray-400" /> {pickupTime}
                                    </div>
                                </div>
                            </>
                        )}
                        <div className="w-px h-8 bg-gray-100 dark:bg-slate-800"></div>
                        <div className="flex-1">
                            <p className="text-xs text-gray-400 uppercase font-bold mb-1">Taxa</p>
                            <div className="font-bold text-green-600">
                                {deliveryFee === 0 ? 'Grátis' : formatCurrencyBRL(deliveryFee)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {tableNumber && onTrackTable && (
            <div className="max-w-5xl mx-auto px-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center justify-center">
                            <Utensils size={20} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase">Mesa</p>
                            <p className="text-lg font-extrabold text-slate-800 dark:text-white">{tableNumber}</p>
                        </div>
                    </div>
                    <button
                        onClick={onTrackTable}
                        className="bg-slate-900 text-white px-4 py-2 rounded-xl font-bold hover:opacity-90 shadow-sm"
                    >
                        Acompanhar mesa
                    </button>
                </div>
            </div>
        )}

        {/* Sticky Categories */}
        <div className="sticky top-[60px] z-40 bg-gray-50/95 dark:bg-slate-950/95 backdrop-blur-sm border-b border-gray-200 dark:border-slate-800">
             <div className="max-w-5xl mx-auto">
                <div className="flex gap-6 overflow-x-auto scrollbar-hide px-4 py-3">
                    {categories.map(cat => (
                        <button 
                            key={cat}
                            onClick={() => scrollToSection(`cat-${cat}`)}
                            className="whitespace-nowrap text-sm font-bold text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-white transition-colors pb-1 border-b-2 border-transparent hover:border-red-600"
                        >
                            {cat}
                        </button>
                    ))}
                </div>
             </div>
        </div>

        {/* Content */}
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-10">
            {/* Closed Warning Banner */}
            {!store.isActive && (
                <div className="bg-red-600 text-white p-4 rounded-xl flex items-center gap-3 shadow-lg mb-6 animate-bounce-subtle">
                    <Lock size={24} />
                    <div>
                        <h3 className="font-bold text-lg">Loja Fechada</h3>
                        <p className="text-sm opacity-90">Este estabelecimento não está recebendo pedidos no momento.</p>
                    </div>
                </div>
            )}
            
            {/* Products List */}
            {loadingProducts ? (
                <div className="py-20 text-center text-gray-500">Carregando cardápio...</div>
            ) : (
                categories.map(cat => {
                    const catProducts = displayProducts.filter(
                        p => p.category === cat && (p.isAvailable ?? true)
                    ); // Only show available products
                    if (catProducts.length === 0) return null;

                    return (
                        <div key={cat} id={`cat-${cat}`} className="scroll-mt-32 animate-fade-in">
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4 pb-2 border-b border-gray-200 dark:border-slate-800">
                                {cat}
                            </h2>
                            <div className="grid md:grid-cols-2 gap-6">
                                {catProducts.map(product => (
                                    <div 
                                        key={product.id}
                                        onClick={() => handleOpenProduct(product)}
                                        className="bg-white dark:bg-slate-900 rounded-xl p-4 flex gap-4 cursor-pointer border border-transparent hover:border-gray-200 dark:hover:border-slate-700 shadow-sm hover:shadow-lg transition-all group"
                                    >
                                        <div className="flex-1 flex flex-col">
                                            <h3 className="font-bold text-slate-800 dark:text-white mb-1 text-lg group-hover:text-red-600 transition-colors">{product.name}</h3>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-3 flex-grow leading-relaxed">
                                                {product.description}
                                            </p>
                                            <div className="flex items-center gap-2 mt-auto">
                                                {product.promoPrice ? (
                                                    <>
                                                        <span className="text-green-600 font-bold">{formatCurrencyBRL(product.promoPrice)}</span>
                                                        <span className="text-xs text-gray-400 line-through">{formatCurrencyBRL(product.price)}</span>
                                                    </>
                                                ) : (
                                                    <span className="text-slate-700 dark:text-gray-200 font-medium">{formatCurrencyBRL(product.price)}</span>
                                                )}
                                                {product.isPizza && product.maxFlavors && product.maxFlavors > 1 && (
                                                    <span className="text-[10px] bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 px-2 py-0.5 rounded-full flex items-center gap-1 font-bold">
                                                        <Slice size={10} /> Até {product.maxFlavors} Sabores
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="w-32 h-32 flex-shrink-0 rounded-xl overflow-hidden relative bg-gray-100 dark:bg-slate-800">
                                            {product.imageUrl ? (
                                                <img 
                                                    src={product.imageUrl} 
                                                    alt={product.name} 
                                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                    <ShoppingBag />
                                                </div>
                                            )}
                                            <div className="absolute bottom-2 right-2 bg-white dark:bg-slate-800 rounded-full p-1.5 shadow-md opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
                                                <Plus size={16} className="text-red-600" />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })
            )}
        </div>

        {/* Floating Cart Button (Mobile/All) */}
        {cartItems.length > 0 && (
            <div className="fixed bottom-6 left-0 w-full px-4 z-40 pointer-events-none">
                <button 
                    onClick={onOpenCart}
                    className="pointer-events-auto w-full max-w-3xl mx-auto bg-red-600 hover:bg-red-700 text-white p-4 rounded-2xl shadow-xl shadow-red-900/30 flex justify-between items-center font-bold transform hover:-translate-y-1 transition-all"
                >
                    <div className="flex items-center gap-3">
                        <div className="bg-red-800 w-8 h-8 rounded-full flex items-center justify-center text-xs animate-bounce-subtle">
                            {cartItems.reduce((acc, item) => acc + item.quantity, 0)}
                        </div>
                        <span>Ver Sacola</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span>{formatCurrencyBRL(cartTotal)}</span>
                        <ChevronRight size={18} className="opacity-80" />
                    </div>
                </button>
            </div>
        )}

        {/* Product Detail Modal */}
        {selectedProduct && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
                <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={handleCloseProduct} />
                <div className="bg-white dark:bg-slate-900 w-full max-w-xl max-h-[90vh] rounded-3xl relative z-10 flex flex-col overflow-hidden animate-scale-in shadow-2xl">
                    
                    {/* Main Scroll Area */}
                    <div className="flex-1 overflow-y-auto scrollbar-hide relative">
                         {/* Image Header */}
                         <div className="relative h-64">
                            <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-full h-full object-cover" />
                            <button 
                                onClick={handleCloseProduct} 
                                className="absolute top-4 right-4 bg-white/20 backdrop-blur-md text-white hover:bg-white/40 p-2 rounded-full transition-colors"
                            >
                                <X size={20}/>
                            </button>
                         </div>
                         
                         <div className="p-6 -mt-6 bg-white dark:bg-slate-900 rounded-t-3xl relative z-10">
                             <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white mb-2 leading-tight">{selectedProduct.name}</h2>
                             <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 leading-relaxed">{selectedProduct.description}</p>
                             
                             <div className="flex items-center justify-between mb-8 p-4 bg-green-50 dark:bg-green-900/10 rounded-xl border border-green-100 dark:border-green-900/30">
                                 <span className="text-sm font-bold text-green-800 dark:text-green-400">Preço do item</span>
                                 <span className="text-2xl font-extrabold text-green-600">
                                     {formatCurrencyBRL(calculateTotal())}
                                 </span>
                             </div>

                             {/* PIZZA FLAVOR CONFIGURATION */}
                             {selectedProduct.isPizza && (
                                 <div className="mb-8 animate-fade-in bg-orange-50 dark:bg-orange-900/10 p-5 rounded-2xl border border-orange-100 dark:border-orange-900/30">
                                     <div className="flex justify-between items-center mb-4">
                                         <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-lg">
                                             <Slice size={20} className="text-orange-500"/> Dividir Pizza
                                         </h3>
                                     </div>

                                     {/* PIZZA VISUALIZATION FOR CUSTOMER */}
                                     <div className="flex justify-center mb-6">
                                         <div className="w-32 h-32">
                                              <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
                                                  <circle cx="50" cy="50" r="48" fill="white" stroke="#333" strokeWidth="2" />
                                                  {splitCount >= 2 && <line x1="50" y1="2" x2="50" y2="98" stroke="#333" strokeWidth="2" />}
                                                  {splitCount === 3 && (
                                                      <>
                                                          <circle cx="50" cy="50" r="48" fill="white" stroke="#333" strokeWidth="2" />
                                                          <line x1="50" y1="50" x2="50" y2="2" stroke="#333" strokeWidth="2" />
                                                          <line x1="50" y1="50" x2="91.5" y2="74" stroke="#333" strokeWidth="2" />
                                                          <line x1="50" y1="50" x2="8.5" y2="74" stroke="#333" strokeWidth="2" />
                                                      </>
                                                  )}
                                                  {splitCount === 4 && <line x1="2" y1="50" x2="98" y2="50" stroke="#333" strokeWidth="2" />}
                                                  <circle cx="50" cy="50" r="42" fill="none" stroke="#ddd" strokeWidth="1" strokeDasharray="4 2" />
                                              </svg>
                                         </div>
                                     </div>
                                     
                                     {/* Selector Buttons (Only show up to maxFlavors) */}
                                     {(selectedProduct.maxFlavors || 1) > 1 && (
                                         <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                                             {[1, 2, 3, 4].filter(n => n <= (selectedProduct.maxFlavors || 1)).map(n => (
                                                 <button
                                                     key={n}
                                                     onClick={() => {
                                                         setSplitCount(n);
                                                         const newFlavorIds = [...selectedFlavorIds];
                                                         for(let i=1; i<4; i++) newFlavorIds[i] = null;
                                                         setSelectedFlavorIds(newFlavorIds);
                                                     }}
                                                     className={`flex-1 min-w-[80px] py-3 rounded-xl font-bold text-sm border transition-all ${
                                                         splitCount === n 
                                                         ? 'bg-orange-600 text-white border-orange-600 shadow-lg shadow-orange-500/20 transform scale-105' 
                                                         : 'bg-white dark:bg-slate-800 text-gray-500 border-gray-200 dark:border-slate-700 hover:bg-orange-50'
                                                     }`}
                                                 >
                                                     {n === 1 ? '1 Sabor' : `${n} Sabores`}
                                                 </button>
                                             ))}
                                         </div>
                                     )}

                                     {/* Flavor Slots */}
                                     <div className="space-y-3">
                                         {Array.from({ length: splitCount }).map((_, idx) => {
                                             const flavorId = selectedFlavorIds[idx];
                                             const flavor = flavorId ? storeFlavors.find(f => f.id === flavorId) : null;
                                             
                                             return (
                                                 <div key={idx} className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
                                                     <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/20 text-orange-600 rounded-full flex items-center justify-center font-bold text-sm">
                                                         {idx + 1}
                                                     </div>
                                                     <div className="flex-1">
                                                         <p className="text-xs text-gray-400 uppercase font-bold mb-0.5">Sabor {idx + 1}</p>
                                                         {flavor ? (
                                                             <p className="font-bold text-slate-800 dark:text-white">{flavor.name}</p>
                                                         ) : (
                                                             <p className="text-slate-400 italic">Selecione um sabor...</p>
                                                         )}
                                                     </div>
                                                     <button 
                                                         onClick={() => setSelectingFlavorIndex(idx)}
                                                         className="px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-orange-100 hover:text-orange-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors"
                                                     >
                                                         {flavor ? 'Trocar' : 'Escolher'}
                                                     </button>
                                                 </div>
                                             );
                                         })}
                                     </div>
                                     
                                     {splitCount > 1 && selectedProduct.splitSurcharge && (
                                         <div className="mt-4 flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 p-2 rounded-lg">
                                             <Info size={14} />
                                            <span>Acréscimo de {formatCurrencyBRL(selectedProduct.splitSurcharge)} por divisão</span>
                                         </div>
                                     )}
                                 </div>
                             )}

                             {/* Visual Separator */}
                             {selectedProduct.optionGroups && selectedProduct.optionGroups.length > 0 && (
                                 <div className="flex items-center gap-4 mb-6">
                                     <div className="h-px bg-gray-200 dark:bg-slate-700 flex-1"></div>
                                     <h4 className="font-bold text-gray-400 uppercase text-xs flex items-center gap-2">
                                         <Layers size={14}/> Adicionais
                                     </h4>
                                     <div className="h-px bg-gray-200 dark:bg-slate-700 flex-1"></div>
                                 </div>
                             )}

                             {/* Options Groups */}
                             <div className="space-y-8">
                                 {selectedProduct.optionGroups?.map(group => (
                                     <div key={group.id}>
                                         <div className="flex justify-between items-end mb-4 bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                                             <div>
                                                 <h3 className="font-bold text-slate-800 dark:text-white text-base uppercase tracking-wide">{group.name}</h3>
                                                 <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                     {group.max === 1 ? 'Selecione 1 opção' : `Selecione até ${group.max} opções`}
                                                 </p>
                                             </div>
                                             {group.min > 0 && (
                                                 <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-gray-300 px-2 py-1 rounded font-bold uppercase">
                                                     Obrigatório
                                                 </span>
                                             )}
                                         </div>
                                         
                                         <div className="space-y-3">
                                             {group.options.map(opt => {
                                                 const isSelected = (selectedOptions[group.id] || []).includes(opt.id);
                                                 return (
                                                     <div 
                                                        key={opt.id} 
                                                        onClick={() => opt.isAvailable && handleOptionToggle(group.id, opt.id, group.max)}
                                                        className={`flex justify-between items-center p-4 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-red-500 bg-red-50 dark:bg-red-900/10 ring-1 ring-red-500' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'} ${!opt.isAvailable ? 'opacity-50 pointer-events-none grayscale' : ''}`}
                                                     >
                                                         <div className="flex items-center gap-4">
                                                             <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'border-red-500' : 'border-gray-300 dark:border-slate-600'}`}>
                                                                 {isSelected && <div className="w-3 h-3 bg-red-500 rounded-full" />}
                                                             </div>
                                                             <div className="flex flex-col">
                                                                 <span className={`font-bold text-sm ${isSelected ? 'text-red-700 dark:text-red-400' : 'text-slate-700 dark:text-gray-200'}`}>{opt.name}</span>
                                                                 {!opt.isAvailable && <span className="text-[10px] text-red-500 font-bold">Indisponível</span>}
                                                             </div>
                                                         </div>
                                                         <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                                                            {opt.price > 0 ? `+ ${formatCurrencyBRL(opt.price)}` : 'Grátis'}
                                                         </span>
                                                     </div>
                                                 );
                                             })}
                                         </div>
                                     </div>
                                 ))}
                             </div>

                             <div className="mt-8">
                                 <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-gray-300 mb-3">
                                     <Info size={16} className="text-gray-400" /> Alguma observação?
                                 </label>
                                 <textarea 
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Ex: Tirar a cebola, maionese à parte..."
                                    className="w-full p-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 text-sm dark:text-white transition-all"
                                    rows={3}
                                 />
                             </div>
                         </div>
                    </div>

                    {/* Flavor Selection View (Overlay inside Modal) */}
                    {selectingFlavorIndex !== null && (
                        <div className="absolute inset-0 bg-white dark:bg-slate-900 z-30 flex flex-col animate-slide-up">
                            <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3 bg-white dark:bg-slate-900">
                                <button onClick={() => setSelectingFlavorIndex(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full">
                                    <ArrowLeft size={20} className="text-slate-700 dark:text-white"/>
                                </button>
                                <h3 className="font-bold text-lg text-slate-800 dark:text-white">Escolher Sabor {selectingFlavorIndex + 1}</h3>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white dark:bg-slate-900">
                                {validFlavorsForCurrentProduct.map(flavor => (
                                    <div 
                                        key={flavor.id}
                                        onClick={() => handleSelectFlavor(flavor.id)}
                                        className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 dark:border-slate-800 hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-slate-800 cursor-pointer transition-all"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center text-orange-600">
                                            <Slice size={18} />
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="font-bold text-slate-800 dark:text-white">{flavor.name}</h4>
                                            <p className="text-xs text-gray-500 line-clamp-1">{flavor.description}</p>
                                        </div>
                                        <div className="text-sm font-bold text-slate-700 dark:text-gray-300">
                                            {/* If flavors had prices, show here. For now, just text or icon */}
                                            <ChevronRight size={16} className="text-gray-300" />
                                        </div>
                                    </div>
                                ))}
                                {validFlavorsForCurrentProduct.length === 0 && (
                                    <p className="text-center text-gray-400 mt-10">Nenhum sabor disponível para esta pizza.</p>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="p-4 md:p-6 border-t border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row items-center gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-20">
                         {store.isActive ? (
                             <>
                                <div className="flex items-center border border-gray-200 dark:border-slate-700 rounded-xl h-14 w-full sm:w-auto">
                                    <button 
                                        onClick={() => setQuantity(q => Math.max(1, q - 1))}
                                        className="w-14 h-full flex items-center justify-center text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-l-xl transition-colors"
                                    >
                                        <Minus size={20} />
                                    </button>
                                    <span className="font-bold w-10 text-center text-lg text-slate-900 dark:text-white">{quantity}</span>
                                    <button 
                                        onClick={() => setQuantity(q => q + 1)}
                                        className="w-14 h-full flex items-center justify-center text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-r-xl transition-colors"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>
                                <button 
                                    onClick={handleConfirmAdd}
                                    className="flex-1 w-full bg-red-600 hover:bg-red-700 text-white h-14 rounded-xl font-bold flex justify-between items-center px-6 transition-all shadow-lg shadow-red-600/20 hover:scale-[1.02]"
                                >
                                    <span>Adicionar</span>
                                    <span className="bg-red-800/40 px-3 py-1 rounded-lg">{formatCurrencyBRL(calculateTotal())}</span>
                                </button>
                             </>
                         ) : (
                             <div className="w-full bg-gray-200 dark:bg-slate-800 text-gray-500 dark:text-gray-400 h-14 rounded-xl font-bold flex items-center justify-center cursor-not-allowed">
                                 Loja Fechada
                             </div>
                         )}
                    </div>

                </div>
            </div>
        )}

    </div>
  );
};

export default StoreDetails;
