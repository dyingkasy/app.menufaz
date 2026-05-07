import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, MapPin, ChevronRight, CreditCard, Banknote, ShoppingBag, Bike, Loader2, CheckCircle, User, Utensils, Lock, QrCode, Tag, X } from 'lucide-react';
import { CartItem, Store, Address, Coupon, Coordinates } from '../types';
import { createOrder, getCouponsByStore } from '../services/db';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyBRL } from '../utils/format';
import { imageKitUrl } from '../utils/imagekit';
import { searchAddress, calculateDistance, isPointInPolygon } from '../utils/geo';
import { extractNeighborhoodName, findDeliveryNeighborhood } from '../utils/neighborhood';
import { isValidCpf } from '../utils/cpf';
import { appAlert } from '../utils/appDialogs';
import { OrderPricingMode } from '../utils/productPricing';

interface CheckoutProps {
  store: Store;
  cartItems: CartItem[];
  orderType: OrderPricingMode;
  onOrderTypeChange: (value: OrderPricingMode) => void;
  address: Address | null;
  onBack: () => void;
  onOrderPlaced: () => void;
  onChangeAddress: () => void;
  onPixPayment?: (orderId: string) => void;
  tableContext?: {
    tableNumber: string;
    sessionId: string;
  };
  isTabletMode?: boolean;
}

const normalizeCoords = (coords?: Coordinates | null): Coordinates | null => {
    if (!coords) return null;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
};

const normalizeScheduleDay = (value: string) =>
    (value || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const parseTimeToMinutes = (value?: string | null) => {
    if (!value) return null;
    const [hours, minutes] = value.split(':').map((part) => Number(part));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
};

const isWithinRange = (now: number, start: number | null, end: number | null) => {
    if (start === null || end === null) return false;
    if (start <= end) return now >= start && now <= end;
    return now >= start || now <= end;
};

const Checkout: React.FC<CheckoutProps> = ({ 
  store, 
  cartItems, 
  orderType,
  onOrderTypeChange,
  address, 
  onBack, 
  onOrderPlaced,
  onChangeAddress,
  onPixPayment,
  tableContext,
  isTabletMode = false
}) => {
  const normalizeWhatsappNumber = (raw: string) => {
      const digits = (raw || '').replace(/\D/g, '');
      if (!digits) return '';
      if (digits.startsWith('55')) return digits;
      if (digits.length === 10 || digits.length === 11) return `55${digits}`;
      return digits;
  };

  const buildWhatsappMessage = ({
      storeName,
      orderNumber,
      itemsText,
      totalText,
      deliveryFeeText,
      paymentText,
      paymentStatusText,
      cashChangeText,
      orderTypeLabel,
      addressText,
      tableText,
      customerNameText,
      customerPhoneText,
      createdAtText
  }: {
      storeName: string;
      orderNumber: string;
      itemsText: string;
      totalText: string;
      deliveryFeeText?: string;
      paymentText: string;
      paymentStatusText?: string;
      cashChangeText?: string;
      orderTypeLabel: string;
      addressText?: string;
      tableText?: string;
      customerNameText: string;
      customerPhoneText?: string;
      createdAtText?: string;
  }) => {
      const lines = [
          `🧾 Pedido #${orderNumber} — ${storeName}`,
          createdAtText ? `🕒 ${createdAtText}` : null,
          '--------------------------------',
          `👤 Cliente: ${customerNameText || 'Cliente'}`,
          customerPhoneText ? `📞 Telefone: ${customerPhoneText}` : null,
          `📌 Tipo: ${orderTypeLabel}`,
          tableText ? `🍽️ Mesa: ${tableText}` : null,
          addressText ? `📍 Endereço: ${addressText}` : null,
          '--------------------------------',
          '🧺 Itens do pedido:',
          itemsText,
          '--------------------------------',
          deliveryFeeText ? `🚚 Taxa de entrega: ${deliveryFeeText}` : null,
          `💰 Total: ${totalText}`,
          `💳 Pagamento: ${paymentText}`,
          paymentStatusText ? `✅ ${paymentStatusText}` : null,
          cashChangeText ? `💵 ${cashChangeText}` : null,
          '--------------------------------',
          '✅ Obrigado pelo pedido!'
      ].filter(Boolean);
      return lines.join('\n');
  };
  const { user } = useAuth();
  const storePaymentMethods = Array.isArray(store.paymentMethods) ? store.paymentMethods : [];
  const pixOnlineEnabled =
      store.pix_enabled === true && store.pix_hashes_configured === true;
  const pixOfflineEnabled = storePaymentMethods.some((pm) => pm?.active !== false && pm?.type === 'PIX');
  const pixAvailable = pixOnlineEnabled || pixOfflineEnabled;
  const [paymentMethod, setPaymentMethod] = useState<'CREDIT' | 'PIX' | 'MONEY'>(() => {
      if (tableContext) return 'MONEY';
      if (store.acceptsCardOnDelivery) return 'CREDIT';
      if (pixAvailable) return 'PIX';
      return 'MONEY';
  });
  const [tableNumber, setTableNumber] = useState(tableContext?.tableNumber || '');
  const [customerName, setCustomerName] = useState('');
  const [customerNameError, setCustomerNameError] = useState('');
  const customerNameHydratedRef = useRef(false);
  const [cpf, setCpf] = useState('');
  const [showCpf, setShowCpf] = useState(false);
  const [cpfError, setCpfError] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [neighborhoodError, setNeighborhoodError] = useState('');
  const [deliveryZoneError, setDeliveryZoneError] = useState('');
  const isTableFlow = !!tableContext;
  const tabletNameKey = useMemo(() => {
      if (!isTabletMode) return '';
      const tableValue = (tableContext?.tableNumber || tableNumber || '').trim();
      if (!tableValue) return '';
      return `tablet_customer_name:${store.id}:${tableValue}`;
  }, [isTabletMode, store.id, tableContext?.tableNumber, tableNumber]);
  const canUseCard = store.acceptsCardOnDelivery;
  const deliveryFeeMode =
      store.deliveryFeeMode === 'BY_NEIGHBORHOOD'
          ? 'BY_NEIGHBORHOOD'
          : store.deliveryFeeMode === 'BY_RADIUS'
          ? 'BY_RADIUS'
          : 'FIXED';
  const deliveryNeighborhoods = Array.isArray(store.neighborhoodFees)
      ? store.neighborhoodFees
      : Array.isArray(store.deliveryNeighborhoods)
      ? store.deliveryNeighborhoods
      : [];
  const deliveryZones = Array.isArray(store.deliveryZones) ? store.deliveryZones : [];
  const [resolvedDeliveryCoords, setResolvedDeliveryCoords] = useState<Coordinates | null>(() =>
      normalizeCoords(address?.coordinates)
  );
  const lastGeocodeKeyRef = useRef('');
  
  // Discount & Processing
  const [couponCode, setCouponCode] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [couponMessage, setCouponMessage] = useState('');
  const [allCoupons, setAllCoupons] = useState<Coupon[]>([]);
  const [selectedCoupon, setSelectedCoupon] = useState<Coupon | null>(null);
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [moneyChange, setMoneyChange] = useState('');
  const isStoreClosed = store.isOpenNow === false;
  const [nowInSaoPaulo, setNowInSaoPaulo] = useState<Date>(
      () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  );

  // --- EFFECTS ---
  useEffect(() => {
      if (typeof window === 'undefined') return;
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (document?.documentElement) document.documentElement.scrollTop = 0;
      if (document?.body) document.body.scrollTop = 0;
  }, []);

  useEffect(() => {
      const tick = () => {
          setNowInSaoPaulo(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })));
      };
      const interval = setInterval(tick, 60000);
      return () => clearInterval(interval);
  }, []);

  useEffect(() => {
      if (user) {
          if ((user as any).cpf && !cpf) {
              setCpf((user as any).cpf);
              setShowCpf(true);
          }
          if ((user as any).phone && !phone && !isTabletMode) {
              setPhone((user as any).phone);
          }
          if ((user as any).name && !customerName && !customerNameHydratedRef.current) {
              setCustomerName((user as any).name);
              customerNameHydratedRef.current = true;
          }
      }
      if (isTabletMode && tabletNameKey && !customerName && !customerNameHydratedRef.current) {
          try {
              const storedName = localStorage.getItem(tabletNameKey) || '';
              if (storedName) {
                  setCustomerName(storedName);
                  customerNameHydratedRef.current = true;
              }
          } catch {}
      }
  }, [user, cpf, phone, customerName, isTabletMode, tabletNameKey]);

  useEffect(() => {
      if (!pixAvailable && paymentMethod === 'PIX') {
          const fallbackMethod = canUseCard ? 'CREDIT' : 'MONEY';
          setPaymentMethod(fallbackMethod);
          void appAlert('PIX não está disponível para esta loja.');
      }
  }, [paymentMethod, pixAvailable, canUseCard]);

  const deliveryScheduleStatus = useMemo(() => {
      const schedule = store.schedule || [];
      if (!Array.isArray(schedule) || schedule.length === 0) {
          return { allowed: true, reason: '' };
      }
      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      const todayName = dayNames[nowInSaoPaulo.getDay()] || '';
      const entry =
          schedule.find((item) => normalizeScheduleDay(item.day) === normalizeScheduleDay(todayName)) ||
          schedule[nowInSaoPaulo.getDay()] ||
          null;
      if (!entry) return { allowed: true, reason: '' };
      const nowMinutes = nowInSaoPaulo.getHours() * 60 + nowInSaoPaulo.getMinutes();
      const morningOpen = parseTimeToMinutes(entry.morningOpenTime);
      const morningClose = parseTimeToMinutes(entry.morningCloseTime);
      const afternoonOpen = parseTimeToMinutes(entry.afternoonOpenTime);
      const afternoonClose = parseTimeToMinutes(entry.afternoonCloseTime);

      if (entry.isMorningOpen && isWithinRange(nowMinutes, morningOpen, morningClose)) {
          if (entry.allowDeliveryMorning === false) {
              return { allowed: false, reason: 'A loja não faz entregas neste horário.' };
          }
      }

      if (entry.isAfternoonOpen && isWithinRange(nowMinutes, afternoonOpen, afternoonClose)) {
          if (entry.allowDeliveryAfternoon === false) {
              return { allowed: false, reason: 'A loja não faz entregas neste horário.' };
          }
      }

      return { allowed: true, reason: '' };
  }, [store.schedule, nowInSaoPaulo]);

  useEffect(() => {
      if (isTableFlow) return;
      if (store.acceptsDelivery === false && orderType === 'DELIVERY') {
          onOrderTypeChange(store.acceptsPickup ? 'PICKUP' : store.acceptsTableOrders ? 'TABLE' : 'DELIVERY');
      }
      if (!store.acceptsPickup && orderType === 'PICKUP') {
          onOrderTypeChange(store.acceptsDelivery !== false ? 'DELIVERY' : store.acceptsTableOrders ? 'TABLE' : 'PICKUP');
      }
      if (!store.acceptsTableOrders && orderType === 'TABLE') {
          onOrderTypeChange(store.acceptsDelivery !== false ? 'DELIVERY' : store.acceptsPickup ? 'PICKUP' : 'DELIVERY');
      }
  }, [store.acceptsDelivery, store.acceptsPickup, store.acceptsTableOrders, orderType, isTableFlow, onOrderTypeChange]);

  useEffect(() => {
      if (tableContext) {
          onOrderTypeChange('TABLE');
          setTableNumber(tableContext.tableNumber);
      }
  }, [tableContext, onOrderTypeChange]);

  useEffect(() => {
      if (!canUseCard && paymentMethod === 'CREDIT') {
          setPaymentMethod(pixAvailable ? 'PIX' : 'MONEY');
      }
  }, [canUseCard, paymentMethod, pixAvailable]);

  useEffect(() => {
      const normalized = normalizeCoords(address?.coordinates);
      if (normalized) {
          setResolvedDeliveryCoords(normalized);
          return;
      }
      setResolvedDeliveryCoords(null);
      if (orderType !== 'DELIVERY' || !address) return;

      const parts = [address.street, address.number, address.district, address.city, address.state]
          .map((value) => String(value || '').trim())
          .filter(Boolean);
      const query = parts.join(', ');
      if (!query) return;

      const key = query.toLowerCase();
      if (lastGeocodeKeyRef.current === key) return;
      lastGeocodeKeyRef.current = key;

      let cancelled = false;
      searchAddress(query)
          .then((results) => {
              if (cancelled) return;
              const coords = normalizeCoords(results?.[0]?.coordinates);
              if (coords) {
                  setResolvedDeliveryCoords(coords);
              }
          })
          .catch(() => {});
      return () => {
          cancelled = true;
      };
  }, [
      orderType,
      address?.street,
      address?.number,
      address?.district,
      address?.city,
      address?.state,
      address?.coordinates?.lat,
      address?.coordinates?.lng
  ]);

  useEffect(() => {
      if (orderType !== 'DELIVERY' || deliveryFeeMode !== 'BY_NEIGHBORHOOD') {
          setNeighborhoodError('');
          return;
      }
      const district = extractNeighborhoodName(address?.district);
      if (!district) {
          setNeighborhoodError('Informe o endereço completo com bairro.');
          return;
      }
      const match = findDeliveryNeighborhood(deliveryNeighborhoods, district);
      if (!match || match.active === false) {
          setNeighborhoodError(`Esta empresa não entrega no seu bairro: ${district}.`);
          return;
      }
      setNeighborhoodError('');
  }, [
      orderType,
      deliveryFeeMode,
      address?.district,
      deliveryNeighborhoods
  ]);

  const resolvedZone = useMemo(() => {
      if (orderType !== 'DELIVERY' || deliveryFeeMode !== 'BY_RADIUS') return null;
      if (!resolvedDeliveryCoords) {
          return { error: 'Informe um endereço válido para calcular o frete.' };
      }
      const activeZones = deliveryZones.filter((zone) => {
          if (!zone || zone.enabled === false) return false;
          const type = zone.type || 'RADIUS';
          if (type === 'POLYGON') {
              return Array.isArray(zone.polygonPath) && zone.polygonPath.length >= 3;
          }
          return (
              Number(zone.radiusMeters || 0) > 0 &&
              Number.isFinite(Number(zone.centerLat)) &&
              Number.isFinite(Number(zone.centerLng))
          );
      });
      if (activeZones.length === 0) {
          return { error: 'Nenhuma área de entrega configurada.' };
      }
      const matches = activeZones
          .map((zone) => {
              const type = zone.type || 'RADIUS';
              if (type === 'POLYGON') {
                  if (!isPointInPolygon(resolvedDeliveryCoords, zone.polygonPath || [])) return null;
                  return { zone, distanceMeters: 0, typeRank: 0 };
              }
              const distanceKm = calculateDistance(
                  { lat: zone.centerLat, lng: zone.centerLng },
                  resolvedDeliveryCoords
              );
              const distanceMeters = distanceKm * 1000;
              if (distanceMeters > Number(zone.radiusMeters || 0)) return null;
              return { zone, distanceMeters, typeRank: 1 };
          })
          .filter(Boolean);
      if (matches.length === 0) {
          return { error: 'Esta loja não entrega no seu endereço.' };
      }
      matches.sort((a, b) => {
          if (a.typeRank === 1 && b.typeRank === 1) {
              const radiusA = Number(a.zone.radiusMeters || 0);
              const radiusB = Number(b.zone.radiusMeters || 0);
              if (radiusA !== radiusB) return radiusA - radiusB;
              const distance = a.distanceMeters - b.distanceMeters;
              if (distance !== 0) return distance;
              const priorityA = Number(a.zone.priority || 0);
              const priorityB = Number(b.zone.priority || 0);
              return priorityB - priorityA;
          }
          const priorityA = Number(a.zone.priority || 0);
          const priorityB = Number(b.zone.priority || 0);
          if (priorityA !== priorityB) return priorityB - priorityA;
          if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
          const radiusA = Number(a.zone.radiusMeters || 0);
          const radiusB = Number(b.zone.radiusMeters || 0);
          if (radiusA !== radiusB) return radiusA - radiusB;
          return a.distanceMeters - b.distanceMeters;
      });
      const best = matches[0].zone;
      return {
          zone: best,
          fee: Number(best.fee || 0),
          etaMinutes: Number(best.etaMinutes || 0)
      };
  }, [orderType, deliveryFeeMode, resolvedDeliveryCoords, deliveryZones]);

  useEffect(() => {
      if (deliveryFeeMode !== 'BY_RADIUS') {
          setDeliveryZoneError('');
          return;
      }
      if (resolvedZone?.error) {
          setDeliveryZoneError(resolvedZone.error);
      } else {
          setDeliveryZoneError('');
      }
  }, [deliveryFeeMode, resolvedZone]);

  useEffect(() => {
      let active = true;
      const loadCoupons = async () => {
          try {
              const couponsData = await getCouponsByStore(store.id);
              if (!active) return;
              setAllCoupons(couponsData || []);
          } catch (error) {
              if (!active) return;
              setAllCoupons([]);
          }
      };
      loadCoupons();
      return () => {
          active = false;
      };
  }, [store.id]);

  // Calculations
  const subtotal = cartItems.reduce((acc, item) => acc + item.totalPrice, 0);
  const deliveryMinValue =
      typeof store.delivery_min_order_value === 'number' && store.delivery_min_order_value > 0
          ? store.delivery_min_order_value
          : 0;
  const pickupTime = store.pickupTime || store.deliveryTime;
  const resolvedNeighborhood = useMemo(() => {
      if (deliveryFeeMode !== 'BY_NEIGHBORHOOD') return null;
      const candidate = extractNeighborhoodName(address?.district);
      if (!candidate) return null;
      return findDeliveryNeighborhood(deliveryNeighborhoods, candidate);
  }, [deliveryFeeMode, address?.district, deliveryNeighborhoods]);
  const isNeighborhoodBlocked =
      orderType === 'DELIVERY' &&
      deliveryFeeMode === 'BY_NEIGHBORHOOD' &&
      (!!neighborhoodError || !resolvedNeighborhood || !resolvedNeighborhood.active);
  const isZoneBlocked =
      orderType === 'DELIVERY' &&
      deliveryFeeMode === 'BY_RADIUS' &&
      !!resolvedZone?.error;
  const deliveryFee =
      orderType === 'DELIVERY'
          ? deliveryFeeMode === 'BY_NEIGHBORHOOD'
              ? resolvedNeighborhood && resolvedNeighborhood.active && !neighborhoodError
                  ? Number(resolvedNeighborhood.fee) || 0
                  : 0
              : deliveryFeeMode === 'BY_RADIUS'
              ? Number(resolvedZone?.fee || 0)
              : Number(store.deliveryFee) || 0
          : 0;
  const total = subtotal + deliveryFee - discount;
  const deliverySubtotal = Math.max(0, subtotal - discount);
  const isBelowDeliveryMin =
      orderType === 'DELIVERY' && deliveryMinValue > 0 && deliverySubtotal < deliveryMinValue;
  const canPlaceOrder =
      !isProcessing &&
      !isStoreClosed &&
      !(
          orderType === 'DELIVERY' &&
          ((deliveryFeeMode === 'BY_NEIGHBORHOOD' && isNeighborhoodBlocked) ||
              (deliveryFeeMode === 'BY_RADIUS' && isZoneBlocked))
      );

  const couponStatus = (coupon: Coupon) => {
      if (!coupon.isActive) {
          return { eligible: false, reason: 'Cupom inativo.' };
      }
      if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
          return { eligible: false, reason: 'Cupom expirado.' };
      }
      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
          return { eligible: false, reason: 'Cupom esgotado.' };
      }
      if (coupon.minOrderValue > 0 && subtotal < coupon.minOrderValue) {
          const missing = Math.max(0, coupon.minOrderValue - subtotal);
          return { eligible: false, reason: `Faltam ${formatCurrencyBRL(missing)} para usar.` };
      }
      return { eligible: true, reason: '' };
  };

  const calculateCouponDiscount = (coupon: Coupon) => {
      const baseDiscount =
          coupon.discountType === 'PERCENTAGE'
              ? (subtotal * coupon.discountValue) / 100
              : coupon.discountValue;
      return Math.min(Math.max(0, baseDiscount), subtotal);
  };

  const formatCouponBenefit = (coupon: Coupon) =>
      coupon.discountType === 'PERCENTAGE'
          ? `${coupon.discountValue}% OFF`
          : `${formatCurrencyBRL(coupon.discountValue)} OFF`;

  const activeCoupons = useMemo(() => allCoupons.filter((coupon) => coupon.isActive), [allCoupons]);
  const eligibleCoupons = useMemo(
      () => activeCoupons.filter((coupon) => couponStatus(coupon).eligible),
      [activeCoupons, subtotal]
  );
  useEffect(() => {
      if (!selectedCoupon) {
          setDiscount(0);
          setCouponCode('');
          return;
      }
      const status = couponStatus(selectedCoupon);
      if (!status.eligible) {
          setDiscount(0);
          setCouponCode('');
          setCouponMessage(status.reason);
          return;
      }
      const applied = calculateCouponDiscount(selectedCoupon);
      setDiscount(applied);
      setCouponCode(selectedCoupon.code);
  }, [selectedCoupon, subtotal]);

  const handleApplyCoupon = (coupon: Coupon) => {
      const status = couponStatus(coupon);
      if (!status.eligible) {
          setCouponMessage(status.reason);
          setSelectedCoupon(null);
          return false;
      }
      setSelectedCoupon(coupon);
      setCouponInput(coupon.code);
      setCouponMessage(`Cupom aplicado: ${coupon.code}. Voce economizou ${formatCurrencyBRL(calculateCouponDiscount(coupon))}.`);
      return true;
  };

  const handleApplyCouponCode = () => {
      const code = couponInput.trim().toUpperCase();
      if (!code) {
          setCouponMessage('Informe um cupom.');
          return false;
      }
      const match = allCoupons.find((coupon) => coupon.code.toUpperCase() === code);
      if (!match) {
          setCouponMessage('Cupom nao encontrado para esta loja.');
          setSelectedCoupon(null);
          return false;
      }
      return handleApplyCoupon(match);
  };

  const handleRemoveCoupon = () => {
      setSelectedCoupon(null);
      setCouponCode('');
      setCouponMessage('Cupom removido.');
  };

  const handlePlaceOrder = async () => {
    if (orderType === 'DELIVERY' && store.acceptsDelivery === false) {
      await appAlert('Esta loja não aceita pedidos para entrega.');
      return;
    }
    if (orderType === 'DELIVERY' && deliveryScheduleStatus.allowed === false) {
      await appAlert(deliveryScheduleStatus.reason || 'Esta loja não entrega nesse horário.');
      return;
    }
    if (orderType === 'DELIVERY' && deliveryFeeMode === 'BY_NEIGHBORHOOD') {
      if (isNeighborhoodBlocked) {
        await appAlert(neighborhoodError || 'Esta empresa não entrega no seu bairro.');
        return;
      }
    }
    if (orderType === 'DELIVERY' && deliveryFeeMode === 'BY_RADIUS') {
      if (resolvedZone?.error) {
        await appAlert(resolvedZone.error);
        return;
      }
    }
    if (orderType === 'DELIVERY' && !address) {
      onChangeAddress();
      return;
    }
    if (isBelowDeliveryMin) {
      await appAlert(
        `Para entrega, o valor total do pedido precisa ser a partir de ${formatCurrencyBRL(deliveryMinValue)}.`
      );
      return;
    }
    if (!customerName.trim()) {
      setCustomerNameError('Informe o nome do cliente.');
      return;
    }
    if (orderType === 'TABLE' && !tableNumber.trim()) {
      await appAlert('Informe o número da mesa.');
      return;
    }
    const phoneDigits = isTabletMode ? '' : phone.replace(/\D/g, '');
    if (!isTabletMode && orderType !== 'TABLE') {
      if (!phoneDigits) {
        await appAlert('Informe um telefone para contato.');
        return;
      }
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        await appAlert('Telefone inválido. Informe DDD + número.');
        return;
      }
    }

    // Validação CPF
    if (orderType !== 'TABLE' && showCpf && cpf && !isValidCpf(cpf)) {
        await appAlert('CPF inválido. Verifique os números.');
        return;
    }

    setIsProcessing(true);
    
    try {
        let deliveryCoords = resolvedDeliveryCoords || normalizeCoords(address?.coordinates);
        if (orderType === 'DELIVERY' && deliveryFeeMode === 'BY_RADIUS' && address && !deliveryCoords) {
            const queryParts = [address.street, address.number, address.district, address.city, address.state]
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            const queryText = queryParts.join(', ');
            if (!queryText) {
                await appAlert('Endereço incompleto. Confirme rua, número e cidade.');
                setIsProcessing(false);
                return;
            }
            const results = await searchAddress(queryText);
            if (!results.length) {
                await appAlert('Não foi possível localizar o endereço para entrega.');
                setIsProcessing(false);
                return;
            }
            deliveryCoords = normalizeCoords(results[0].coordinates);
        }

        const itemsDescription = cartItems.map(item => {
            const opts = item.options.map(o => o.optionName).join(', ');
            return `${item.quantity}x ${item.product.name} ${opts ? `(${opts})` : ''} ${item.notes ? `[Obs: ${item.notes}]` : ''}`;
        });

        const paymentContext =
            orderType === 'DELIVERY' ? 'na entrega' : orderType === 'PICKUP' ? 'na retirada' : 'na mesa';
        let paymentDescription = '';
        if (orderType !== 'TABLE') {
            if (paymentMethod === 'CREDIT') {
                paymentDescription = `Cartão ${paymentContext}`;
            } else if (paymentMethod === 'PIX') {
                paymentDescription = pixOnlineEnabled ? 'PIX (Online)' : 'Pix';
            } else {
                paymentDescription = `Dinheiro ${paymentContext}${moneyChange ? ` (Troco p/ ${moneyChange})` : ''}`;
            }
        }

        const tableValue = tableNumber.trim();
        const storeAddressPayload = (store.street || store.number || store.city)
            ? {
                id: store.id,
                label: store.name,
                street: store.street || '',
                number: store.number || '',
                district: store.district || '',
                city: store.city || '',
                state: store.state || '',
                coordinates: store.coordinates
            }
            : undefined;

        const lineItems = cartItems.map((item) => ({
            productId: item.product.id,
            name: item.product.name,
            quantity: item.quantity,
            unitPrice: item.totalPrice / Math.max(1, item.quantity),
            totalPrice: item.totalPrice,
            notes: item.notes,
            options: item.options,
            pizza: item.pizza
        }));

        const storePhoneRaw = store.whatsapp || store.phone || '';
        const whatsappNumber = normalizeWhatsappNumber(storePhoneRaw);
        if (store.whatsappOrderRequired && !whatsappNumber) {
            await appAlert('Esta loja exige envio pelo WhatsApp, mas não possui número configurado.');
            setIsProcessing(false);
            return;
        }

        const createdOrder = await createOrder({
            storeId: store.id,
            storeName: store.name,
            userId: user?.uid,
            customerName: customerName.trim(),
            items: itemsDescription,
            lineItems,
            total: total,
            deliveryFee: orderType === 'DELIVERY' ? deliveryFee : 0,
            deliveryNeighborhood:
                orderType === 'DELIVERY' && deliveryFeeMode === 'BY_NEIGHBORHOOD'
                    ? resolvedNeighborhood?.name
                    : undefined,
            deliveryZoneId:
                orderType === 'DELIVERY' && deliveryFeeMode === 'BY_RADIUS'
                    ? resolvedZone?.zone?.id
                    : undefined,
            deliveryZoneName:
                orderType === 'DELIVERY' && deliveryFeeMode === 'BY_RADIUS'
                    ? resolvedZone?.zone?.name
                    : undefined,
            deliveryEtaMinutes:
                orderType === 'DELIVERY' && deliveryFeeMode === 'BY_RADIUS'
                    ? resolvedZone?.etaMinutes
                    : undefined,
            time: new Date().toLocaleTimeString(),
            notes: orderType === 'PICKUP' ? 'RETIRADA NO BALCÃO' : orderType === 'TABLE' ? `MESA ${tableValue}` : '', 
            paymentMethod: paymentDescription,
            paymentProvider:
                orderType !== 'TABLE' && paymentMethod === 'PIX' && pixOnlineEnabled
                    ? 'PIX_REPASSE'
                    : undefined,
            refundStatus: 'NONE',
            storeCity: store.city, 
            storeCoordinates: store.coordinates,
            deliveryCoordinates: orderType === 'DELIVERY' ? deliveryCoords : undefined,
            storeAddress: storeAddressPayload,
            deliveryAddress: orderType === 'DELIVERY' && address ? {
                street: address.street,
                number: address.number,
                district: address.district,
                city: address.city,
                state: address.state,
                complement: address.complement,
                label: address.label,
                coordinates: deliveryCoords || address.coordinates
            } : undefined,
            type: orderType,
            pickup: orderType === 'PICKUP',
            tableNumber: orderType === 'TABLE' ? tableValue : undefined,
            tableSessionId: orderType === 'TABLE' ? tableContext?.sessionId : undefined,
            cpf: orderType !== 'TABLE' && showCpf ? cpf : '',
            customerPhone: orderType !== 'TABLE' ? phoneDigits || undefined : undefined,
            couponCode: orderType !== 'TABLE' ? selectedCoupon?.code : undefined,
            couponId: orderType !== 'TABLE' ? selectedCoupon?.id : undefined,
            couponDiscount: orderType !== 'TABLE' && discount > 0 ? discount : undefined
        });
        if (createdOrder?.customerId) {
            localStorage.setItem('customerId', createdOrder.customerId);
        }
        if (phoneDigits) {
            localStorage.setItem('customerPhone', phoneDigits);
        }
        if (isTabletMode && customerName.trim() && tabletNameKey) {
            try {
                localStorage.setItem(tabletNameKey, customerName.trim());
            } catch {}
        }
        if (createdOrder?.id) {
            localStorage.setItem('lastOrderId', createdOrder.id);
        }

        if (store.whatsappOrderRequired && whatsappNumber) {
            const orderNumberValue =
                createdOrder?.orderNumber ||
                (createdOrder?.id ? createdOrder.id.slice(0, 5) : '');
            const orderTypeLabel =
                orderType === 'DELIVERY' ? 'Entrega' : orderType === 'PICKUP' ? 'Retirada' : 'Mesa';
            const addressText =
                orderType === 'DELIVERY' && address
                    ? `${address.street}, ${address.number} - ${address.district || ''} ${address.city || ''}`.trim()
                    : '';
            const itemsText = itemsDescription.join('\n');
            const pixPaid =
                paymentMethod === 'PIX' &&
                createdOrder?.paymentProvider === 'PIX_REPASSE' &&
                String(createdOrder?.paymentStatus || '').toUpperCase() === 'PAID';
            const cashChangeText =
                paymentMethod === 'CASH' && moneyChange ? `Troco para ${moneyChange}` : '';
            const message = buildWhatsappMessage({
                storeName: store.name,
                orderNumber: String(orderNumberValue || '--'),
                itemsText: itemsText || '-',
                totalText: formatCurrencyBRL(total),
                deliveryFeeText: orderType === 'DELIVERY' ? formatCurrencyBRL(deliveryFee) : '',
                paymentText: paymentDescription,
                paymentStatusText: pixPaid ? 'PIX confirmado' : '',
                cashChangeText: cashChangeText || undefined,
                orderTypeLabel,
                addressText: addressText || undefined,
                tableText: orderType === 'TABLE' ? tableValue : undefined,
                customerNameText: customerName.trim(),
                customerPhoneText: phoneDigits || undefined,
                createdAtText: new Date().toLocaleString('pt-BR')
            });
            const waUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
            window.open(waUrl, '_blank');
        }

        if (createdOrder?.payment?.provider === 'PIX_REPASSE' && createdOrder?.id && onPixPayment) {
            onPixPayment(createdOrder.id);
            setIsProcessing(false);
            return;
        }

        setIsSuccess(true);
        setTimeout(() => {
            onOrderPlaced();
        }, 2500);

    } catch (error) {
        console.error("Error placing order:", error);
        const message =
            error instanceof Error && error.message
                ? error.message
                : "Erro ao realizar pedido. Tente novamente.";
        await appAlert(message);
    } finally {
        setIsProcessing(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-900 flex flex-col items-center justify-center p-8 text-center animate-fade-in">
        <div className="w-24 h-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6 animate-bounce-subtle">
          <CheckCircle size={60} className="text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-3xl font-extrabold text-slate-800 dark:text-white mb-2">Pedido Confirmado!</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-8 text-lg">
          A loja <span className="font-bold text-slate-800 dark:text-white">{store.name}</span> já recebeu seu pedido e começará o preparo em instantes.
        </p>
        <p className="text-sm text-gray-400 animate-pulse">
          {isTableFlow ? 'Abrindo acompanhamento da mesa...' : user ? 'Redirecionando para Meus Pedidos...' : 'Voltando para a tela inicial...'}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-sans pb-32">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 sticky top-0 z-30 border-b border-gray-200 dark:border-slate-800">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors"
            >
              <ArrowLeft className="text-slate-700 dark:text-white" />
            </button>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">Finalizar Pedido</h1>
          </div>
          <div className="text-sm font-bold text-gray-500 dark:text-gray-400 hidden sm:flex items-center gap-2">
             {store.logoUrl && (
                <img
                    src={imageKitUrl(store.logoUrl, { width: 80, quality: 70 })}
                    alt={`Logo ${store.name}`}
                    loading="lazy"
                    decoding="async"
                    className="w-6 h-6 rounded-full object-contain border border-gray-200 dark:border-slate-700 bg-white p-0.5"
                />
             )}
             {store.name}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {isStoreClosed && (
          <section className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-2xl flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
              <Lock size={18} />
            </div>
            <div>
              <p className="font-bold">Loja fechada no momento</p>
              <p className="text-sm">Verifique os horários de funcionamento para fazer seu pedido.</p>
            </div>
          </section>
        )}
        
        {/* DELIVERY TYPE TOGGLE */}
        {!isTableFlow && (
          <section className="bg-white dark:bg-slate-900 p-1.5 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 flex">
              {store.acceptsDelivery !== false && (
                  <button 
                      onClick={() => onOrderTypeChange('DELIVERY')}
                      className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'DELIVERY' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                  >
                      <Bike size={18} /> Entrega
                  </button>
              )}
              <button 
                  onClick={() => store.acceptsPickup && onOrderTypeChange('PICKUP')}
                  disabled={!store.acceptsPickup}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'PICKUP' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'} disabled:opacity-50`}
              >
                  <ShoppingBag size={18} /> Retirada
              </button>
              <button 
                  onClick={() => store.acceptsTableOrders && onOrderTypeChange('TABLE')}
                  disabled={!store.acceptsTableOrders}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'TABLE' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'} disabled:opacity-50`}
              >
                  <Utensils size={18} /> Mesa
              </button>
          </section>
        )}
        {!isTableFlow && orderType === 'DELIVERY' && deliveryScheduleStatus.allowed === false && (
          <section className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                  <Lock size={18} />
              </div>
              <div>
                  <p className="font-bold">Entrega indisponível agora</p>
                  <p className="text-sm">{deliveryScheduleStatus.reason || 'A loja não faz entregas neste horário.'}</p>
              </div>
          </section>
        )}

        {/* Delivery Address */}
        <section>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <MapPin size={16} /> {orderType === 'DELIVERY' ? 'Endereço de Entrega' : orderType === 'TABLE' ? 'Mesa' : 'Local de Retirada'}
            </h3>
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                        {orderType === 'DELIVERY' ? <MapPin size={24} /> : orderType === 'TABLE' ? <Utensils size={24} /> : <ShoppingBag size={24} />}
                    </div>
                    <div>
                        {orderType === 'DELIVERY' ? (
                            address ? (
                                <>
                                    <p className="font-bold text-slate-800 dark:text-white text-sm">{address.street}, {address.number}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{address.label} • {store.deliveryTime}</p>
                                </>
                            ) : (
                                <p className="font-bold text-red-600">Selecione um endereço</p>
                            )
                        ) : orderType === 'TABLE' ? (
                            <>
                                <p className="font-bold text-slate-800 dark:text-white text-sm">{store.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Pedido na mesa</p>
                            </>
                        ) : (
                            <>
                                <p className="font-bold text-slate-800 dark:text-white text-sm">{store.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Retirar no balcão da loja • {pickupTime}</p>
                            </>
                        )}
                    </div>
                </div>
                {orderType === 'DELIVERY' && (
                    <button 
                        onClick={onChangeAddress}
                        className="text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition-colors"
                    >
                        {address ? 'Alterar' : 'Escolher'}
                    </button>
                )}
            </div>
            {orderType === 'DELIVERY' && deliveryFeeMode === 'BY_NEIGHBORHOOD' && (
                <div className="mt-4 space-y-2">
                    {neighborhoodError ? (
                        <p className="text-xs text-red-600">{neighborhoodError}</p>
                    ) : resolvedNeighborhood ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Bairro identificado: <span className="font-semibold">{resolvedNeighborhood.name}</span>
                        </p>
                    ) : (
                        <p className="text-xs text-amber-600">
                            Informe um endereço completo para identificar o bairro.
                        </p>
                    )}
                </div>
            )}
            {orderType === 'DELIVERY' && deliveryFeeMode === 'BY_RADIUS' && (
                <div className="mt-4 space-y-2">
                    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                        {resolvedZone?.zone ? (
                            <div className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                                <div className="flex items-center justify-between font-semibold">
                                    <span>{resolvedZone.zone.name}</span>
                                    <span>{resolvedZone.fee && resolvedZone.fee > 0 ? formatCurrencyBRL(resolvedZone.fee) : 'Grátis'}</span>
                                </div>
                                <div className="text-xs text-slate-500">
                                    Tempo estimado: {resolvedZone.etaMinutes ? `${resolvedZone.etaMinutes} min` : store.deliveryTime}
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-slate-500">Informe um endereço para calcular o frete.</p>
                        )}
                    </div>
                    {deliveryZoneError && (
                        <p className="text-xs text-red-600">{deliveryZoneError}</p>
                    )}
                </div>
            )}
            {orderType === 'TABLE' && (
                <div className="mt-4">
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-2">Número da Mesa</label>
                    <input
                        type="text"
                        value={tableNumber}
                        onChange={(e) => setTableNumber(e.target.value)}
                        readOnly={isTableFlow}
                        className={`w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white ${isTableFlow ? 'opacity-80 cursor-not-allowed' : ''}`}
                        placeholder="Ex: 12"
                    />
                </div>
            )}
        </section>

        {!isTabletMode && (
            <section>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                    <CreditCard size={16} /> Resumo
                </h3>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="p-5 max-h-60 overflow-y-auto">
                        {cartItems.map(item => (
                            <div key={item.id} className="flex justify-between mb-4 last:mb-0">
                                <div className="flex gap-3">
                                    <span className="bg-gray-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 w-6 h-6 flex items-center justify-center rounded font-bold text-xs shrink-0">
                                        {item.quantity}x
                                    </span>
                                    <div>
                                        <p className="text-sm font-medium text-slate-800 dark:text-white leading-tight">{item.product.name}</p>
                                        {item.options.length > 0 && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                {item.options.map(o => o.optionName).join(', ')}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <p className="text-sm font-medium text-slate-800 dark:text-white">{formatCurrencyBRL(item.totalPrice)}</p>
                            </div>
                        ))}
                    </div>
                    <div className="p-5 space-y-2 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
                        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                            <span>Subtotal</span>
                            <span>{formatCurrencyBRL(subtotal)}</span>
                        </div>
                        {orderType === 'DELIVERY' && (
                            <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                                <span>Taxa de Entrega</span>
                                {deliveryFeeMode === 'BY_NEIGHBORHOOD' ? (
                                    isNeighborhoodBlocked ? (
                                        <span className="text-red-600 font-semibold">Indisponível</span>
                                    ) : (
                                        <span>{deliveryFee === 0 ? 'Grátis' : formatCurrencyBRL(deliveryFee)}</span>
                                    )
                                ) : deliveryFeeMode === 'BY_RADIUS' ? (
                                    deliveryZoneError ? (
                                        <span className="text-red-600 font-semibold">Indisponível</span>
                                    ) : (
                                        <span>{deliveryFee === 0 ? 'Grátis' : formatCurrencyBRL(deliveryFee)}</span>
                                    )
                                ) : (
                                    <span>{deliveryFee === 0 ? 'Grátis' : formatCurrencyBRL(deliveryFee)}</span>
                                )}
                            </div>
                        )}
                        {discount > 0 && (
                            <div className="flex justify-between text-sm text-green-600 font-bold">
                                <span>Desconto</span>
                                <span>- {formatCurrencyBRL(discount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-xl font-extrabold text-slate-800 dark:text-white pt-3 mt-2 border-t border-gray-100 dark:border-slate-800">
                            <span>Total</span>
                            <span>{formatCurrencyBRL(total)}</span>
                        </div>
                    </div>
                </div>
            </section>
        )}

        {!isTabletMode && orderType !== 'TABLE' && (
            <section>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                    <Tag size={16} /> Cupons de desconto
                </h3>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm p-4 sm:p-5 space-y-4">
                    {selectedCoupon && discount > 0 && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-900/20">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                                        Cupom aplicado
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <span className="rounded-lg bg-white px-2.5 py-1 text-sm font-black tracking-widest text-emerald-700 shadow-sm dark:bg-emerald-950 dark:text-emerald-200">
                                            {selectedCoupon.code}
                                        </span>
                                        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-200">
                                            Voce economizou {formatCurrencyBRL(discount)}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRemoveCoupon}
                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                                    aria-label="Remover cupom"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => setShowCouponModal(true)}
                        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200"
                    >
                        <span className="min-w-0">
                            <span className="block text-sm font-black">
                                Ver cupons disponiveis
                            </span>
                            <span className="block text-xs font-semibold opacity-80">
                                {eligibleCoupons.length > 0
                                    ? `${eligibleCoupons.length} cupom(ns) que voce pode usar agora`
                                    : activeCoupons.length > 0
                                        ? 'Veja quais cupons estao bloqueados para este pedido'
                                        : 'Nenhum cupom ativo no momento'}
                            </span>
                        </span>
                        <ChevronRight size={20} className="shrink-0" />
                    </button>

                    {couponMessage && (
                        <p className={`text-sm font-semibold ${
                            selectedCoupon && discount > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'
                        }`}>
                            {couponMessage}
                        </p>
                    )}
                </div>
            </section>
        )}

        {showCouponModal && !isTabletMode && orderType !== 'TABLE' && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
                <div className="max-h-[90vh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-950 sm:max-w-xl sm:rounded-3xl">
                    <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-slate-800">
                        <div>
                            <h3 className="text-lg font-black text-slate-900 dark:text-white">Cupons de desconto</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">Escolha um cupom e volte para finalizar o pedido.</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowCouponModal(false)}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                            aria-label="Fechar cupons"
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <div className="max-h-[calc(90vh-96px)] overflow-y-auto p-5">
                        <div className="space-y-3">
                            {activeCoupons.length > 0 ? (
                                activeCoupons.map((coupon) => {
                                    const status = couponStatus(coupon);
                                    const isSelected = selectedCoupon?.id === coupon.id;
                                    return (
                                        <div
                                            key={coupon.id}
                                            className={`rounded-2xl border p-4 ${
                                                status.eligible
                                                    ? isSelected
                                                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                                                        : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                                                    : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                                            }
                                            `}
                                        >
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className={`font-black tracking-widest ${status.eligible ? 'text-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                                                            {coupon.code}
                                                        </p>
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-black ${
                                                            status.eligible
                                                                ? 'bg-emerald-600 text-white'
                                                                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                                        }`}>
                                                            {formatCouponBenefit(coupon)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                        {coupon.description || 'Cupom disponivel'}
                                                    </p>
                                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                                                        {coupon.minOrderValue > 0 && (
                                                            <span>Pedido minimo {formatCurrencyBRL(coupon.minOrderValue)}</span>
                                                        )}
                                                        {coupon.expiresAt && (
                                                            <span>Valido ate {new Date(coupon.expiresAt).toLocaleDateString()}</span>
                                                        )}
                                                    </div>
                                                    {!status.eligible && (
                                                        <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">{status.reason}</p>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={!status.eligible}
                                                    onClick={() => {
                                                        if (handleApplyCoupon(coupon)) setShowCouponModal(false);
                                                    }}
                                                    className={`w-full rounded-xl px-4 py-2 text-sm font-bold sm:w-auto ${
                                                        isSelected
                                                            ? 'bg-emerald-600 text-white'
                                                            : 'bg-white border border-slate-200 text-slate-700 hover:border-emerald-400 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100'
                                                    } disabled:cursor-not-allowed disabled:opacity-50`}
                                                >
                                                    {isSelected ? 'Aplicado' : 'Aplicar'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                                    Nenhum cupom ativo no momento.
                                </p>
                            )}
                        </div>

                        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
                            <p className="mb-2 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                                Tenho um codigo de cupom
                            </p>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <input
                                    type="text"
                                    value={couponInput}
                                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                                    placeholder="Digite o codigo"
                                    className="min-w-0 flex-1 rounded-xl border bg-slate-50 p-3 text-sm font-bold uppercase tracking-wide dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (handleApplyCouponCode()) setShowCouponModal(false);
                                    }}
                                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:opacity-90 dark:bg-white dark:text-slate-900"
                                >
                                    Aplicar codigo
                                </button>
                            </div>
                        </div>

                        {couponMessage && (
                            <p className={`mt-3 text-sm font-semibold ${
                                selectedCoupon && discount > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'
                            }`}>
                                {couponMessage}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Contact Phone */}
        <section>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <User size={16} /> Nome do cliente
            </h3>
            <input
                type="text"
                placeholder="Nome completo"
                value={customerName}
                onChange={(e) => {
                    customerNameHydratedRef.current = true;
                    setCustomerName(e.target.value);
                    if (e.target.value.trim()) setCustomerNameError('');
                }}
                className={`w-full p-4 bg-white dark:bg-slate-900 border rounded-2xl outline-none focus:ring-2 dark:text-white ${customerNameError ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-800 focus:ring-red-500'}`}
            />
            {customerNameError && <p className="text-xs text-red-600 mt-1 font-bold ml-1">{customerNameError}</p>}
        </section>

        {!isTabletMode && orderType !== 'TABLE' && (
            <section>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                    <User size={16} /> Telefone para contato
                </h3>
                <input
                    type="tel"
                    placeholder="(11) 99999-9999"
                    value={phone}
                    onChange={(e) => {
                        let v = e.target.value.replace(/\D/g, '');
                        if (v.length > 11) v = v.slice(0, 11);
                        v = v.replace(/(\d{2})(\d)/, '($1) $2');
                        v = v.replace(/(\d{5})(\d)/, '$1-$2');
                        setPhone(v);
                        const digits = v.replace(/\D/g, '');
                        if (digits.length > 0 && digits.length < 10) {
                            setPhoneError('Informe DDD + número.');
                        } else {
                            setPhoneError('');
                        }
                    }}
                    className={`w-full p-4 bg-white dark:bg-slate-900 border rounded-2xl outline-none focus:ring-2 dark:text-white ${phoneError ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-800 focus:ring-red-500'}`}
                />
                {phoneError && <p className="text-xs text-red-600 mt-1 font-bold ml-1">{phoneError}</p>}
            </section>
        )}

        {!isTabletMode && orderType !== 'TABLE' && (
        <section>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <User size={16} /> CPF na Nota (Opcional)
            </h3>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 font-medium mb-3">
                <input
                    type="checkbox"
                    checked={showCpf}
                    onChange={(e) => {
                        const checked = e.target.checked;
                        setShowCpf(checked);
                        if (!checked) {
                            setCpf('');
                            setCpfError('');
                        }
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                Quero informar CPF na nota
            </label>
            {showCpf && (
                <>
                    <input 
                        type="text" 
                        placeholder="000.000.000-00" 
                        value={cpf}
                        onChange={(e) => {
                            let v = e.target.value.replace(/\D/g, '');
                            if(v.length > 11) v = v.slice(0, 11);
                            v = v.replace(/(\d{3})(\d)/, '$1.$2');
                            v = v.replace(/(\d{3})(\d)/, '$1.$2');
                            v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
                            setCpf(v);
                            
                            if(v && !isValidCpf(v)) setCpfError('CPF inválido');
                            else setCpfError('');
                        }}
                        className={`w-full p-4 bg-white dark:bg-slate-900 border rounded-2xl outline-none focus:ring-2 dark:text-white ${cpfError ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-800 focus:ring-red-500'}`}
                    />
                    {cpfError && <p className="text-xs text-red-600 mt-1 font-bold ml-1">{cpfError}</p>}
                </>
            )}
        </section>
        )}

        {!isTabletMode && orderType !== 'TABLE' && (
        <section>
             <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <Banknote size={16} /> Pagamento
            </h3>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="flex border-b border-gray-100 dark:border-slate-800">
                    {canUseCard && (
                        <button onClick={() => setPaymentMethod('CREDIT')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'CREDIT' ? 'text-red-600 bg-red-50 dark:bg-red-900/10 border-b-2 border-red-600' : 'text-gray-500'}`}><CreditCard size={18} /> Cartão</button>
                    )}
                    {pixAvailable && (
                        <button onClick={() => setPaymentMethod('PIX')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'PIX' ? 'text-green-600 bg-green-50 dark:bg-green-900/10 border-b-2 border-green-600' : 'text-gray-500'}`}><QrCode size={18} /> Pix</button>
                    )}
                    <button onClick={() => setPaymentMethod('MONEY')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'MONEY' ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/10 border-b-2 border-blue-600' : 'text-gray-500'}`}><Banknote size={18} /> Dinheiro</button>
                </div>
                <div className="p-6">
                    {paymentMethod === 'CREDIT' && (
                        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4 text-sm text-gray-600 dark:text-gray-300">
                            Pagamento com cartão será realizado {orderType === 'DELIVERY' ? 'na entrega' : orderType === 'PICKUP' ? 'na retirada' : 'na mesa'}, direto na maquininha.
                        </div>
                    )}
                    {paymentMethod === 'MONEY' && (
                        <div className="space-y-4">
                            <label className="block text-sm font-bold text-slate-700 dark:text-gray-300">Precisa de troco para quanto?</label>
                            <input type="number" value={moneyChange} onChange={e => setMoneyChange(e.target.value)} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:text-white" placeholder="R$ 0,00" />
                        </div>
                    )}
                    {paymentMethod === 'PIX' && pixOnlineEnabled && (
                        <div className="text-center p-4">
                            <p className="font-bold text-slate-800 dark:text-white">Pix</p>
                            <p className="text-sm text-gray-500">
                                Pagamento online com QR Code e copia e cola.
                            </p>
                        </div>
                    )}
                    {paymentMethod === 'PIX' && !pixOnlineEnabled && pixAvailable && (
                        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4 text-sm text-gray-600 dark:text-gray-300">
                            Pagamento via PIX será combinado com a loja após o pedido.
                        </div>
                    )}
                </div>
            </div>
        </section>
        )}

      </main>

      {/* Fixed Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 p-4 z-30">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-4">
            <div className="w-full sm:w-auto flex justify-between sm:block flex-1">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Total a Pagar</p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{formatCurrencyBRL(total)}</p>
            </div>
            <button 
                onClick={handlePlaceOrder}
                disabled={!canPlaceOrder}
                className="w-full sm:w-auto sm:min-w-[250px] bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-red-600/20 transition-all hover:scale-[1.02] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
                {isProcessing ? (
                    <Loader2 className="animate-spin" size={24} />
                ) : (
                    <>Fazer Pedido <ChevronRight size={20} /></>
                )}
            </button>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
