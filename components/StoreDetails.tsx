
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, Star, Clock, Search, Plus, Minus, Info, ChevronRight, ChevronDown, Heart, Share2, Bike, ShoppingBag, X, Slice, Check, Layers, Database, Lock, Utensils } from 'lucide-react';
import { Store, Product, CartItem, Review, PizzaFlavor, Address, Coordinates } from '../types';
import { getProductsByStore, getPizzaFlavorsByStore, getReviewsByStore, addReview } from '../services/db';
import { formatCurrencyBRL } from '../utils/format';
import { imageKitUrl } from '../utils/imagekit';
import StoreReviews from './StoreReviews';
import { useAuth } from '../contexts/AuthContext';
import { calculateDistance } from '../utils/geo';

const PIZZA_SIZE_KEYS = ['brotinho', 'pequena', 'media', 'grande', 'familia'] as const;
const PIZZA_SIZE_ID_MAP: Record<string, string> = {
    sizebrotinho: 'brotinho',
    sizepequena: 'pequena',
    sizemedia: 'media',
    sizegrande: 'grande',
    sizefamilia: 'familia'
};
const PRICING_STRATEGIES = [
    { id: 'NORMAL', label: 'Normal' },
    { id: 'PROPORCIONAL', label: 'Proporcional' },
    { id: 'MAX', label: 'Maior sabor' }
] as const;

const normalizeCoords = (coords?: Coordinates | null): Coordinates | null => {
    if (!coords) return null;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
};

const normalizeText = (value: string) =>
    value
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

interface StoreDetailsProps {
  store: Store;
  onBack: () => void;
  onAddToCart: (item: CartItem) => void;
  cartItems: CartItem[];
  onRemoveFromCart: (id: string) => void;
  onClearCart: () => void;
  onOpenCart: () => void; 
  address?: Address | null;
  tableNumber?: string;
  onTrackTable?: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
  initialProductId?: string;
  onProductOpened?: () => void;
}

const StoreDetails: React.FC<StoreDetailsProps> = ({ 
    store, 
    onBack, 
    onAddToCart, 
    cartItems, 
    onOpenCart,
    address,
    tableNumber,
    onTrackTable,
    isFavorited = false,
    onToggleFavorite,
    initialProductId,
    onProductOpened
}) => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const productModalRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<{ top: number; bodyStyle: Partial<CSSStyleDeclaration>; htmlStyle: Partial<CSSStyleDeclaration>; rootStyle: Partial<CSSStyleDeclaration> } | null>(null);
  const [storeProducts, setStoreProducts] = useState<Product[]>([]);
  const [storeFlavors, setStoreFlavors] = useState<PizzaFlavor[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [showAddress, setShowAddress] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [nowInSaoPaulo, setNowInSaoPaulo] = useState<Date>(
      () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  );
  
  // Scroll logic
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
      const handleScroll = () => setScrolled(window.scrollY > 200);
      window.addEventListener('scroll', handleScroll);
      return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
      const tick = () => {
          setNowInSaoPaulo(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })));
      };
      const interval = setInterval(tick, 60000);
      return () => clearInterval(interval);
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
  const [buildableStep, setBuildableStep] = useState(0);
  const [buildableAlert, setBuildableAlert] = useState<string | null>(null);

  // Pizza State
  const [splitCount, setSplitCount] = useState(1);
  const [selectedFlavorIds, setSelectedFlavorIds] = useState<(string | null)[]>([]);
  const [pricingStrategy, setPricingStrategy] = useState<'NORMAL' | 'PROPORCIONAL' | 'MAX'>('NORMAL');
  const [selectingFlavorIndex, setSelectingFlavorIndex] = useState<number | null>(null); 

  // Reviews
  const [reviews, setReviews] = useState<Review[]>([]); 

  useEffect(() => {
      let active = true;
      const loadReviews = async () => {
          setLoadingReviews(true);
          try {
              const data = await getReviewsByStore(store.id);
              if (active) setReviews(data);
          } catch (error) {
              console.error('Erro ao carregar avaliações', error);
          } finally {
              if (active) setLoadingReviews(false);
          }
      };
      loadReviews();
      return () => {
          active = false;
      };
  }, [store.id]);

  const handleAddReview = async (rating: number, comment: string) => {
      try {
          const review = await addReview({
              storeId: store.id,
              rating,
              comment,
              userName: user?.name || user?.email
          });
          setReviews(prev => [review, ...prev]);
      } catch (error) {
          console.error('Erro ao enviar avaliação', error);
          alert('Erro ao enviar avaliação. Tente novamente.');
      }
  };

  const ratingCount = Number(store.ratingCount ?? 0) || reviews.length;
  const averageRating = reviews.length > 0
      ? reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length
      : Number(store.rating) || 0;
  const hasRating = Number.isFinite(averageRating) && averageRating > 0;
  const ratingLabel = hasRating
      ? `${averageRating.toFixed(1)}${ratingCount ? ` (${ratingCount} avaliações)` : ''}`
      : '';

  const normalizeDay = (value: string) =>
      (value || '')
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();

  const parseTimeToMinutes = (value: string) => {
      const [hours, minutes] = (value || '').split(':').map(Number);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
      return hours * 60 + minutes;
  };

  const isWithinRange = (minutes: number, start: number, end: number) => {
      if (start <= end) return minutes >= start && minutes <= end;
      return minutes >= start || minutes <= end;
  };

  const scheduleEntries = store.schedule || [];
  const todayName = nowInSaoPaulo.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
  const todayEntry = scheduleEntries.find((entry) => normalizeDay(entry.day) === normalizeDay(todayName)) || scheduleEntries[nowInSaoPaulo.getDay()];

  const getScheduleOpen = () => {
      if (!todayEntry) return false;
      const nowMinutes = nowInSaoPaulo.getHours() * 60 + nowInSaoPaulo.getMinutes();
      const morningOpen = parseTimeToMinutes(todayEntry.morningOpenTime);
      const morningClose = parseTimeToMinutes(todayEntry.morningCloseTime);
      const afternoonOpen = parseTimeToMinutes(todayEntry.afternoonOpenTime);
      const afternoonClose = parseTimeToMinutes(todayEntry.afternoonCloseTime);
      const openMorning =
          todayEntry.isMorningOpen &&
          morningOpen !== null &&
          morningClose !== null &&
          isWithinRange(nowMinutes, morningOpen, morningClose);
      const openAfternoon =
          todayEntry.isAfternoonOpen &&
          afternoonOpen !== null &&
          afternoonClose !== null &&
          isWithinRange(nowMinutes, afternoonOpen, afternoonClose);
      return openMorning || openAfternoon;
  };

  const scheduleOpen = scheduleEntries.length > 0 ? getScheduleOpen() : false;
  const isOpenNow = scheduleEntries.length > 0 ? scheduleOpen : store.isActive !== false;
  const showOpenBadge = scheduleEntries.length > 0 || store.isActive !== undefined;

  const formatScheduleLine = (entry: Store['schedule'][number]) => {
      const morning =
          entry.isMorningOpen ? `${entry.morningOpenTime} - ${entry.morningCloseTime}` : '';
      const afternoon =
          entry.isAfternoonOpen ? `${entry.afternoonOpenTime} - ${entry.afternoonCloseTime}` : '';
      const parts = [morning, afternoon].filter(Boolean);
      return parts.length > 0 ? parts.join(' / ') : 'Fechado';
  };

  const storeAddressLine = [store.street, store.number, store.complement, store.district, store.city, store.state]
      .filter(Boolean)
      .join(', ');

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

  const normalizeSizeKey = (value: string) =>
      value
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '')
          .trim();

  const resolveSizeKey = (value: string) => {
      const normalized = normalizeSizeKey(value);
      if (PIZZA_SIZE_KEYS.includes(normalized as any)) return normalized;
      if (PIZZA_SIZE_ID_MAP[normalized]) return PIZZA_SIZE_ID_MAP[normalized];
      if (normalized.includes('brotinho')) return 'brotinho';
      if (normalized.includes('pequena')) return 'pequena';
      if (normalized.includes('media') || normalized.includes('medio')) return 'media';
      if (normalized.includes('grande')) return 'grande';
      if (normalized.includes('familia')) return 'familia';
      return '';
  };

  // --- HANDLERS ---

  const handleOpenProduct = (product: Product) => {
      setSelectedProduct(product);
      setQuantity(1);
      setSelectedOptions({});
      setNotes('');
      setBuildableStep(0);
      setBuildableAlert(null);
      
      // Reset Pizza State
      setSplitCount(1);
      setSelectedFlavorIds([null, null, null, null, null]);
      setSelectingFlavorIndex(null);
      const allowed = product.pricingStrategiesAllowed || ['NORMAL', 'PROPORCIONAL', 'MAX'];
      const defaultStrategy = product.defaultPricingStrategy || allowed[0] || 'NORMAL';
      setPricingStrategy(defaultStrategy);
  };

  useEffect(() => {
      if (!initialProductId) return;
      if (storeProducts.length === 0) return;
      const match = storeProducts.find((product) => product.id === initialProductId);
      if (!match) return;
      handleOpenProduct(match);
      if (onProductOpened) onProductOpened();
  }, [initialProductId, storeProducts]);

  const handleCloseProduct = () => {
      setSelectedProduct(null);
  };

  useEffect(() => {
      if (!selectedProduct) return;
      const root = document.getElementById('root');
      const scrollTop = window.scrollY || window.pageYOffset;
      scrollLockRef.current = {
          top: scrollTop,
          bodyStyle: {
              overflow: document.body.style.overflow,
              position: document.body.style.position,
              top: document.body.style.top,
              width: document.body.style.width
          },
          htmlStyle: {
              overflow: document.documentElement.style.overflow
          },
          rootStyle: {
              overflow: root?.style.overflow
          }
      };

      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollTop}px`;
      document.body.style.width = '100%';
      document.documentElement.style.overflow = 'hidden';
      if (root) {
          root.style.overflow = 'hidden';
      }

      const handleWheel = (event: WheelEvent) => {
          const target = event.target as Node | null;
          if (!target) return;
          if (productModalRef.current && productModalRef.current.contains(target)) return;
          event.preventDefault();
      };
      const handleTouchMove = (event: TouchEvent) => {
          const target = event.target as Node | null;
          if (!target) return;
          if (productModalRef.current && productModalRef.current.contains(target)) return;
          event.preventDefault();
      };
      window.addEventListener('wheel', handleWheel, { passive: false });
      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      return () => {
          window.removeEventListener('wheel', handleWheel);
          window.removeEventListener('touchmove', handleTouchMove);
          const lock = scrollLockRef.current;
          document.body.style.overflow = lock?.bodyStyle.overflow || '';
          document.body.style.position = lock?.bodyStyle.position || '';
          document.body.style.top = lock?.bodyStyle.top || '';
          document.body.style.width = lock?.bodyStyle.width || '';
          document.documentElement.style.overflow = lock?.htmlStyle.overflow || '';
          if (root) {
              root.style.overflow = lock?.rootStyle.overflow || '';
          }
          if (lock) {
              window.scrollTo(0, lock.top);
          }
          scrollLockRef.current = null;
      };
  }, [selectedProduct]);

  const orderedOptionGroups = useMemo(() => {
      if (!selectedProduct) return [];
      return [...(selectedProduct.optionGroups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [selectedProduct]);

  const sizeGroup = useMemo(() => {
      if (!selectedProduct) return null;
      return orderedOptionGroups.find(group => group.id === 'size-group' || /tamanho|gramatura/i.test(group.name));
  }, [orderedOptionGroups, selectedProduct]);

  const selectedSizeOption = useMemo(() => {
      if (!sizeGroup) return null;
      const sizeId = (selectedOptions[sizeGroup.id] || [])[0];
      const option = sizeGroup.options.find(opt => opt.id === sizeId) || null;
      if (option && option.isAvailable === false) return null;
      return option;
  }, [sizeGroup, selectedOptions]);

  const selectedSizeKey = useMemo(() => {
      if (selectedSizeOption?.id) {
          const resolved = resolveSizeKey(selectedSizeOption.id);
          if (resolved) return resolved;
      }
      if (selectedSizeOption?.name) {
          const resolved = resolveSizeKey(selectedSizeOption.name);
          if (resolved) return resolved;
      }
      return '';
  }, [selectedSizeOption]);

  const maxFlavorsAllowed = useMemo(() => {
      if (!selectedProduct) return 1;
      const maxBySize = selectedProduct.maxFlavorsBySize || {};
      const maxFromSize = selectedSizeKey ? maxBySize[selectedSizeKey] : undefined;
      const fallback = selectedProduct.maxFlavors || 1;
      const resolved = Number(maxFromSize || fallback || 1);
      return Math.max(1, Math.min(5, Number.isFinite(resolved) ? resolved : 1));
  }, [selectedProduct, selectedSizeKey]);

  useEffect(() => {
      if (splitCount > maxFlavorsAllowed) {
          setSplitCount(maxFlavorsAllowed);
      }
  }, [maxFlavorsAllowed, splitCount]);

  useEffect(() => {
      if (!selectedProduct?.isPizza) return;
      if (!selectedSizeKey && !selectedSizeOption?.id) return;
      setSelectedFlavorIds((prev) => {
          let changed = false;
          const next = prev.map((id) => {
              if (!id) return null;
              const flavor = validFlavorsForCurrentProduct.find((f) => f.id === id) || null;
              if (!resolveFlavorPrice(flavor).found) {
                  changed = true;
                  return null;
              }
              return id;
          });
          return changed ? next : prev;
      });
  }, [selectedProduct, selectedSizeKey, selectedSizeOption?.id, validFlavorsForCurrentProduct]);

  const effectivePricingStrategy = useMemo(() => {
      if (!selectedProduct?.isPizza) return 'NORMAL';
      const allowed = selectedProduct.pricingStrategiesAllowed || ['NORMAL', 'PROPORCIONAL', 'MAX'];
      const defaultStrategy = selectedProduct.defaultPricingStrategy || allowed[0] || 'NORMAL';
      if (selectedProduct.customerCanChoosePricingStrategy === false) {
          return defaultStrategy;
      }
      return allowed.includes(pricingStrategy) ? pricingStrategy : defaultStrategy;
  }, [selectedProduct, pricingStrategy]);

  const resolveFlavorPrice = (flavor: PizzaFlavor | null) => {
      if (!flavor) return { value: 0, found: false };
      const prices = flavor.pricesBySize || {};
      const resolvePriceKey = (key?: string) => {
          if (!key) return '';
          if (key in prices) return key;
          const normalized = normalizeSizeKey(key);
          const match = Object.keys(prices).find((candidate) => normalizeSizeKey(candidate) === normalized);
          return match || '';
      };
      const pickPrice = (key?: string) => {
          if (!key) return { value: 0, found: false };
          const raw = (prices as Record<string, unknown>)[key];
          if (raw === '' || raw === null || raw === undefined) return { value: 0, found: false };
          const parsed = Number(raw);
          return Number.isFinite(parsed) && parsed > 0 ? { value: parsed, found: true } : { value: 0, found: false };
      };
      const byKey = pickPrice(resolvePriceKey(selectedSizeKey));
      if (byKey.found) return byKey;
      const byOption = pickPrice(selectedSizeOption?.id);
      if (byOption.found) return byOption;
      return { value: 0, found: false };
  };

  const getFlavorPriceForSize = (flavorId: string) => {
      const flavor = validFlavorsForCurrentProduct.find(f => f.id === flavorId) || null;
      return resolveFlavorPrice(flavor).value;
  };

  const isBuildableFlow = !!(selectedProduct?.isBuildable || selectedProduct?.priceMode === 'BY_SIZE');
  const useBuildableWizard = isBuildableFlow && orderedOptionGroups.length <= 1 && !selectedProduct?.isPizza;

  const handleOptionToggle = (groupId: string, optionId: string, max: number) => {
      if (isBuildableFlow) {
          setBuildableAlert(null);
      }
      setSelectedOptions(prev => {
          const current = prev[groupId] || [];
          if (max === 1) {
              if (current.includes(optionId)) {
                  const next = current.filter(id => id !== optionId);
                  if (next.length === 0) {
                      const { [groupId]: _removed, ...rest } = prev;
                      return rest;
                  }
                  return { ...prev, [groupId]: next };
              }
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
      let baseNormal = basePrice;

      if (selectedProduct.priceMode === 'BY_SIZE' && sizeGroup) {
          const sizeId = (selectedOptions[sizeGroup.id] || [])[0];
          const sizeOption = sizeGroup.options.find(opt => opt.id === sizeId);
          baseNormal = sizeOption ? sizeOption.price : 0;
          basePrice = baseNormal;
      }

      if (selectedProduct.isPizza) {
          const flavorIds = selectedFlavorIds.slice(0, splitCount).filter(Boolean) as string[];
          const flavorPrices = flavorIds.map((id) => getFlavorPriceForSize(id));
          const hasFlavorPrices = flavorPrices.length > 0;
          const avgFlavorPrice = hasFlavorPrices
              ? flavorPrices.reduce((sum, value) => sum + value, 0) / flavorPrices.length
              : 0;
          const maxFlavorPrice = hasFlavorPrices ? Math.max(...flavorPrices) : 0;

          if (effectivePricingStrategy === 'PROPORCIONAL') {
              basePrice = avgFlavorPrice > 0 ? avgFlavorPrice : baseNormal;
          } else if (effectivePricingStrategy === 'MAX') {
              basePrice = maxFlavorPrice > 0 ? maxFlavorPrice : baseNormal;
          } else {
              basePrice = baseNormal;
          }
      }
      
      let optionsTotal = 0;
      let extraChargeTotal = 0;
      selectedProduct.optionGroups.forEach(group => {
          const selectedIds = selectedOptions[group.id] || [];
          selectedIds.forEach(optId => {
              const opt = group.options.find(o => o.id === optId);
              if (!opt) return;
              if (!(selectedProduct.priceMode === 'BY_SIZE' && sizeGroup && group.id === sizeGroup.id)) {
                  optionsTotal += opt.price;
              }
          });
          const extraAfter = group.extraChargeAfter || 0;
          const extraAmount = group.extraChargeAmount || 0;
          if (extraAmount > 0 && selectedIds.length > extraAfter) {
              extraChargeTotal += (selectedIds.length - extraAfter) * extraAmount;
          }
      });
      
      return (basePrice + optionsTotal + extraChargeTotal) * quantity;
  };

  const handleConfirmAdd = () => {
      if (!selectedProduct) return;
      const isBuildable = isBuildableFlow;
      const reportValidation = (message: string) => {
          if (isBuildable) {
              setBuildableAlert(message);
          } else {
              alert(message);
          }
      };

      // Validate Pizza Splits
      if (selectedProduct.isPizza) {
          if (splitCount > maxFlavorsAllowed) {
              reportValidation(`Este tamanho permite até ${maxFlavorsAllowed} sabores.`);
              return;
          }
          const chosenIds = selectedFlavorIds.slice(0, splitCount).filter(Boolean) as string[];
          const uniqueIds = new Set(chosenIds);
          if (uniqueIds.size !== chosenIds.length) {
              reportValidation('Não é permitido repetir sabores.');
              return;
          }
          for(let i=0; i < splitCount; i++) {
              if (!selectedFlavorIds[i]) {
                  if (maxFlavorsAllowed > 1 || validFlavorsForCurrentProduct.length > 0) {
                       reportValidation(`Por favor, escolha o Sabor ${i+1}.`);
                       return;
                  }
              }
          }
          const missingFlavorPrice = chosenIds.some((id) => {
              const flavor = validFlavorsForCurrentProduct.find((f) => f.id === id) || null;
              return !resolveFlavorPrice(flavor).found;
          });
          if (missingFlavorPrice) {
              reportValidation('Um ou mais sabores nao possuem preco para este tamanho.');
              return;
          }
      }

      if (selectedProduct.priceMode === 'BY_SIZE' && sizeGroup) {
          const sizeSelected = (selectedOptions[sizeGroup.id] || []).length > 0;
          if (!sizeSelected) {
              reportValidation('Escolha um tamanho para continuar.');
              return;
          }
      }

      for (const group of selectedProduct.optionGroups) {
          const selectedCount = (selectedOptions[group.id] || []).length;
          if (selectedCount < group.min) {
              reportValidation(`Escolha mais ${group.min - selectedCount} opção(ões) em "${group.name}" para continuar.`);
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
                      price: (selectedProduct.priceMode === 'BY_SIZE' && sizeGroup && group.id === sizeGroup.id) ? 0 : opt.price
                  });
              }
          });
          const extraAfter = group.extraChargeAfter || 0;
          const extraAmount = group.extraChargeAmount || 0;
          if (extraAmount > 0 && selectedIds.length > extraAfter) {
              const extraCount = selectedIds.length - extraAfter;
              const extraTotal = extraCount * extraAmount;
              optionsSummary.push({
                  groupName: group.name,
                  optionName: `Adicional (${extraCount}x)`,
                  price: extraTotal
              });
          }
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
      } else if (selectedProduct.priceMode === 'BY_SIZE' && sizeGroup) {
          const sizeId = (selectedOptions[sizeGroup.id] || [])[0];
          const sizeOption = sizeGroup.options.find(opt => opt.id === sizeId);
          if (sizeOption) {
              finalName = `${selectedProduct.name} - ${sizeOption.name}`;
          }
      }

      const productForCart = { ...selectedProduct, name: finalName };

      const pizzaPayload = selectedProduct.isPizza
          ? {
              splitCount,
              flavors: selectedFlavorIds
                  .slice(0, splitCount)
                  .filter(Boolean)
                  .map((id) => ({ flavorId: id as string, fraction: 1 / splitCount })),
              sizeKeyOrSizeOptionId: selectedSizeOption?.id || selectedSizeKey || undefined,
              sizeKey: selectedSizeKey || undefined,
              sizeOptionId: selectedSizeOption?.id || undefined,
              pricingStrategySelected: effectivePricingStrategy
          }
          : undefined;

      const cartItem: CartItem = {
          id: Date.now().toString(),
          product: productForCart,
          quantity,
          options: optionsSummary,
          notes,
          totalPrice: calculateTotal(),
          ...(pizzaPayload ? { pizza: pizzaPayload } : {})
      };

      onAddToCart(cartItem);
      handleCloseProduct();
      onOpenCart(); 
  };
  const deliveryFeeMode =
      store.deliveryFeeMode === 'BY_NEIGHBORHOOD'
          ? 'BY_NEIGHBORHOOD'
          : store.deliveryFeeMode === 'BY_RADIUS'
          ? 'BY_RADIUS'
          : 'FIXED';
  const deliveryZones = Array.isArray(store.deliveryZones) ? store.deliveryZones : [];
  const deliveryNeighborhoods = Array.isArray(store.neighborhoodFees)
      ? store.neighborhoodFees
      : Array.isArray(store.deliveryNeighborhoods)
      ? store.deliveryNeighborhoods
      : [];
  const deliveryFeeInfo = useMemo(() => {
      const fallbackFee = Number(store.deliveryFee) || 0;
      if (deliveryFeeMode === 'BY_RADIUS') {
          const activeZones = deliveryZones.filter((zone) => zone && zone.enabled !== false);
          if (activeZones.length === 0) {
              return { fee: fallbackFee, label: fallbackFee > 0 ? formatCurrencyBRL(fallbackFee) : 'Consultar loja' };
          }
          const coords = normalizeCoords(address?.coordinates);
          if (!coords) {
              const minFee = Math.min(...activeZones.map((zone) => Number(zone.fee || 0)));
              if (Number.isFinite(minFee) && minFee > 0) {
                  return { fee: minFee, label: `A partir de ${formatCurrencyBRL(minFee)}` };
              }
              return { fee: 0, label: 'Informe endereço' };
          }
          const matches = activeZones
              .map((zone) => {
                  const distanceKm = calculateDistance(
                      { lat: Number(zone.centerLat), lng: Number(zone.centerLng) },
                      coords
                  );
                  return { zone, distanceMeters: distanceKm * 1000 };
              })
              .filter((item) => item.distanceMeters <= Number(item.zone.radiusMeters || 0));
          if (matches.length === 0) {
              return { fee: 0, label: 'Fora da área' };
          }
          matches.sort((a, b) => {
              const priorityA = Number(a.zone.priority || 0);
              const priorityB = Number(b.zone.priority || 0);
              if (priorityA !== priorityB) return priorityB - priorityA;
              const radiusA = Number(a.zone.radiusMeters || 0);
              const radiusB = Number(b.zone.radiusMeters || 0);
              if (radiusA !== radiusB) return radiusA - radiusB;
              return a.distanceMeters - b.distanceMeters;
          });
          const best = matches[0].zone;
          const fee = Number(best.fee || 0);
          return { fee: Number.isFinite(fee) ? fee : 0, label: fee > 0 ? formatCurrencyBRL(fee) : 'Grátis' };
      }
      if (deliveryFeeMode === 'BY_NEIGHBORHOOD') {
          const district = (address?.district || '').toString().trim();
          if (!district) {
              return { fee: 0, label: 'Informe endereço' };
          }
          const normalized = normalizeText(district);
          const match = deliveryNeighborhoods.find(
              (item) => item?.name && normalizeText(item.name) === normalized && item.active !== false
          );
          if (!match) {
              return { fee: 0, label: 'Fora da área' };
          }
          const fee = Number(match.fee || 0);
          return { fee: Number.isFinite(fee) ? fee : 0, label: fee > 0 ? formatCurrencyBRL(fee) : 'Grátis' };
      }
      return { fee: fallbackFee, label: fallbackFee > 0 ? formatCurrencyBRL(fallbackFee) : 'Grátis' };
  }, [
      address?.coordinates?.lat,
      address?.coordinates?.lng,
      address?.district,
      deliveryFeeMode,
      deliveryNeighborhoods,
      deliveryZones,
      store.deliveryFee
  ]);

  const deliveryFee = deliveryFeeInfo.fee;
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

  const handleBuildableNext = () => {
      if (!selectedProduct) return;
      if (!isBuildableFlow) return;
      setBuildableAlert(null);

      const current = buildableCurrent;
      if (current?.type === 'GROUP' && current.group) {
          const selectedCount = (selectedOptions[current.group.id] || []).length;
          if (selectedCount < current.group.min) {
              setBuildableAlert(`Escolha mais ${current.group.min - selectedCount} opção(ões) para continuar.`);
              return;
          }
      }

      if (current?.type === 'REVIEW') {
          handleConfirmAdd();
          return;
      }

      setBuildableStep(prev => Math.min(prev + 1, buildableSteps.length - 1));
  };

  const handleBuildableBack = () => {
      setBuildableAlert(null);
      setBuildableStep(prev => Math.max(prev - 1, 0));
  };

  const buildableSteps = useMemo(() => {
      if (!selectedProduct || !isBuildableFlow) return [];
      const groupSteps = orderedOptionGroups.map(group => ({ type: 'GROUP' as const, group }));
      return [...groupSteps, { type: 'NOTES' as const }, { type: 'REVIEW' as const }];
  }, [isBuildableFlow, orderedOptionGroups, selectedProduct]);

  const buildableCurrent = buildableSteps[buildableStep];

  return (
    <div className="bg-gray-50 dark:bg-slate-950 min-h-screen pb-24 font-sans">
        {/* Navbar */}
        <nav className={`fixed top-0 left-0 right-0 z-50 pointer-events-none transition-all duration-300 ${scrolled ? 'bg-white dark:bg-slate-900 shadow-md py-2' : 'bg-transparent py-4'}`}>
            <div className="max-w-5xl mx-auto px-4 flex justify-between items-center">
                {scrolled ? (
                    <button 
                        onClick={onBack}
                        className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-full text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label="Voltar"
                    >
                        <ArrowLeft size={18} />
                        <span className="text-sm font-bold">Voltar</span>
                    </button>
                ) : (
                    <span />
                )}
                {scrolled && (
                    <span className="font-bold text-gray-800 dark:text-white truncate max-w-[200px] animate-fade-in">
                        {store.name}
                    </span>
                )}
                <span />
            </div>
        </nav>

        {/* Hero Banner */}
        <div className="relative bg-white dark:bg-slate-900 mb-6 pb-4">
            <div className="h-[260px] md:h-[340px] w-full relative overflow-hidden rounded-b-3xl">
                {!scrolled && (
                    <button
                        onClick={onBack}
                        className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-2 rounded-full bg-white/90 text-slate-700 shadow-lg hover:bg-white transition-colors"
                        aria-label="Voltar"
                    >
                        <ArrowLeft size={18} />
                        <span className="text-sm font-bold">Voltar</span>
                    </button>
                )}
                {store.imageUrl ? (
                    <img
                        src={imageKitUrl(store.imageUrl, { width: 1280, quality: 70 })}
                        alt={store.name}
                        loading="eager"
                        decoding="async"
                        className={`w-full h-full object-cover login-blur-image ${!store.isActive ? 'grayscale' : ''}`}
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-slate-200 via-slate-100 to-slate-50 dark:from-slate-800 dark:via-slate-900 dark:to-slate-950" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/70" />
            </div>
            
            <div className="max-w-5xl mx-auto px-4 relative -mt-16 md:-mt-20 z-10">
                <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-3xl shadow-xl p-6 border border-gray-100 dark:border-slate-800">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-4">
                            {store.logoUrl && (
                                <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-950 border border-white/80 shadow-md flex items-center justify-center p-2">
                                    <img
                                        src={imageKitUrl(store.logoUrl || '', { width: 160, quality: 70 })}
                                        alt={`Logo ${store.name}`}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                            )}
                            <div>
                                <h1 className="text-2xl md:text-4xl font-extrabold text-slate-800 dark:text-white leading-tight">
                                    {store.name}
                                </h1>
                                <p className="text-sm text-slate-500 dark:text-slate-400">{store.category}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => onToggleFavorite && onToggleFavorite()}
                            className={`p-2 rounded-full transition-colors ${
                                isFavorited
                                    ? 'bg-red-600 text-white'
                                    : 'bg-gray-50 dark:bg-slate-800 text-gray-400 hover:text-red-500'
                            }`}
                            aria-label={isFavorited ? 'Remover favorito' : 'Favoritar loja'}
                        >
                            <Heart size={22} fill={isFavorited ? 'currentColor' : 'none'} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-sm text-gray-600 dark:text-gray-300 mb-4">
                         {hasRating && (
                             <span className="flex items-center gap-1 font-bold px-2 py-0.5 rounded-lg text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20">
                                 <Star size={14} fill="currentColor" /> {ratingLabel}
                             </span>
                         )}
                    </div>

                    <div className="flex flex-col gap-2 mb-4">
                        {showOpenBadge && (
                            <span
                                className={`inline-flex w-fit items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${
                                    isOpenNow ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                                }`}
                            >
                                {isOpenNow ? 'Aberto agora' : 'Fechado'}
                            </span>
                        )}
                        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70">
                            <button
                                type="button"
                                onClick={() => setShowAddress((prev) => !prev)}
                                className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-700 dark:text-slate-200"
                            >
                                Ver endereço
                                <ChevronDown size={16} className={`transition-transform ${showAddress ? 'rotate-180' : ''}`} />
                            </button>
                            {showAddress && (
                                <div className="px-4 pb-4 text-sm text-slate-600 dark:text-slate-300">
                                    {storeAddressLine || 'Endereço não informado'}
                                </div>
                            )}
                        </div>
                        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70">
                            <button
                                type="button"
                                onClick={() => setShowSchedule((prev) => !prev)}
                                className="w-full px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-700 dark:text-slate-200"
                            >
                                Ver horários
                                <ChevronDown size={16} className={`transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
                            </button>
                            {showSchedule && (
                                <div className="px-4 pb-4 text-sm text-slate-600 dark:text-slate-300 space-y-1">
                                    {scheduleEntries.length === 0 && (
                                        <span>Horários não informados</span>
                                    )}
                                    {scheduleEntries.length > 0 && (
                                        scheduleEntries.map((entry, idx) => (
                                            <div key={`${entry.day}-${idx}`} className="flex items-center justify-between gap-4">
                                                <span className="font-semibold text-slate-700 dark:text-slate-200">{entry.day}</span>
                                                <span>{formatScheduleLine(entry)}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
                        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 p-3">
                            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-[0.2em]">Entrega</p>
                            <div className="flex items-center gap-1 font-bold text-slate-800 dark:text-white">
                                <Clock size={16} className="text-gray-400" /> {store.deliveryTime}
                            </div>
                        </div>
                        {store.acceptsPickup && pickupTime && (
                            <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 p-3">
                                <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-[0.2em]">Retirada</p>
                                <div className="flex items-center gap-1 font-bold text-slate-800 dark:text-white">
                                    <Clock size={16} className="text-gray-400" /> {pickupTime}
                                </div>
                            </div>
                        )}
                        <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 p-3">
                            <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-[0.2em]">Taxa</p>
                            <div className="font-bold text-green-600">
                                {deliveryFeeInfo.label}
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
                    className="bg-slate-900 text-white px-4 py-2 rounded-xl font-bold hover:opacity-90 shadow-sm moving-border"
                    style={{ '--moving-border-bg': '#0f172a' } as React.CSSProperties}
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

            <div className="grid lg:grid-cols-[1.2fr] gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-5 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400 font-bold">Buscar no cardápio</p>
                    <div className="relative mt-4">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Digite o nome do produto"
                            className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
                        />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <span className="px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 bg-white text-slate-600">
                            {displayProducts.length} itens encontrados
                        </span>
                        <span className="px-3 py-1.5 rounded-full text-xs font-bold border border-slate-200 bg-white text-slate-600">
                            {categories.length} categorias
                        </span>
                    </div>
                </div>
            </div>
            
            {/* Products List */}
            {loadingProducts ? (
                <div className="grid md:grid-cols-2 gap-6">
                    {Array.from({ length: 4 }).map((_, idx) => (
                        <div key={idx} className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex gap-4">
                            <div className="flex-1 space-y-3">
                                <div className="h-4 w-2/3 rounded-full skeleton-shimmer" />
                                <div className="h-3 w-full rounded-full skeleton-shimmer" />
                                <div className="h-3 w-4/5 rounded-full skeleton-shimmer" />
                                <div className="h-4 w-24 rounded-full skeleton-shimmer" />
                            </div>
                            <div className="w-32 h-32 rounded-xl skeleton-shimmer" />
                        </div>
                    ))}
                </div>
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
                                                    src={imageKitUrl(product.imageUrl, { width: 640, quality: 70 })} 
                                                    alt={product.name} 
                                                    loading="lazy"
                                                    decoding="async"
                                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 login-blur-image" 
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

            {loadingReviews ? (
                <div className="py-10 text-center text-gray-500">Carregando avaliações...</div>
            ) : (
                <StoreReviews reviews={reviews} onAddReview={handleAddReview} storeName={store.name} />
            )}
        </div>

        {/* Floating Cart Button (Mobile/All) */}
        {cartItems.length > 0 && (
            <div className="fixed bottom-6 left-0 w-full px-4 z-40 pointer-events-none">
                <button 
                    onClick={onOpenCart}
                    className="pointer-events-auto w-full max-w-3xl mx-auto bg-red-600 hover:bg-red-700 text-white p-4 rounded-2xl shadow-xl shadow-red-900/30 flex justify-between items-center font-bold transform hover:-translate-y-1 transition-all moving-border"
                    style={{ '--moving-border-bg': '#dc2626' } as React.CSSProperties}
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
                <div
                    ref={productModalRef}
                    className="bg-white dark:bg-slate-900 w-full max-w-xl max-h-[90vh] rounded-3xl relative z-10 flex flex-col overflow-hidden animate-scale-in shadow-2xl min-h-0 overscroll-contain"
                    onWheel={(event) => event.stopPropagation()}
                >
                    
                    {/* Main Scroll Area */}
                    <div className="flex-1 overflow-y-auto scrollbar-hide relative min-h-0 overscroll-contain">
                         {/* Image Header */}
                         <div className="relative h-64">
                            <img
                                src={imageKitUrl(selectedProduct.imageUrl, { width: 960, quality: 75 })}
                                alt={selectedProduct.name}
                                loading="eager"
                                decoding="async"
                                className="w-full h-full object-cover login-blur-image"
                            />
                            <button 
                                onClick={handleCloseProduct} 
                                className="absolute top-4 right-4 bg-red-600 hover:bg-red-700 text-white p-2 rounded-full transition-colors shadow-lg"
                                aria-label="Fechar"
                            >
                                <X size={20}/>
                            </button>
                         </div>
                         
                         <div className="p-6 -mt-6 bg-white dark:bg-slate-900 rounded-t-3xl relative z-10">
                             {useBuildableWizard ? (
                                 <div className="space-y-6">
                                     <div>
                                         <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white mb-2 leading-tight">{selectedProduct.name}</h2>
                                         <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{selectedProduct.description}</p>
                                     </div>

                                     <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                                         {buildableSteps.map((step, idx) => (
                                             <span
                                                 key={`buildable-step-${idx}`}
                                                 className={`px-3 py-1 rounded-full border ${idx === buildableStep ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-slate-200 text-slate-400'}`}
                                             >
                                                 {step.type === 'GROUP' && step.group ? step.group.name : step.type === 'NOTES' ? 'Observações' : 'Revisão'}
                                             </span>
                                         ))}
                                     </div>

                                     {buildableCurrent?.type === 'GROUP' && buildableCurrent.group && (() => {
                                         const group = buildableCurrent.group;
                                         const isSizeGroup = group.id === 'size-group' || /tamanho|gramatura/i.test(group.name);
                                         const filteredOptions = isSizeGroup
                                             ? group.options.filter((opt) => opt.isAvailable !== false)
                                             : group.options;
                                         const maxAllowed = group.max > 0 ? group.max : filteredOptions.length;
                                         const minRequired = group.min > 0 ? group.min : 0;
                                         const selectedCount = (selectedOptions[group.id] || []).length;
                                         const remainingMin = Math.max(minRequired - selectedCount, 0);
                                         const isMaxed = selectedCount >= maxAllowed;
                                         const orderedOptions = [...filteredOptions].sort((a, b) => (a.order || 0) - (b.order || 0));
                                         return (
                                             <div className="space-y-4">
                                                 <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/30">
                                                     <div>
                                                         <h3 className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400">{group.name}</h3>
                                                         <p className="text-xs text-emerald-600/80">
                                                             {maxAllowed === 1 ? 'Escolha 1 opção' : `Você escolheu ${selectedCount} de ${maxAllowed}`}
                                                         </p>
                                                         {remainingMin > 0 && (
                                                             <p className="text-xs text-emerald-700 mt-1">Escolha mais {remainingMin} para continuar.</p>
                                                         )}
                                                         {maxAllowed === 1 && selectedCount > 0 && (
                                                             <p className="text-xs text-emerald-700/90 mt-1">Toque novamente para desmarcar.</p>
                                                         )}
                                                     </div>
                                                     {minRequired > 0 && (
                                                         <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-bold uppercase">
                                                             Obrigatório
                                                         </span>
                                                     )}
                                                 </div>

                                                 {group.extraChargeAmount && group.extraChargeAfter !== undefined && group.extraChargeAfter > 0 && (
                                                     <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg">
                                                         <Info size={14} />
                                                         <span>Acima de {group.extraChargeAfter} itens: +{formatCurrencyBRL(group.extraChargeAmount)} cada.</span>
                                                     </div>
                                                 )}

                                                 <div className="space-y-3">
                                                     {orderedOptions.map(opt => {
                                                         const isSelected = (selectedOptions[group.id] || []).includes(opt.id);
                                                         const isDisabled = !isSelected && isMaxed && maxAllowed > 1;
                                                         return (
                                                             <div 
                                                                key={opt.id} 
                                                                onClick={() => opt.isAvailable && !isDisabled && handleOptionToggle(group.id, opt.id, maxAllowed)}
                                                                className={`flex justify-between items-center p-4 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-400' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'} ${!opt.isAvailable || isDisabled ? 'opacity-50 pointer-events-none grayscale' : ''}`}
                                                             >
                                                                 <div className="flex items-center gap-4">
                                                                     <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'border-emerald-500' : 'border-gray-300 dark:border-slate-600'}`}>
                                                                         {isSelected && <Check size={14} className="text-emerald-600" />}
                                                                     </div>
                                                                     <div className="flex flex-col">
                                                                         <span className={`font-bold text-sm ${isSelected ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-gray-200'}`}>{opt.name}</span>
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
                                         );
                                     })()}

                                     {buildableCurrent?.type === 'NOTES' && (
                                         <div className="space-y-4">
                                             <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
                                                 <h3 className="font-bold text-slate-800 dark:text-white">Observações</h3>
                                                 <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Opcional. Ex: sem cebola, bem passado.</p>
                                             </div>
                                             <textarea 
                                                value={notes}
                                                onChange={(e) => setNotes(e.target.value)}
                                                placeholder="Ex: Tirar a cebola, maionese à parte..."
                                                className="w-full p-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm dark:text-white transition-all"
                                                rows={4}
                                             />
                                         </div>
                                     )}

                                     {buildableCurrent?.type === 'REVIEW' && (
                                         <div className="space-y-4">
                                             <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
                                                 <h3 className="font-bold text-slate-800 dark:text-white">Revisão rápida</h3>
                                                 <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Confirme itens, adicionais e prazo antes de continuar.</p>
                                             </div>

                                             <div className="space-y-3">
                                                 {orderedOptionGroups.map(group => {
                                                     const selectedIds = selectedOptions[group.id] || [];
                                                     if (selectedIds.length === 0) return null;
                                                     return (
                                                         <div key={`review-${group.id}`} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                                                             <p className="text-xs font-bold text-slate-500 uppercase">{group.name}</p>
                                                             <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                                                                 {selectedIds.map(optId => {
                                                                     const opt = group.options.find(option => option.id === optId);
                                                                     if (!opt) return null;
                                                                     return (
                                                                         <div key={optId} className="flex items-center justify-between">
                                                                             <span>{opt.name}</span>
                                                                             <span className="text-slate-500">{opt.price > 0 ? `+ ${formatCurrencyBRL(opt.price)}` : 'Grátis'}</span>
                                                                         </div>
                                                                     );
                                                                 })}
                                                             </div>
                                                         </div>
                                                     );
                                                 })}
                                             </div>

                                             {notes && (
                                                 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                                                     <p className="text-xs font-bold text-slate-500 uppercase">Observações</p>
                                                     <p className="text-sm text-slate-700 dark:text-slate-200 mt-2">{notes}</p>
                                                 </div>
                                             )}

                                             <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl p-4 text-sm text-emerald-800 dark:text-emerald-200 space-y-2">
                                                 <div className="flex items-center justify-between">
                                                     <span>Previsão</span>
                                                     <span className="font-bold">{store.deliveryTime || store.pickupTime || 'Consultar loja'}</span>
                                                 </div>
                                                <div className="flex items-center justify-between">
                                                    <span>Entrega</span>
                                                    <span className="font-bold">{deliveryFeeInfo.label}</span>
                                                </div>
                                                 {store.minOrderValue ? (
                                                     <div className="flex items-center justify-between">
                                                         <span>Pedido mínimo</span>
                                                         <span className="font-bold">{formatCurrencyBRL(store.minOrderValue)}</span>
                                                     </div>
                                                 ) : null}
                                             </div>
                                         </div>
                                     )}

                                     {buildableAlert && (
                                         <div className="p-3 rounded-xl bg-amber-50 text-amber-700 text-sm font-bold border border-amber-200">
                                             {buildableAlert}
                                         </div>
                                     )}
                                 </div>
                             ) : (
                                 <>
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
                                                          {splitCount >= 4 && <line x1="2" y1="50" x2="98" y2="50" stroke="#333" strokeWidth="2" />}
                                                          <circle cx="50" cy="50" r="42" fill="none" stroke="#ddd" strokeWidth="1" strokeDasharray="4 2" />
                                                      </svg>
                                                 </div>
                                             </div>
                                             
                                             {/* Selector Buttons (Only show up to maxFlavors) */}
                                             {maxFlavorsAllowed > 1 && (
                                                 <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
                                                     {[1, 2, 3, 4, 5].filter(n => n <= maxFlavorsAllowed).map(n => (
                                                         <button
                                                             key={n}
                                                             onClick={() => {
                                                                 setSplitCount(n);
                                                                 const newFlavorIds = [...selectedFlavorIds];
                                                                 for(let i=n; i<5; i++) newFlavorIds[i] = null;
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

                                             {selectedProduct.customerCanChoosePricingStrategy !== false && (
                                                 <div className="mb-6 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                                                     <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">Regra de preco</p>
                                                     <div className="flex flex-wrap gap-2">
                                                         {(selectedProduct.pricingStrategiesAllowed || ['NORMAL', 'PROPORCIONAL', 'MAX']).map((strategy) => (
                                                             <button
                                                                 key={strategy}
                                                                 onClick={() => setPricingStrategy(strategy)}
                                                                 className={`px-3 py-2 rounded-full text-xs font-bold border transition-all ${
                                                                     effectivePricingStrategy === strategy
                                                                         ? 'bg-orange-600 text-white border-orange-600'
                                                                         : 'bg-white dark:bg-slate-900 text-gray-500 border-gray-200 dark:border-slate-700 hover:bg-orange-50'
                                                                 }`}
                                                             >
                                                                 {PRICING_STRATEGIES.find((item) => item.id === strategy)?.label || strategy}
                                                             </button>
                                                         ))}
                                                     </div>
                                                 </div>
                                             )}

                                             {/* Flavor Slots */}
                                             <div className="space-y-3">
                                                 {Array.from({ length: splitCount }).map((_, idx) => {
                                                     const flavorId = selectedFlavorIds[idx];
                                                     const flavor = flavorId ? storeFlavors.find(f => f.id === flavorId) : null;
                                                     const sizeSelected = Boolean(selectedSizeKey || selectedSizeOption?.id);
                                                     const resolvedPrice = flavor ? resolveFlavorPrice(flavor) : { value: 0, found: false };
                                                     
                                                     return (
                                                         <div key={idx} className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
                                                             <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/20 text-orange-600 rounded-full flex items-center justify-center font-bold text-sm">
                                                                 {idx + 1}
                                                             </div>
                                                             <div className="flex-1">
                                                                 <p className="text-xs text-gray-400 uppercase font-bold mb-0.5">Sabor {idx + 1}</p>
                                                                 {flavor ? (
                                                                     <p className="font-bold text-slate-800 dark:text-white">
                                                                         {flavor.name}
                                                                         {sizeSelected && (
                                                                             <span className="text-sm font-semibold text-slate-500 dark:text-slate-300">
                                                                                 {' — '}
                                                                                 {resolvedPrice.found ? formatCurrencyBRL(resolvedPrice.value) : 'Indisponivel para este tamanho'}
                                                                             </span>
                                                                         )}
                                                                     </p>
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
                                             
                                             {splitCount > 1 && (
                                                 <div className="mt-4 flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 p-2 rounded-lg">
                                                     <Info size={14} />
                                                    <span>Divida os sabores sem custo adicional.</span>
                                                 </div>
                                             )}
                                         </div>
                                     )}

                                     {/* Visual Separator */}
                                     {orderedOptionGroups.length > 0 && (
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
                                         {orderedOptionGroups.map(group => {
                                             const isSizeGroup = group.id === 'size-group' || /tamanho|gramatura/i.test(group.name);
                                             const filteredOptions = isSizeGroup
                                                 ? group.options.filter((opt) => opt.isAvailable !== false)
                                                 : group.options;
                                             const maxAllowed = group.max > 0 ? group.max : filteredOptions.length;
                                             const selectedCount = (selectedOptions[group.id] || []).length;
                                             const orderedOptions = [...filteredOptions].sort((a, b) => (a.order || 0) - (b.order || 0));
                                             return (
                                                 <div key={group.id}>
                                                     <div className="flex justify-between items-end mb-4 bg-gray-50 dark:bg-slate-800 p-3 rounded-lg">
                                                         <div>
                                                             <h3 className="font-bold text-slate-800 dark:text-white text-base uppercase tracking-wide">{group.name}</h3>
                                                             <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                                 {maxAllowed === 1 ? 'Selecione 1 opção' : `Selecione até ${maxAllowed} opções`}
                                                             </p>
                                                             {maxAllowed === 1 && selectedCount > 0 && (
                                                                 <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Toque novamente para desmarcar.</p>
                                                             )}
                                                         </div>
                                                         {group.min > 0 && (
                                                             <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-gray-300 px-2 py-1 rounded font-bold uppercase">
                                                                 Obrigatório
                                                             </span>
                                                         )}
                                                     </div>
                                                     
                                                     <div className="space-y-3">
                                                         {orderedOptions.map(opt => {
                                                             const isSelected = (selectedOptions[group.id] || []).includes(opt.id);
                                                             return (
                                                                 <div 
                                                                    key={opt.id} 
                                                                    onClick={() => opt.isAvailable && handleOptionToggle(group.id, opt.id, maxAllowed)}
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
                                             );
                                         })}
                                     </div>

                                     {isBuildableFlow && buildableAlert && (
                                         <div className="mt-6 p-3 rounded-xl bg-amber-50 text-amber-700 text-sm font-bold border border-amber-200">
                                             {buildableAlert}
                                         </div>
                                     )}

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
                                 </>
                             )}
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
                                        onClick={() => {
                                            const sizeSelected = Boolean(selectedSizeKey || selectedSizeOption?.id);
                                            const resolvedPrice = resolveFlavorPrice(flavor);
                                            if (sizeSelected && !resolvedPrice.found) return;
                                            handleSelectFlavor(flavor.id);
                                        }}
                                        className={`flex items-center gap-4 p-3 rounded-xl border border-gray-100 dark:border-slate-800 cursor-pointer transition-all ${
                                            Boolean(selectedSizeKey || selectedSizeOption?.id) && !resolveFlavorPrice(flavor).found
                                                ? 'opacity-50 grayscale pointer-events-none'
                                                : 'hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center text-orange-600">
                                            <Slice size={18} />
                                        </div>
                                        <div className="flex-1">
                                            <h4 className="font-bold text-slate-800 dark:text-white">{flavor.name}</h4>
                                            <p className="text-xs text-gray-500 line-clamp-1">{flavor.description}</p>
                                        </div>
                                        <div className="text-sm font-bold text-slate-700 dark:text-gray-300">
                                            {(() => {
                                                const sizeSelected = Boolean(selectedSizeKey || selectedSizeOption?.id);
                                                const resolvedPrice = resolveFlavorPrice(flavor);
                                                if (!sizeSelected) {
                                                    return <span className="text-xs text-gray-400">Escolha tamanho</span>;
                                                }
                                                return resolvedPrice.found
                                                    ? formatCurrencyBRL(resolvedPrice.value)
                                                    : <span className="text-xs text-gray-400">Indisponivel para este tamanho</span>;
                                            })()}
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
                                {useBuildableWizard && buildableStep > 0 ? (
                                    <button
                                        onClick={handleBuildableBack}
                                        className="w-full sm:w-auto h-14 px-6 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold"
                                    >
                                        Voltar
                                    </button>
                                ) : null}
                                <button 
                                    onClick={useBuildableWizard ? handleBuildableNext : handleConfirmAdd}
                                    className="flex-1 w-full h-16 sm:h-14 rounded-2xl font-bold flex items-center gap-4 px-6 transition-all shadow-lg bg-red-600 hover:bg-red-700 text-white shadow-red-600/20 moving-border"
                                    style={{ '--moving-border-bg': '#dc2626' } as React.CSSProperties}
                                >
                                    {!useBuildableWizard && (
                                        <span className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                                            <ShoppingBag size={20} />
                                        </span>
                                    )}
                                    <span className="text-left leading-tight">
                                        <span className="block text-base sm:text-sm">{useBuildableWizard ? (buildableCurrent?.type === 'REVIEW' ? 'Confirmar pedido' : 'Continuar') : 'Adicionar'}</span>
                                    </span>
                                    <span className="ml-auto bg-white/20 px-3 py-1.5 rounded-full text-sm sm:text-xs">
                                        {formatCurrencyBRL(calculateTotal())}
                                    </span>
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
