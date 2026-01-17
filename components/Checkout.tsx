import React, { useState, useEffect } from 'react';
import { ArrowLeft, MapPin, ChevronRight, CreditCard, Banknote, ShoppingBag, Bike, Loader2, CheckCircle, User, Utensils } from 'lucide-react';
import { CartItem, Store, Address } from '../types';
import { createOrder } from '../services/db';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyBRL } from '../utils/format';
import { imageKitUrl } from '../utils/imagekit';
import { searchAddress } from '../utils/geo';

interface CheckoutProps {
  store: Store;
  cartItems: CartItem[];
  address: Address | null;
  onBack: () => void;
  onOrderPlaced: () => void;
  onChangeAddress: () => void;
  tableContext?: {
    tableNumber: string;
    sessionId: string;
  };
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

const Checkout: React.FC<CheckoutProps> = ({ 
  store, 
  cartItems, 
  address, 
  onBack, 
  onOrderPlaced,
  onChangeAddress,
  tableContext
}) => {
  const { user } = useAuth();
  const [paymentMethod, setPaymentMethod] = useState<'CREDIT' | 'PIX' | 'MONEY'>(
    tableContext ? 'MONEY' : store.acceptsCardOnDelivery ? 'CREDIT' : 'PIX'
  );
  const [orderType, setOrderType] = useState<'DELIVERY' | 'PICKUP' | 'TABLE'>(tableContext ? 'TABLE' : 'DELIVERY');
  const [tableNumber, setTableNumber] = useState(tableContext?.tableNumber || '');
  const [customerName, setCustomerName] = useState('');
  const [customerNameError, setCustomerNameError] = useState('');
  const [cpf, setCpf] = useState('');
  const [showCpf, setShowCpf] = useState(false);
  const [cpfError, setCpfError] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const isTableFlow = !!tableContext;
  const canUseCard = store.acceptsCardOnDelivery && orderType === 'DELIVERY';
  
  // Discount & Processing
  const [couponCode, setCouponCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [moneyChange, setMoneyChange] = useState('');

  // --- EFFECTS ---

  useEffect(() => {
      if (user) {
          if((user as any).cpf) {
              setCpf((user as any).cpf);
              setShowCpf(true);
          }
          if ((user as any).phone) {
              setPhone((user as any).phone);
          }
          if ((user as any).name) {
              setCustomerName((user as any).name);
          }
      }
  }, [user]);

  useEffect(() => {
      if (isTableFlow) return;
      if (!store.acceptsTableOrders && orderType === 'TABLE') {
          setOrderType(store.acceptsPickup ? 'PICKUP' : 'DELIVERY');
      }
  }, [store.acceptsPickup, store.acceptsTableOrders, orderType, isTableFlow]);

  useEffect(() => {
      if (tableContext) {
          setOrderType('TABLE');
          setTableNumber(tableContext.tableNumber);
      }
  }, [tableContext]);

  useEffect(() => {
      if (isTableFlow) {
          setPaymentMethod('MONEY');
      } else if (!canUseCard && paymentMethod === 'CREDIT') {
          setPaymentMethod('PIX');
      }
  }, [canUseCard, isTableFlow, paymentMethod]);

  // Calculations
  const subtotal = cartItems.reduce((acc, item) => acc + item.totalPrice, 0);
  const deliveryFee = Number(store.deliveryFee) || 0;
  const pickupTime = store.pickupTime || store.deliveryTime;
  const finalDeliveryFee = orderType === 'DELIVERY' ? deliveryFee : 0;
  const total = subtotal + finalDeliveryFee - discount;

  const handlePlaceOrder = async () => {
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
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phoneDigits) {
      alert('Informe um telefone para contato.');
      return;
    }
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      alert('Telefone inválido. Informe DDD + número.');
      return;
    }

    // Validação CPF
    if (showCpf && cpf && !isValidCPF(cpf)) {
        alert('CPF inválido. Verifique os números.');
        return;
    }

    setIsProcessing(true);
    
    try {
        let deliveryCoords = address?.coordinates;
        if (orderType === 'DELIVERY' && address && (!deliveryCoords || !Number.isFinite(deliveryCoords.lat) || !Number.isFinite(deliveryCoords.lng))) {
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
            deliveryCoords = results[0].coordinates;
        }

        const itemsDescription = cartItems.map(item => {
            const opts = item.options.map(o => o.optionName).join(', ');
            return `${item.quantity}x ${item.product.name} ${opts ? `(${opts})` : ''} ${item.notes ? `[Obs: ${item.notes}]` : ''}`;
        });

        let paymentDescription = '';
        if (orderType === 'TABLE') {
            paymentDescription = 'Pagamento na mesa';
        } else if (paymentMethod === 'CREDIT') {
            paymentDescription = 'Cartão na Entrega (Maquininha)';
        } else if (paymentMethod === 'PIX') {
            paymentDescription = 'Pix';
        } else {
            paymentDescription = `Dinheiro${moneyChange ? ` (Troco p/ ${moneyChange})` : ''}`;
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
            deliveryFee: orderType === 'DELIVERY' ? Number(store.deliveryFee) || 0 : 0,
            time: new Date().toLocaleTimeString(),
            notes: orderType === 'PICKUP' ? 'RETIRADA NO BALCÃO' : orderType === 'TABLE' ? `MESA ${tableValue}` : '', 
            paymentMethod: paymentDescription,
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
            customerPhone: phoneDigits
        });
        if (createdOrder?.customerId) {
            localStorage.setItem('customerId', createdOrder.customerId);
        }
        if (phoneDigits) {
            localStorage.setItem('customerPhone', phoneDigits);
        }
        if (createdOrder?.id) {
            localStorage.setItem('lastOrderId', createdOrder.id);
        }

        setIsSuccess(true);
        setTimeout(() => {
            onOrderPlaced();
        }, 2500);

    } catch (error) {
        console.error("Error placing order:", error);
        alert("Erro ao realizar pedido. Tente novamente.");
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
        
        {/* DELIVERY TYPE TOGGLE */}
        {!isTableFlow && (
          <section className="bg-white dark:bg-slate-900 p-1.5 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 flex">
              <button 
                  onClick={() => setOrderType('DELIVERY')}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'DELIVERY' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
              >
                  <Bike size={18} /> Entrega
              </button>
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

        {/* Order Summary */}
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
                    <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                        <span>Taxa de Entrega</span>
                        {orderType === 'DELIVERY' ? (
                            <span>{deliveryFee === 0 ? 'Grátis' : formatCurrencyBRL(deliveryFee)}</span>
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
                    <div className="flex justify-between text-xl font-extrabold text-slate-800 dark:text-white pt-3 mt-2 border-t border-gray-100 dark:border-slate-800">
                        <span>Total</span>
                        <span>{formatCurrencyBRL(total)}</span>
                    </div>
                </div>
            </div>
        </section>

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

        {/* CPF Optional */}
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

        {/* Payment Methods UI */}
        {!isTableFlow && (
        <section>
             <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <Banknote size={16} /> Pagamento
            </h3>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="flex border-b border-gray-100 dark:border-slate-800">
                    {canUseCard && (
                        <button onClick={() => setPaymentMethod('CREDIT')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'CREDIT' ? 'text-red-600 bg-red-50 dark:bg-red-900/10 border-b-2 border-red-600' : 'text-gray-500'}`}><CreditCard size={18} /> Cartão</button>
                    )}
                    <button onClick={() => setPaymentMethod('PIX')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'PIX' ? 'text-green-600 bg-green-50 dark:bg-green-900/10 border-b-2 border-green-600' : 'text-gray-500'}`}><div className="w-4 h-4 rounded rotate-45 border-2 border-current"></div> Pix</button>
                    <button onClick={() => setPaymentMethod('MONEY')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'MONEY' ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/10 border-b-2 border-blue-600' : 'text-gray-500'}`}><Banknote size={18} /> Dinheiro</button>
                </div>
                <div className="p-6">
                    {paymentMethod === 'CREDIT' && (
                        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4 text-sm text-gray-600 dark:text-gray-300">
                            Pagamento com cartão será realizado na entrega, direto na maquininha.
                        </div>
                    )}
                    {paymentMethod === 'MONEY' && (
                        <div className="space-y-4">
                            <label className="block text-sm font-bold text-slate-700 dark:text-gray-300">Precisa de troco para quanto?</label>
                            <input type="number" value={moneyChange} onChange={e => setMoneyChange(e.target.value)} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:text-white" placeholder="R$ 0,00" />
                        </div>
                    )}
                    {paymentMethod === 'PIX' && (
                        <div className="text-center p-4">
                            <p className="font-bold text-slate-800 dark:text-white">Chave Pix</p>
                            <p className="text-sm text-gray-500">Copie e pague no seu banco</p>
                        </div>
                    )}
                </div>
            </div>
        </section>
        )}
        {isTableFlow && (
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm p-5">
                <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-2 flex items-center gap-2">
                    <Banknote size={16} /> Pagamento
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">Pagamento será realizado na mesa, direto com a equipe.</p>
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
                disabled={isProcessing}
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
