
import React from 'react';
import { X, ShoppingBag, Trash2, ChevronRight } from 'lucide-react';
import { CartItem, Store } from '../types';
import { formatCurrencyBRL } from '../utils/format';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  store: Store | null;
  onRemoveItem: (id: string) => void;
  onClearCart: () => void;
  onCheckout: () => void; // Nova prop
}

const CartDrawer: React.FC<CartDrawerProps> = ({ 
  isOpen, 
  onClose, 
  cartItems, 
  store, 
  onRemoveItem, 
  onClearCart,
  onCheckout
}) => {
  if (!isOpen) return null;

  const cartSubtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const deliveryFee = Number(store?.deliveryFee) || 0;
  const cartTotal = cartSubtotal + deliveryFee;

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end">
        {/* Overlay */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose} />
        
        {/* Drawer Content */}
        <div className="bg-white dark:bg-slate-900 w-full max-w-md h-full relative z-20 flex flex-col animate-slide-in-right shadow-2xl">
            
            <div className="p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 dark:text-white">Sua Sacola</h2>
                    {store && <p className="text-xs text-gray-500 dark:text-gray-400">em {store.name}</p>}
                </div>
                <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-500 hover:text-red-600 transition-colors">
                    <X size={24} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-slate-950">
                {cartItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 pb-20">
                        <div className="w-24 h-24 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6">
                            <ShoppingBag size={40} className="opacity-30" />
                        </div>
                        <p className="font-bold text-lg text-slate-600 dark:text-slate-300">Sua sacola está vazia</p>
                        <p className="text-sm max-w-[200px] text-center mt-2">Adicione itens deliciosos do cardápio para fazer um pedido.</p>
                        <button onClick={onClose} className="mt-6 text-red-600 font-bold hover:underline">
                            Voltar ao cardápio
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex justify-end pb-2">
                            <button onClick={onClearCart} className="text-xs text-red-500 font-bold hover:bg-red-50 px-2 py-1 rounded transition-colors flex items-center gap-1">
                                <Trash2 size={12} /> Limpar sacola
                            </button>
                        </div>
                        <div className="space-y-3">
                            {cartItems.map(item => (
                                <div key={item.id} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-100 dark:border-slate-700 shadow-sm flex gap-3 relative group">
                                    <div className="flex flex-col items-center gap-1 pt-1">
                                        <span className="text-sm font-bold bg-gray-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 w-6 h-6 flex items-center justify-center rounded-md">
                                            {item.quantity}
                                        </span>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start">
                                            <h4 className="font-bold text-slate-800 dark:text-white text-sm pr-6 leading-snug">{item.product.name}</h4>
                                            <p className="text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrencyBRL(item.totalPrice)}</p>
                                        </div>
                                        
                                        {item.options.length > 0 && (
                                            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                                                {item.options.map(o => `${o.optionName}`).join(', ')}
                                            </p>
                                        )}
                                        {item.notes && (
                                            <p className="text-xs text-orange-600 mt-1.5 bg-orange-50 dark:bg-orange-900/10 px-2 py-1 rounded-md inline-block">
                                                Obs: {item.notes}
                                            </p>
                                        )}
                                    </div>
                                    <button 
                                        onClick={() => onRemoveItem(item.id)} 
                                        className="absolute top-2 right-2 p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {cartItems.length > 0 && (
                <div className="p-6 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] z-30">
                    <div className="space-y-3 mb-6 text-sm">
                        <div className="flex justify-between text-gray-500 dark:text-gray-400">
                            <span>Subtotal</span>
                            <span>{formatCurrencyBRL(cartSubtotal)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500 dark:text-gray-400 pb-3 border-b border-gray-100 dark:border-slate-800">
                            <span>Taxa de entrega</span>
                            <span>{deliveryFee === 0 ? 'Grátis' : formatCurrencyBRL(deliveryFee)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-xl text-slate-800 dark:text-white">
                            <span>Total</span>
                            <span>{formatCurrencyBRL(cartTotal)}</span>
                        </div>
                    </div>
                    
                    <button 
                        onClick={() => { onClose(); onCheckout(); }}
                        className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-bold shadow-lg shadow-red-600/20 flex justify-between px-6 items-center group transition-all transform hover:scale-[1.02]"
                    >
                        <span>Finalizar Pedido</span>
                        <div className="flex items-center gap-2">
                             <span className="text-sm opacity-80 font-normal">Ir para pagamento</span>
                             <ChevronRight className="group-hover:translate-x-1 transition-transform" size={20} />
                        </div>
                    </button>
                </div>
            )}
        </div>
    </div>
  );
};

export default CartDrawer;
