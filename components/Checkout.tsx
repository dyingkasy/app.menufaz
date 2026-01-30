import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, MapPin, ChevronRight, CreditCard, Banknote, ShoppingBag, Bike, Loader2, CheckCircle, User, Utensils, Lock } from 'lucide-react';
import { CartItem, Store, Address, Coupon, Coordinates } from '../types';
import { createOrder, getCouponsByStore } from '../services/db';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyBRL } from '../utils/format';
import { imageKitUrl } from '../utils/imagekit';
import { searchAddress, calculateDistance, isPointInPolygon } from '../utils/geo';

interface CheckoutProps {
  store: Store;
  cartItems: CartItem[];
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

// --- Validation Helpers ---
const isValidCPF = (cpf: string) => {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11 || !!cpf.match(/(\d)\1{10}/)) return false;
    let sum = 0;
    let remainder;
    for (let i = 1; i <= 9; i++) sum = sum + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(9, 10))) return false;
    sum = 0;
    for (let i = 1; i <= 10; i++) sum = sum + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    remainder = (sum * 10) % 11;
    if ((remainder === 10) || (remainder === 11)) remainder = 0;
    if (remainder !== parseInt(cpf.substring(10, 11))) return false;
    return true;
};

const normalizeCoords = (coords?: Coordinates | null): Coordinates | null => {
    if (!coords) return null;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
};

const normalizeNeighborhoodName = (value: string) =>
    (value || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const extractNeighborhoodName = (district?: string) => {
    const raw = (district || '').toString().trim();
    if (!raw) return '';
    const dashSplit = raw.split(' - ');
    const commaSplit = raw.split(',');
    return (dashSplit[0] || commaSplit[0] || raw).trim();
};

const Checkout: React.FC<CheckoutProps> = ({ 
  store, 
  cartItems, 
  address, 
  onBack, 
  onOrderPlaced,
  onChangeAddress,
  onPixPayment,
  tableContext,
  isTabletMode = false
}) => {
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
  const [orderType, setOrderType] = useState<'DELIVERY' | 'PICKUP' | 'TABLE'>(() => {
    if (tableContext) return 'TABLE';
    if (store.acceptsDelivery === false) {
      if (store.acceptsPickup) return 'PICKUP';
      if (store.acceptsTableOrders) return 'TABLE';
    }
    return 'DELIVERY';
  });
  const [tableNumber, setTableNumber] = useState(tableContext?.tableNumber || '');
  const [customerName, setCustomerName] = useState('');
  const [customerNameError, setCustomerNameError] = useState('');
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
  const [discount, setDiscount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [moneyChange, setMoneyChange] = useState('');
  const isStoreClosed = store.isOpenNow === false;

  // --- EFFECTS ---

  useEffect(() => {
      if (user) {
          if ((user as any).cpf && !cpf) {
              setCpf((user as any).cpf);
              setShowCpf(true);
          }
          if ((user as any).phone && !phone && !isTabletMode) {
              setPhone((user as any).phone);
          }
          if ((user as any).name && !customerName) {
              setCustomerName((user as any).name);
          }
      }
      if (isTabletMode && tabletNameKey && !customerName) {
          try {
              const storedName = localStorage.getItem(tabletNameKey) || '';
              if (storedName) {
                  setCustomerName(storedName);
              }
          } catch {}
      }
  }, [user, cpf, phone, customerName, isTabletMode, tabletNameKey]);

  useEffect(() => {
      if (!pixAvailable && paymentMethod === 'PIX') {
          const fallbackMethod = canUseCard ? 'CREDIT' : 'MONEY';
          setPaymentMethod(fallbackMethod);
          alert('PIX não está disponível para esta loja.');
      }
  }, [paymentMethod, pixAvailable, canUseCard]);

  useEffect(() => {
      if (isTableFlow) return;
      if (store.acceptsDelivery === false && orderType === 'DELIVERY') {
          setOrderType(store.acceptsPickup ? 'PICKUP' : store.acceptsTableOrders ? 'TABLE' : 'DELIVERY');
      }
      if (!store.acceptsPickup && orderType === 'PICKUP') {
          setOrderType(store.acceptsDelivery !== false ? 'DELIVERY' : store.acceptsTableOrders ? 'TABLE' : 'PICKUP');
      }
      if (!store.acceptsTableOrders && orderType === 'TABLE') {
          setOrderType(store.acceptsDelivery !== false ? 'DELIVERY' : store.acceptsPickup ? 'PICKUP' : 'DELIVERY');
      }
  }, [store.acceptsDelivery, store.acceptsPickup, store.acceptsTableOrders, orderType, isTableFlow]);

  useEffect(() => {
      if (tableContext) {
          setOrderType('TABLE');
          setTableNumber(tableContext.tableNumber);
      }
  }, [tableContext]);

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
      const normalized = normalizeNeighborhoodName(district);
      const match = deliveryNeighborhoods.find(
          (item) => normalizeNeighborhoodName(item.name) === normalized
      );
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
      const normalized = normalizeNeighborhoodName(candidate);
      return (
          deliveryNeighborhoods.find(
              (item) => normalizeNeighborhoodName(item.name) === normalized
          ) || null
      );
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
      !isBelowDeliveryMin &&
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
          return { eligible: false, reason: `Pedido minimo R$ ${coupon.minOrderValue}.` };
      }
      return { eligible: true, reason: '' };
  };

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
      const baseDiscount =
          selectedCoupon.discountType === 'PERCENTAGE'
              ? (subtotal * selectedCoupon.discountValue) / 100
              : selectedCoupon.discountValue;
      const applied = Math.min(baseDiscount, subtotal);
      setDiscount(applied);
      setCouponCode(selectedCoupon.code);
  }, [selectedCoupon, subtotal]);

  const handleApplyCoupon = (coupon: Coupon) => {
      const status = couponStatus(coupon);
      if (!status.eligible) {
          setCouponMessage(status.reason);
          setSelectedCoupon(null);
          return;
      }
      setSelectedCoupon(coupon);
      setCouponInput(coupon.code);
      setCouponMessage(`Cupom ${coupon.code} aplicado.`);
  };

  const handleApplyCouponCode = () => {
      const code = couponInput.trim().toUpperCase();
      if (!code) {
          setCouponMessage('Informe um cupom.');
          return;
      }
      const match = allCoupons.find((coupon) => coupon.code.toUpperCase() === code);
      if (!match) {
          setCouponMessage('Cupom não encontrado.');
          setSelectedCoupon(null);
          return;
      }
      handleApplyCoupon(match);
  };

  const handleRemoveCoupon = () => {
      setSelectedCoupon(null);
      setCouponCode('');
      setCouponMessage('Cupom removido.');
  };

  const handlePlaceOrder = async () => {
    if (orderType === 'DELIVERY' && store.acceptsDelivery === false) {
      alert('Esta loja não aceita pedidos para entrega.');
      return;
    }
    if (orderType === 'DELIVERY' && deliveryFeeMode === 'BY_NEIGHBORHOOD') {
      if (isNeighborhoodBlocked) {
        alert(neighborhoodError || 'Esta empresa não entrega no seu bairro.');
        return;
      }
    }
    if (orderType === 'DELIVERY' && deliveryFeeMode === 'BY_RADIUS') {
      if (resolvedZone?.error) {
        alert(resolvedZone.error);
        return;
      }
    }
    if (orderType === 'DELIVERY' && !address) {
      onChangeAddress();
      return;
    }
    if (!customerName.trim()) {
      setCustomerNameError('Informe o nome do cliente.');
      return;
    }
    if (orderType === 'TABLE' && !tableNumber.trim()) {
      alert('Informe o número da mesa.');
      return;
    }
    const phoneDigits = isTabletMode ? '' : phone.replace(/\D/g, '');
    if (!isTabletMode) {
      if (!phoneDigits) {
        alert('Informe um telefone para contato.');
        return;
      }
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        alert('Telefone inválido. Informe DDD + número.');
        return;
      }
    }

    // Validação CPF
    if (showCpf && cpf && !isValidCPF(cpf)) {
        alert('CPF inválido. Verifique os números.');
        return;
    }

    setIsProcessing(true);
    
    try {
        let deliveryCoords = resolvedDeliveryCoords || normalizeCoords(address?.coordinates);
        if (orderType === 'DELIVERY' && address && !deliveryCoords) {
            const queryParts = [address.street, address.number, address.district, address.city, address.state]
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            const queryText = queryParts.join(', ');
            if (!queryText) {
                alert('Endereço incompleto. Confirme rua, número e cidade.');
                setIsProcessing(false);
                return;
            }
            const results = await searchAddress(queryText);
            if (!results.length) {
                alert('Não foi possível localizar o endereço para entrega.');
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
        if (paymentMethod === 'CREDIT') {
            paymentDescription = `Cartão ${paymentContext}`;
        } else if (paymentMethod === 'PIX') {
            paymentDescription = pixOnlineEnabled ? 'PIX (Online)' : 'Pix';
        } else {
            paymentDescription = `Dinheiro ${paymentContext}${moneyChange ? ` (Troco p/ ${moneyChange})` : ''}`;
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
                paymentMethod === 'PIX' && pixOnlineEnabled
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
            cpf: showCpf ? cpf : '',
            customerPhone: phoneDigits || undefined,
            couponCode: selectedCoupon?.code,
            couponId: selectedCoupon?.id,
            couponDiscount: discount > 0 ? discount : undefined
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
        alert(message);
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
                      onClick={() => setOrderType('DELIVERY')}
                      className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'DELIVERY' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                  >
                      <Bike size={18} /> Entrega
                  </button>
              )}
              <button 
                  onClick={() => store.acceptsPickup && setOrderType('PICKUP')}
                  disabled={!store.acceptsPickup}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'PICKUP' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'} disabled:opacity-50`}
              >
                  <ShoppingBag size={18} /> Retirada
              </button>
              <button 
                  onClick={() => store.acceptsTableOrders && setOrderType('TABLE')}
                  disabled={!store.acceptsTableOrders}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'TABLE' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'} disabled:opacity-50`}
              >
                  <Utensils size={18} /> Mesa
              </button>
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
                        {orderType === 'DELIVERY' && deliveryMinValue > 0 && (
                            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                                <span>Pedido mínimo entrega</span>
                                <span>{formatCurrencyBRL(deliveryMinValue)}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                            <span>Taxa de Entrega</span>
                            {orderType === 'DELIVERY' ? (
                                deliveryFeeMode === 'BY_NEIGHBORHOOD' ? (
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
                                )
                            ) : (
                                <span className="text-green-600 font-bold">Grátis (Retirada)</span>
                            )}
                        </div>
                        {discount > 0 && (
                            <div className="flex justify-between text-sm text-green-600 font-bold">
                                <span>Desconto</span>
                                <span>- {formatCurrencyBRL(discount)}</span>
                            </div>
                        )}
                        {isBelowDeliveryMin && (
                            <div className="text-xs text-rose-600 font-bold">
                                Pedido mínimo para entrega: {formatCurrencyBRL(deliveryMinValue)}. Falta{' '}
                                {formatCurrencyBRL(Math.max(0, deliveryMinValue - deliverySubtotal))} para concluir.
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

        {!isTabletMode && (
            <section>
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                    Cupom
                </h3>
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="text"
                            value={couponInput}
                            onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                            placeholder="Digite o cupom"
                            className="flex-1 p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        />
                        <button
                            type="button"
                            onClick={handleApplyCouponCode}
                            className="px-4 py-3 rounded-xl font-bold text-sm bg-slate-900 text-white hover:opacity-90"
                        >
                            Aplicar
                        </button>
                        {selectedCoupon && (
                            <button
                                type="button"
                                onClick={handleRemoveCoupon}
                                className="px-4 py-3 rounded-xl font-bold text-sm border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200"
                            >
                                Remover
                            </button>
                        )}
                    </div>
                    {couponMessage && (
                        <p className="text-sm text-slate-600 dark:text-slate-300">{couponMessage}</p>
                    )}
                    {eligibleCoupons.length === 0 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum cupom disponível.</p>
                    )}
                    {activeCoupons.length > 0 && (
                        <div className="space-y-2">
                            {activeCoupons.map((coupon) => {
                                const status = couponStatus(coupon);
                                return (
                                    <div
                                        key={coupon.id}
                                        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-xl border ${
                                            status.eligible
                                                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                                                : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                                        }`}
                                    >
                                        <div>
                                            <p className="font-bold text-slate-800 dark:text-white">{coupon.code}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {coupon.description || 'Cupom disponível'}
                                            </p>
                                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-2">
                                                <span>
                                                    {coupon.discountType === 'PERCENTAGE'
                                                        ? `${coupon.discountValue}% OFF`
                                                        : `R$ ${coupon.discountValue} OFF`}
                                                </span>
                                                {coupon.minOrderValue > 0 && (
                                                    <span>Pedido mínimo R$ {coupon.minOrderValue}</span>
                                                )}
                                                {coupon.expiresAt && (
                                                    <span>Válido até {new Date(coupon.expiresAt).toLocaleDateString()}</span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!status.eligible}
                                            onClick={() => handleApplyCoupon(coupon)}
                                            className="px-4 py-2 rounded-xl text-sm font-bold bg-white border border-slate-200 text-slate-700 hover:border-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Aplicar
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </section>
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
                    setCustomerName(e.target.value);
                    if (e.target.value.trim()) setCustomerNameError('');
                }}
                className={`w-full p-4 bg-white dark:bg-slate-900 border rounded-2xl outline-none focus:ring-2 dark:text-white ${customerNameError ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-800 focus:ring-red-500'}`}
            />
            {customerNameError && <p className="text-xs text-red-600 mt-1 font-bold ml-1">{customerNameError}</p>}
        </section>

        {!isTabletMode && (
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

        {!isTabletMode && (
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
                            
                            if(v && !isValidCPF(v)) setCpfError('CPF inválido');
                            else setCpfError('');
                        }}
                        className={`w-full p-4 bg-white dark:bg-slate-900 border rounded-2xl outline-none focus:ring-2 dark:text-white ${cpfError ? 'border-red-500 focus:ring-red-200' : 'border-gray-200 dark:border-slate-800 focus:ring-red-500'}`}
                    />
                    {cpfError && <p className="text-xs text-red-600 mt-1 font-bold ml-1">{cpfError}</p>}
                </>
            )}
        </section>
        )}

        {!isTabletMode && (
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
                        <button onClick={() => setPaymentMethod('PIX')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'PIX' ? 'text-green-600 bg-green-50 dark:bg-green-900/10 border-b-2 border-green-600' : 'text-gray-500'}`}><div className="w-4 h-4 rounded rotate-45 border-2 border-current"></div> Pix</button>
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
