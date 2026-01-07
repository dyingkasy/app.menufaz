import React, { useState, useEffect } from 'react';
import { ArrowLeft, MapPin, ChevronRight, CreditCard, Banknote, Wifi, ShoppingBag, Bike, Plus, Loader2, CheckCircle, ShieldCheck, AlertCircle, User } from 'lucide-react';
import { CartItem, Store, Address } from '../types';
import { createOrder, getUserCards, saveUserCard, EncryptedCard } from '../services/db';
import { useAuth } from '../contexts/AuthContext';

interface CheckoutProps {
  store: Store;
  cartItems: CartItem[];
  address: Address | null;
  onBack: () => void;
  onOrderPlaced: () => void;
  onChangeAddress: () => void;
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

const luhnCheck = (val: string) => {
    let checksum = 0;
    let j = 1;
    for (let i = val.length - 1; i >= 0; i--) {
        let calc = 0;
        calc = Number(val.charAt(i)) * j;
        if (calc > 9) {
            checksum = checksum + 1;
            calc = calc - 10;
        }
        checksum = checksum + calc;
        if (j == 1) j = 2;
        else j = 1;
    }
    return (checksum % 10) == 0;
};

const validateExpiry = (val: string) => {
    if (val.length !== 5) return false;
    const [month, year] = val.split('/').map(Number);
    if (!month || !year || month < 1 || month > 12) return false;
    
    const now = new Date();
    const currentYear = parseInt(now.getFullYear().toString().slice(-2));
    const currentMonth = now.getMonth() + 1;

    if (year < currentYear) return false;
    if (year === currentYear && month < currentMonth) return false;
    return true;
};

const Checkout: React.FC<CheckoutProps> = ({ 
  store, 
  cartItems, 
  address, 
  onBack, 
  onOrderPlaced,
  onChangeAddress 
}) => {
  const { user } = useAuth();
  const [paymentMethod, setPaymentMethod] = useState<'CREDIT' | 'PIX' | 'MONEY'>('CREDIT');
  const [cardPaymentType, setCardPaymentType] = useState<'ONLINE' | 'DELIVERY'>('ONLINE');
  const [orderType, setOrderType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [cpf, setCpf] = useState('');
  const [cpfError, setCpfError] = useState('');
  
  // Discount & Processing
  const [couponCode, setCouponCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [moneyChange, setMoneyChange] = useState('');

  // Card Management State
  const [savedCards, setSavedCards] = useState<EncryptedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showAddCard, setShowAddCard] = useState(false);
  const [loadingCards, setLoadingCards] = useState(false);

  // New Card Form
  const [newCard, setNewCard] = useState({ number: '', name: '', expiry: '', cvv: '' });
  const [cardBrand, setCardBrand] = useState<string>('');
  const [cardErrors, setCardErrors] = useState({ number: false, expiry: false, cvv: false });
  const [isSavingCard, setIsSavingCard] = useState(false);

  // --- EFFECTS ---

  useEffect(() => {
      if (user) {
          if((user as any).cpf) {
              setCpf((user as any).cpf);
          }
          if (paymentMethod === 'CREDIT' && cardPaymentType === 'ONLINE') {
              loadUserCards();
          }
      }
  }, [user, paymentMethod, cardPaymentType]);

  const getCardBrand = (number: string) => {
      const n = number.replace(/\D/g, '');
      if (n.match(/^4/)) return 'Visa';
      if (n.match(/^5[1-5]/)) return 'Mastercard';
      if (n.match(/^3[47]/)) return 'Amex';
      if (n.match(/^(606282|3841)/)) return 'Hipercard';
      if (n.match(/^(4011|4312|4389|4514|4576|5041|5066|5090|6277|6362|6363|650|6516|6550)/)) return 'Elo';
      return '';
  };

  useEffect(() => {
      // Real-time card number validation & formatting
      const cleanNumber = newCard.number.replace(/\D/g, '');
      const brand = getCardBrand(cleanNumber);
      setCardBrand(brand);

      // Basic validation trigger (only if length sufficient to check)
      if (cleanNumber.length >= 13) {
          setCardErrors(prev => ({ ...prev, number: !luhnCheck(cleanNumber) }));
      } else {
          setCardErrors(prev => ({ ...prev, number: false })); // Reset error while typing
      }
  }, [newCard.number]);

  const loadUserCards = async () => {
      if (!user) return;
      setLoadingCards(true);
      try {
          const cards = await getUserCards(user.uid);
          setSavedCards(cards);
          if (cards.length > 0 && !selectedCardId) {
              setSelectedCardId(cards[0].id);
          }
      } catch (e) {
          console.error(e);
      } finally {
          setLoadingCards(false);
      }
  };

  const handleSaveNewCard = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user) return;

      // Final Validation
      const cleanNumber = newCard.number.replace(/\D/g, '');
      if (!luhnCheck(cleanNumber) || cleanNumber.length < 13) {
          alert("Número do cartão inválido.");
          return;
      }
      if (!validateExpiry(newCard.expiry)) {
          alert("Data de validade inválida ou expirada.");
          return;
      }
      if (newCard.cvv.length < 3) {
          alert("CVV inválido.");
          return;
      }

      setIsSavingCard(true);
      try {
          await saveUserCard(user.uid, {
              number: cleanNumber,
              name: newCard.name,
              expiry: newCard.expiry,
              cvv: newCard.cvv,
              brand: cardBrand || 'Outro'
          });
          await loadUserCards();
          setShowAddCard(false);
          setNewCard({ number: '', name: '', expiry: '', cvv: '' });
      } catch (e) {
          alert("Erro ao salvar cartão.");
      } finally {
          setIsSavingCard(false);
      }
  };

  // Calculations
  const subtotal = cartItems.reduce((acc, item) => acc + item.totalPrice, 0);
  const finalDeliveryFee = orderType === 'DELIVERY' ? store.deliveryFee : 0;
  const total = subtotal + finalDeliveryFee - discount;

  const handlePlaceOrder = async () => {
    if (orderType === 'DELIVERY' && !address) {
      alert('Por favor, selecione um endereço de entrega.');
      return;
    }
    if (!user) {
      alert('Você precisa estar logado.');
      return;
    }

    // Validação CPF
    if (cpf && !isValidCPF(cpf)) {
        alert('CPF inválido. Verifique os números.');
        return;
    }

    if (paymentMethod === 'CREDIT' && cardPaymentType === 'ONLINE') {
        if (savedCards.length === 0 && !showAddCard) {
            alert("Adicione um cartão para pagar online.");
            return;
        }
        if (!selectedCardId && !showAddCard) {
            alert("Selecione um cartão.");
            return;
        }
        if (showAddCard) {
            alert("Salve o novo cartão antes de finalizar.");
            return;
        }
    }

    setIsProcessing(true);
    
    try {
        const itemsDescription = cartItems.map(item => {
            const opts = item.options.map(o => o.optionName).join(', ');
            return `${item.quantity}x ${item.product.name} ${opts ? `(${opts})` : ''} ${item.notes ? `[Obs: ${item.notes}]` : ''}`;
        });

        let paymentDescription = '';
        if (paymentMethod === 'CREDIT') {
            if (cardPaymentType === 'ONLINE') {
                const card = savedCards.find(c => c.id === selectedCardId);
                paymentDescription = `Online: ${card?.brand} final ${card?.last4}`;
            } else {
                paymentDescription = 'Cartão na Entrega (Maquininha)';
            }
        } else if (paymentMethod === 'PIX') {
            paymentDescription = 'Pix';
        } else {
            paymentDescription = `Dinheiro${moneyChange ? ` (Troco p/ ${moneyChange})` : ''}`;
        }

        await createOrder({
            storeId: store.id,
            userId: user.uid,
            customerName: user.name,
            items: itemsDescription,
            total: total,
            time: new Date().toLocaleTimeString(),
            notes: orderType === 'PICKUP' ? 'RETIRADA NO BALCÃO' : '', 
            paymentMethod: paymentDescription,
            refundStatus: 'NONE',
            storeCity: store.city, 
            storeCoordinates: store.coordinates,
            deliveryCoordinates: orderType === 'DELIVERY' && address ? address.coordinates : undefined,
            type: orderType,
            cpf: cpf 
        });

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
        <p className="text-sm text-gray-400 animate-pulse">Redirecionando para Meus Pedidos...</p>
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
          <div className="text-sm font-bold text-gray-500 dark:text-gray-400 hidden sm:block">
             {store.name}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        
        {/* DELIVERY TYPE TOGGLE */}
        {store.acceptsPickup && (
            <section className="bg-white dark:bg-slate-900 p-1.5 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 flex">
                <button 
                    onClick={() => setOrderType('DELIVERY')}
                    className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'DELIVERY' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                >
                    <Bike size={18} /> Entrega
                </button>
                <button 
                    onClick={() => setOrderType('PICKUP')}
                    className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${orderType === 'PICKUP' ? 'bg-red-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                >
                    <ShoppingBag size={18} /> Retirada
                </button>
            </section>
        )}

        {/* Delivery Address */}
        <section>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <MapPin size={16} /> {orderType === 'DELIVERY' ? 'Endereço de Entrega' : 'Local de Retirada'}
            </h3>
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                        {orderType === 'DELIVERY' ? <MapPin size={24} /> : <ShoppingBag size={24} />}
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
                        ) : (
                            <>
                                <p className="font-bold text-slate-800 dark:text-white text-sm">{store.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Retirar no balcão da loja</p>
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
                            <p className="text-sm font-medium text-slate-800 dark:text-white">R$ {item.totalPrice.toFixed(2)}</p>
                        </div>
                    ))}
                </div>
                <div className="p-5 space-y-2 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800">
                    <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                        <span>Subtotal</span>
                        <span>R$ {subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                        <span>Taxa de Entrega</span>
                        {orderType === 'DELIVERY' ? (
                            <span>{store.deliveryFee === 0 ? 'Grátis' : `R$ ${store.deliveryFee.toFixed(2)}`}</span>
                        ) : (
                            <span className="text-green-600 font-bold">Grátis (Retirada)</span>
                        )}
                    </div>
                    {discount > 0 && (
                        <div className="flex justify-between text-sm text-green-600 font-bold">
                            <span>Desconto</span>
                            <span>- R$ {discount.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="flex justify-between text-xl font-extrabold text-slate-800 dark:text-white pt-3 mt-2 border-t border-gray-100 dark:border-slate-800">
                        <span>Total</span>
                        <span>R$ {total.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        </section>

        {/* CPF Optional */}
        <section>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <User size={16} /> CPF na Nota (Opcional)
            </h3>
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
        </section>

        {/* Payment Methods UI */}
        <section>
             <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3 flex items-center gap-2">
                <Banknote size={16} /> Pagamento
            </h3>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="flex border-b border-gray-100 dark:border-slate-800">
                    <button onClick={() => setPaymentMethod('CREDIT')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'CREDIT' ? 'text-red-600 bg-red-50 dark:bg-red-900/10 border-b-2 border-red-600' : 'text-gray-500'}`}><CreditCard size={18} /> Cartão</button>
                    <button onClick={() => setPaymentMethod('PIX')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'PIX' ? 'text-green-600 bg-green-50 dark:bg-green-900/10 border-b-2 border-green-600' : 'text-gray-500'}`}><div className="w-4 h-4 rounded rotate-45 border-2 border-current"></div> Pix</button>
                    <button onClick={() => setPaymentMethod('MONEY')} className={`flex-1 py-4 text-sm font-bold flex items-center justify-center gap-2 ${paymentMethod === 'MONEY' ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/10 border-b-2 border-blue-600' : 'text-gray-500'}`}><Banknote size={18} /> Dinheiro</button>
                </div>
                <div className="p-6">
                    {paymentMethod === 'CREDIT' && (
                        <div className="space-y-4">
                            <div className="flex gap-3 mb-4">
                                <button onClick={() => setCardPaymentType('ONLINE')} className={`flex-1 p-3 rounded-xl border text-sm font-bold flex flex-col items-center gap-2 ${cardPaymentType === 'ONLINE' ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500'}`}><Wifi size={20} /> Pagar no App</button>
                                {store.acceptsCardOnDelivery && <button onClick={() => setCardPaymentType('DELIVERY')} className={`flex-1 p-3 rounded-xl border text-sm font-bold flex flex-col items-center gap-2 ${cardPaymentType === 'DELIVERY' ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-500'}`}><CreditCard size={20} /> Pagar na Entrega</button>}
                            </div>
                            
                            {cardPaymentType === 'ONLINE' && (
                                <div className="space-y-4 animate-fade-in">
                                    {loadingCards ? (
                                        <div className="flex justify-center py-4"><Loader2 className="animate-spin text-red-600" /></div>
                                    ) : !showAddCard ? (
                                        <>
                                            <div className="space-y-2">
                                                {savedCards.map(card => (
                                                    <div 
                                                        key={card.id}
                                                        onClick={() => setSelectedCardId(card.id)}
                                                        className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${selectedCardId === card.id ? 'border-red-500 bg-red-50 dark:bg-red-900/10 ring-1 ring-red-500' : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-8 bg-gray-200 dark:bg-slate-600 rounded flex items-center justify-center text-xs font-bold uppercase text-gray-500 dark:text-gray-300">
                                                                {card.brand.substring(0,4)}
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-800 dark:text-white">•••• {card.last4}</p>
                                                                <p className="text-xs text-gray-500 uppercase">{card.holder}</p>
                                                            </div>
                                                        </div>
                                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedCardId === card.id ? 'border-red-600' : 'border-gray-300'}`}>
                                                            {selectedCardId === card.id && <div className="w-2.5 h-2.5 bg-red-600 rounded-full" />}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <button 
                                                onClick={() => setShowAddCard(true)}
                                                className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-xl flex items-center justify-center gap-2 text-gray-500 hover:text-red-600 hover:border-red-500 transition-colors font-bold text-sm"
                                            >
                                                <Plus size={18} /> Adicionar Novo Cartão
                                            </button>
                                        </>
                                    ) : (
                                        <div className="bg-gray-50 dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700">
                                            <h4 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                                <ShieldCheck size={18} className="text-green-600" /> Novo Cartão
                                            </h4>
                                            <form className="space-y-3">
                                                <div>
                                                    <div className="relative">
                                                        <input 
                                                            type="text"
                                                            placeholder="Número do Cartão"
                                                            value={newCard.number}
                                                            maxLength={19}
                                                            onChange={e => {
                                                                setCardErrors(prev => ({...prev, number: false}));
                                                                const val = e.target.value.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
                                                                setNewCard({...newCard, number: val.slice(0, 19)});
                                                            }}
                                                            className={`w-full p-3 pl-12 border rounded-lg outline-none dark:bg-slate-900 dark:text-white transition-all ${cardErrors.number ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-green-500'}`}
                                                        />
                                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 w-7 h-5 bg-gray-200 dark:bg-slate-700 rounded flex items-center justify-center text-[10px] font-bold uppercase text-gray-500">
                                                            {cardBrand || '?'}
                                                        </div>
                                                    </div>
                                                    {cardErrors.number && <span className="text-[10px] text-red-500 mt-1">Número inválido</span>}
                                                </div>
                                                <input 
                                                    type="text"
                                                    placeholder="Nome do Titular"
                                                    value={newCard.name}
                                                    onChange={e => setNewCard({...newCard, name: e.target.value.toUpperCase()})}
                                                    className="w-full p-3 border border-gray-300 dark:border-slate-600 rounded-lg outline-none focus:ring-2 focus:ring-green-500 dark:bg-slate-900 dark:text-white"
                                                />
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <input 
                                                            type="text"
                                                            placeholder="MM/AA"
                                                            maxLength={5}
                                                            value={newCard.expiry}
                                                            onChange={e => {
                                                                setCardErrors(prev => ({...prev, expiry: false}));
                                                                let val = e.target.value.replace(/\D/g, '');
                                                                if (val.length >= 2) val = val.slice(0,2) + '/' + val.slice(2,4);
                                                                setNewCard({...newCard, expiry: val});
                                                            }}
                                                            className={`w-full p-3 border rounded-lg outline-none focus:ring-2 dark:bg-slate-900 dark:text-white text-center ${cardErrors.expiry ? 'border-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-green-500'}`}
                                                        />
                                                    </div>
                                                    <div>
                                                        <input 
                                                            type="text"
                                                            placeholder="CVV"
                                                            maxLength={4}
                                                            value={newCard.cvv}
                                                            onChange={e => {
                                                                setCardErrors(prev => ({...prev, cvv: false}));
                                                                setNewCard({...newCard, cvv: e.target.value.replace(/\D/g, '')});
                                                            }}
                                                            className={`w-full p-3 border rounded-lg outline-none focus:ring-2 dark:bg-slate-900 dark:text-white text-center ${cardErrors.cvv ? 'border-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-green-500'}`}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 pt-2">
                                                    <button 
                                                        type="button"
                                                        onClick={() => setShowAddCard(false)}
                                                        className="flex-1 py-2 text-gray-500 font-bold hover:bg-gray-200 rounded-lg text-sm"
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={handleSaveNewCard}
                                                        disabled={isSavingCard}
                                                        className="flex-1 py-2 bg-green-600 text-white font-bold rounded-lg text-sm flex items-center justify-center gap-2 disabled:opacity-70"
                                                    >
                                                        {isSavingCard ? <Loader2 className="animate-spin" size={16} /> : 'Salvar'}
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                    )}
                                </div>
                            )}
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

      </main>

      {/* Fixed Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 p-4 z-30">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-4">
            <div className="w-full sm:w-auto flex justify-between sm:block flex-1">
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Total a Pagar</p>
                <p className="text-2xl font-extrabold text-slate-900 dark:text-white">R$ {total.toFixed(2)}</p>
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