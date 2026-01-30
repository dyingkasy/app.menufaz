
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, Package, Clock, CheckCircle, AlertTriangle, MessageCircle, Send, ChevronRight, ShoppingBag, Utensils, MapPin, Bike, XCircle, Circle } from 'lucide-react';
import { Order, ChatMessage, Coordinates } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToClientOrders, subscribeToCustomerOrders, subscribeToCustomerPhoneOrders, updateOrderRefundStatus, updateOrderChat, subscribeToCourier, updateOrderStatus } from '../services/db';
import { formatCurrencyBRL, formatOrderNumber } from '../utils/format';

interface ClientOrdersProps {
    onBack: () => void;
}

// --- GOOGLE MAPS COMPONENT FOR TRACKING ---
const TrackingMap: React.FC<{ order: Order }> = ({ order }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const googleMapRef = useRef<any>(null);
    const courierMarkerRef = useRef<any>(null);
    const [courierLocation, setCourierLocation] = useState<Coordinates | null>(null);

    useEffect(() => {
        // Subscribe to courier location if order has a courier
        if (order.courierId) {
            const unsubscribe = subscribeToCourier(order.courierId, (coords) => {
                setCourierLocation(coords);
            });
            return () => unsubscribe();
        }
    }, [order.courierId]);

    useEffect(() => {
        if (!mapRef.current || !window.google) return;

        // Initialize Map
        if (!googleMapRef.current) {
            const startPos = order.storeCoordinates || { lat: -23.550520, lng: -46.633308 };
            
            googleMapRef.current = new window.google.maps.Map(mapRef.current, {
                center: startPos,
                zoom: 14,
                disableDefaultUI: true,
                styles: [
                    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }
                ]
            });

            // Store Marker
            if (order.storeCoordinates) {
                new window.google.maps.Marker({
                    position: order.storeCoordinates,
                    map: googleMapRef.current,
                    label: "🏪",
                    title: "Loja"
                });
            }

            // Delivery Marker
            if (order.deliveryCoordinates) {
                new window.google.maps.Marker({
                    position: order.deliveryCoordinates,
                    map: googleMapRef.current,
                    label: "🏠",
                    title: "Entrega"
                });
            }
        }

        // Update Courier Marker
        if (courierLocation && googleMapRef.current) {
            if (!courierMarkerRef.current) {
                courierMarkerRef.current = new window.google.maps.Marker({
                    position: courierLocation,
                    map: googleMapRef.current,
                    icon: {
                        path: window.google.maps.SymbolPath.CIRCLE,
                        scale: 8,
                        fillColor: "#DC2626",
                        fillOpacity: 1,
                        strokeWeight: 2,
                        strokeColor: "#FFFFFF",
                    },
                    label: {
                        text: "🛵",
                        fontSize: "20px",
                        className: "marker-label"
                    }
                });
            } else {
                courierMarkerRef.current.setPosition(courierLocation);
            }
            googleMapRef.current.panTo(courierLocation);
        }

    }, [courierLocation, order]);

    return <div ref={mapRef} className="w-full h-64 bg-gray-200 dark:bg-slate-800 rounded-xl mb-4 shadow-inner" />;
};

const ClientOrders: React.FC<ClientOrdersProps> = ({ onBack }) => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');
    const [myOrders, setMyOrders] = useState<Order[]>([]);
    
    // MUDANÇA: Armazenamos apenas o ID, e derivamos o objeto 'selectedOrder' da lista 'myOrders'
    // Isso garante que quando 'myOrders' atualizar via Firebase, o detalhe atualize automaticamente.
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
    const [isListView, setIsListView] = useState(false);
    
    const [showRefundModal, setShowRefundModal] = useState(false);
    const [refundReason, setRefundReason] = useState('');
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [chatMessage, setChatMessage] = useState('');

    useEffect(() => {
        if (user?.uid) {
            const unsubscribe = subscribeToClientOrders(user.uid, (orders) => {
                setMyOrders(orders);
            });
            return () => unsubscribe();
        }
        const storedCustomerPhone = localStorage.getItem('customerPhone');
        if (storedCustomerPhone) {
            const unsubscribe = subscribeToCustomerPhoneOrders(storedCustomerPhone, (orders) => {
                setMyOrders(orders);
            });
            return () => unsubscribe();
        }
        const storedCustomerId = localStorage.getItem('customerId');
        if (storedCustomerId) {
            const unsubscribe = subscribeToCustomerOrders(storedCustomerId, (orders) => {
                setMyOrders(orders);
            });
            return () => unsubscribe();
        }
    }, [user?.uid]);

    useEffect(() => {
        if (isListView || selectedOrderId || myOrders.length === 0) return;
        const lastOrderId = localStorage.getItem('lastOrderId');
        const preferred = lastOrderId ? myOrders.find((order) => order.id === lastOrderId) : null;
        if (preferred) {
            setSelectedOrderId(preferred.id);
            return;
        }
        const active = myOrders.find((o) => ['PENDING', 'PREPARING', 'WAITING_COURIER', 'DELIVERING'].includes(o.status));
        setSelectedOrderId((active || myOrders[0]).id);
    }, [myOrders, selectedOrderId]);

    // Deriva o pedido selecionado em tempo real da lista atualizada
    const selectedOrder = useMemo(() => 
        myOrders.find(o => o.id === selectedOrderId) || null, 
    [myOrders, selectedOrderId]);

    // Filter Logic - Garantir match exato
    const activeOrders = myOrders.filter(o => ['PENDING', 'PREPARING', 'WAITING_COURIER', 'DELIVERING'].includes(o.status));
    const historyOrders = myOrders.filter(o => ['COMPLETED', 'CANCELLED'].includes(o.status));

    const handleRequestRefund = async () => {
        if (!selectedOrder || !refundReason.trim()) return;
        try {
            await updateOrderRefundStatus(selectedOrder.id, 'REQUESTED', refundReason);
            setShowRefundModal(false);
            setRefundReason('');
        } catch (e) {
            alert("Erro ao solicitar reembolso.");
        }
    };

    const handleSendMessage = async () => {
        if (!selectedOrder || !chatMessage.trim()) return;

        const newMessage: ChatMessage = {
            sender: 'CLIENT',
            message: chatMessage,
            timestamp: new Date().toISOString()
        };

        try {
            const updatedChat = [...(selectedOrder.chat || []), newMessage];
            await updateOrderChat(selectedOrder.id, updatedChat);
            setChatMessage('');
        } catch(e) {
            alert("Erro ao enviar mensagem.");
        }
    };

    const handleCancelOrder = async () => {
        if (!selectedOrder || !cancelReason.trim()) return;
        try {
            await updateOrderStatus(selectedOrder.id, 'CANCELLED', cancelReason.trim());
            setShowCancelModal(false);
            setCancelReason('');
        } catch (e) {
            alert("Erro ao cancelar pedido.");
        }
    };

    const getOrderType = (order: Order) => {
        if (order.type) return order.type;
        if (order.pickup || order.isPickup) return 'PICKUP';
        if (order.tableNumber || order.tableSessionId) return 'TABLE';
        if (order.deliveryAddress) return 'DELIVERY';
        const notesText = (order.notes || '').toUpperCase();
        if (notesText.includes('RETIRADA')) return 'PICKUP';
        return 'DELIVERY';
    };

    const getEffectiveStatus = (order: Order) => {
        const orderType = getOrderType(order);
        if (orderType === 'PICKUP') {
            if (order.status === 'WAITING_COURIER') {
                return 'DELIVERING';
            }
            return order.status;
        }
        if (order.status === 'DELIVERING' && order.courierStage !== 'TO_CUSTOMER') {
            return 'WAITING_COURIER';
        }
        return order.status;
    };

    const getOrderSteps = (order: Order) => {
        if (getOrderType(order) === 'PICKUP') {
            return [
                { id: 'PENDING', label: 'Confirmado', icon: ShoppingBag },
                { id: 'PREPARING', label: 'Preparo', icon: Utensils },
                { id: 'DELIVERING', label: 'Pronto p/ Retirada', icon: ShoppingBag },
                { id: 'COMPLETED', label: 'Retirado', icon: CheckCircle },
            ];
        }
        return [
            { id: 'PENDING', label: 'Confirmado', icon: ShoppingBag },
            { id: 'PREPARING', label: 'Preparo', icon: Utensils },
            { id: 'WAITING_COURIER', label: 'Aguardando Motoboy', icon: Clock },
            { id: 'DELIVERING', label: 'Saiu p/ Entrega', icon: Bike },
            { id: 'COMPLETED', label: 'Entregue', icon: CheckCircle },
        ];
    };

    const getProgressLabel = (order: Order, status: string) => {
        if (getOrderType(order) === 'PICKUP') {
            if (status === 'PENDING') return 'Aguardando Confirmação';
            if (status === 'PREPARING') return 'Em Preparo';
            if (status === 'DELIVERING') return 'Pronto p/ Retirada';
            return 'Retirado';
        }
        if (status === 'PENDING') return 'Aguardando Confirmação';
        if (status === 'PREPARING') return 'Em Preparo';
        if (status === 'WAITING_COURIER') return 'Aguardando Motoboy';
        if (status === 'DELIVERING') return 'Em Rota de Entrega';
        return 'Entregue';
    };

    const getProgressWidth = (order: Order, status: string) => {
        if (getOrderType(order) === 'PICKUP') {
            if (status === 'PENDING') return '25%';
            if (status === 'PREPARING') return '50%';
            if (status === 'DELIVERING') return '75%';
            return '100%';
        }
        if (status === 'PENDING') return '20%';
        if (status === 'PREPARING') return '40%';
        if (status === 'WAITING_COURIER') return '60%';
        if (status === 'DELIVERING') return '80%';
        return '100%';
    };

    // Status Steps Helper
    const getStepStatus = (order: Order, status: string) => {
        const steps = getOrderSteps(order).map((step) => step.id);
        const currentIndex = steps.indexOf(status);
        return (stepName: string) => {
            const stepIndex = steps.indexOf(stepName);
            if (status === 'CANCELLED') return 'cancelled';
            if (stepIndex < currentIndex) return 'completed';
            if (stepIndex === currentIndex) return 'current';
            return 'waiting';
        };
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-sans pb-20">
            {/* Header */}
            <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 sticky top-0 z-20 shadow-sm">
                <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-4">
                    <button onClick={onBack} className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <ArrowLeft className="text-slate-700 dark:text-white" />
                    </button>
                    <h1 className="text-xl font-bold text-slate-800 dark:text-white">Meus Pedidos</h1>
                </div>
                <div className="max-w-3xl mx-auto px-4 flex gap-6">
                    <button 
                        onClick={() => setActiveTab('ACTIVE')}
                        className={`pb-3 font-bold text-sm transition-colors border-b-2 ${activeTab === 'ACTIVE' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 dark:text-gray-400'}`}
                    >
                        Em Andamento ({activeOrders.length})
                    </button>
                    <button 
                        onClick={() => setActiveTab('HISTORY')}
                        className={`pb-3 font-bold text-sm transition-colors border-b-2 ${activeTab === 'HISTORY' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 dark:text-gray-400'}`}
                    >
                        Histórico ({historyOrders.length})
                    </button>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 py-6">
                {selectedOrder ? (
                    // --- ORDER DETAILS VIEW ---
                    <div className="animate-slide-in-right">
                        <button 
                            onClick={() => {
                                setSelectedOrderId(null);
                                setIsListView(true);
                            }}
                            className="mb-4 text-sm font-bold text-gray-500 hover:text-red-600 flex items-center gap-1"
                        >
                            <ArrowLeft size={16}/> Voltar para lista
                        </button>

                        {/* Live Tracking Map */}
                        {selectedOrder.courierStage === 'TO_CUSTOMER' && (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg p-4 mb-6 border border-gray-200 dark:border-slate-800 animate-fade-in">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                        <Bike size={20} className="text-red-600" /> Acompanhe a Entrega
                                    </h3>
                                    {selectedOrder.courierId ? (
                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded font-bold animate-pulse">Motoboy em rota</span>
                                    ) : (
                                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded font-bold">Aguardando motoboy</span>
                                    )}
                                </div>
                                <div className="mb-3 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                                    Pedido pego e a caminho.
                                </div>
                                {selectedOrder.courierId ? (
                                    <TrackingMap order={selectedOrder} />
                                ) : (
                                    <div className="w-full h-48 bg-gray-100 dark:bg-slate-800 rounded-xl flex items-center justify-center text-gray-400">
                                        <p className="text-sm">Mapa disponível assim que o motoboy aceitar</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 overflow-hidden mb-6">
                            {/* Status Header with Stepper */}
                            <div className="p-6 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border-b border-gray-100 dark:border-slate-700">
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                        <h2 className="text-2xl font-extrabold text-slate-800 dark:text-white">Pedido #{formatOrderNumber(selectedOrder)}</h2>
                                        <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                                            <Clock size={14}/> {new Date(selectedOrder.createdAt || '').toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-bold text-gray-400 uppercase">Total</p>
                                        <p className="text-xl font-extrabold text-red-600">{formatCurrencyBRL(selectedOrder.total)}</p>
                                    </div>
                                </div>
                                {selectedOrder.status !== 'CANCELLED' && selectedOrder.status !== 'COMPLETED' && (
                                    <div className="flex justify-end mb-4">
                                        <button
                                            onClick={() => setShowCancelModal(true)}
                                            className="px-4 py-2 rounded-lg border border-red-200 text-red-600 font-bold text-xs hover:bg-red-50"
                                        >
                                            Cancelar pedido
                                        </button>
                                    </div>
                                )}

                                {/* STEPPER PROGRESS BAR */}
                                {selectedOrder.status !== 'CANCELLED' && (
                                    <div className="relative flex justify-between items-center mb-4 px-2">
                                        {/* Connecting Line */}
                                        <div className="absolute top-3 left-0 w-full h-1 bg-gray-200 dark:bg-slate-700 -z-0 rounded-full"></div>
                                        
                                        {/* Steps */}
                                        {getOrderSteps(selectedOrder).map((step) => {
                                            const status = getStepStatus(selectedOrder, getEffectiveStatus(selectedOrder))(step.id);
                                            const isActive = status === 'current' || status === 'completed';
                                            return (
                                                <div key={step.id} className="flex flex-col items-center gap-2 z-10">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 border-2 ${isActive ? 'bg-green-500 border-green-500 text-white shadow-lg scale-110' : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-300'}`}>
                                                        <step.icon size={14} />
                                                    </div>
                                                    <span className={`text-[9px] md:text-[10px] text-center font-bold max-w-[60px] leading-tight ${isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>{step.label}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {selectedOrder.status === 'CANCELLED' && (
                                    <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-200 dark:border-red-800 flex items-center gap-3 text-red-700 dark:text-red-400 font-bold">
                                        <XCircle size={24} /> Pedido Cancelado
                                    </div>
                                )}
                                {selectedOrder.status === 'CANCELLED' && selectedOrder.cancelReason && (
                                    <div className="mt-3 bg-white dark:bg-slate-900 border border-red-100 dark:border-red-900/50 rounded-xl p-3 text-sm text-slate-700 dark:text-slate-200">
                                        Motivo: {selectedOrder.cancelReason}
                                    </div>
                                )}
                            </div>

                            {/* Order Type Info */}
                            <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between text-sm">
                                <span className="font-bold text-slate-700 dark:text-gray-300 flex items-center gap-2">
                                    {getOrderType(selectedOrder) === 'PICKUP' ? <ShoppingBag size={16} /> : getOrderType(selectedOrder) === 'TABLE' ? <Utensils size={16} /> : <Bike size={16} />}
                                    {getOrderType(selectedOrder) === 'PICKUP'
                                        ? 'Retirada no Balcão'
                                        : getOrderType(selectedOrder) === 'TABLE'
                                        ? `Mesa${selectedOrder.tableNumber ? ` ${selectedOrder.tableNumber}` : ''}`
                                        : 'Entrega Delivery'}
                                </span>
                                {selectedOrder.paymentMethod && (
                                    <span className="text-gray-500 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-gray-200 dark:border-slate-700 text-xs font-medium max-w-[200px] truncate">
                                        {selectedOrder.paymentMethod}
                                    </span>
                                )}
                            </div>

                            {/* Items List */}
                            <div className="p-6 bg-white dark:bg-slate-900">
                                <h3 className="text-sm font-bold text-gray-500 uppercase mb-4">Itens do Pedido</h3>
                                <div className="space-y-4">
                                    {selectedOrder.items.map((itemStr, idx) => {
                                        return (
                                            <div key={idx} className="flex items-start gap-4 p-3 rounded-lg bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800">
                                                <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center text-red-600 text-xs font-bold shrink-0">
                                                    {idx + 1}
                                                </div>
                                                <p className="text-sm font-medium text-slate-800 dark:text-gray-200 leading-relaxed">{itemStr}</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Refund Status Banner */}
                            {selectedOrder.refundStatus && selectedOrder.refundStatus !== 'NONE' && (
                                <div className={`p-4 border-t border-gray-100 dark:border-slate-800 flex items-center gap-3
                                    ${selectedOrder.refundStatus === 'APPROVED' ? 'bg-green-50 text-green-800' :
                                      selectedOrder.refundStatus === 'REJECTED' ? 'bg-red-50 text-red-800' :
                                      'bg-yellow-50 text-yellow-800'
                                    }`}>
                                    <AlertTriangle size={20} />
                                    <div>
                                        <p className="font-bold text-sm">
                                            {selectedOrder.refundStatus === 'REQUESTED' ? 'Solicitação de Reembolso em Análise' :
                                             selectedOrder.refundStatus === 'APPROVED' ? 'Reembolso Aprovado' :
                                             'Reembolso Negado'}
                                        </p>
                                        <p className="text-xs opacity-80">
                                            {selectedOrder.refundStatus === 'REQUESTED' ? 'Aguarde o retorno da loja pelo chat abaixo.' :
                                             selectedOrder.refundStatus === 'APPROVED' ? 'O valor será estornado conforme método de pagamento.' :
                                             'Entre em contato com a loja para mais detalhes.'}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Actions */}
                            {selectedOrder.status === 'COMPLETED' && selectedOrder.refundStatus === undefined && (
                                <div className="p-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900">
                                    <button 
                                        onClick={() => setShowRefundModal(true)}
                                        className="w-full py-3 border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-50 transition-colors text-sm"
                                    >
                                        Solicitar Reembolso
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Chat Section */}
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-200 dark:border-slate-800 overflow-hidden flex flex-col h-[400px]">
                            <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2 bg-slate-50 dark:bg-slate-800">
                                <MessageCircle className="text-red-600" size={20} />
                                <div>
                                    <h3 className="font-bold text-slate-800 dark:text-white text-sm">Chat com a Loja</h3>
                                    <p className="text-xs text-gray-500">Tire suas dúvidas aqui</p>
                                </div>
                            </div>
                            <div className="flex-1 p-4 overflow-y-auto bg-white dark:bg-slate-950 space-y-4">
                                {selectedOrder.chat?.map((msg, idx) => (
                                    <div key={idx} className={`flex ${msg.sender === 'CLIENT' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[80%] p-3 rounded-2xl text-sm shadow-sm ${
                                            msg.sender === 'CLIENT' 
                                            ? 'bg-red-600 text-white rounded-tr-none' 
                                            : 'bg-gray-100 dark:bg-slate-800 text-slate-800 dark:text-white rounded-tl-none'
                                        }`}>
                                            <p>{msg.message}</p>
                                            <p className={`text-[10px] mt-1 text-right ${msg.sender === 'CLIENT' ? 'text-red-100' : 'text-gray-400'}`}>
                                                {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                                {(!selectedOrder.chat || selectedOrder.chat.length === 0) && (
                                    <div className="text-center text-gray-400 text-sm py-8 flex flex-col items-center gap-2">
                                        <MessageCircle size={24} className="opacity-30" />
                                        <p>Nenhuma mensagem ainda.</p>
                                    </div>
                                )}
                            </div>
                            <div className="p-3 border-t border-gray-100 dark:border-slate-800 flex gap-2 bg-gray-50 dark:bg-slate-900">
                                <input 
                                    type="text" 
                                    value={chatMessage}
                                    onChange={(e) => setChatMessage(e.target.value)}
                                    placeholder="Digite sua mensagem..."
                                    className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500 dark:text-white"
                                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                />
                                <button 
                                    onClick={handleSendMessage}
                                    className="p-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors shadow-md"
                                >
                                    <Send size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    // --- LIST OF ORDERS VIEW ---
                    <div className="space-y-4 animate-fade-in">
                        {(activeTab === 'ACTIVE' ? activeOrders : historyOrders).length === 0 ? (
                            <div className="text-center py-20 flex flex-col items-center">
                                <div className="w-24 h-24 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 text-gray-300 dark:text-slate-600">
                                    <Package size={48} />
                                </div>
                                <h3 className="font-bold text-xl text-slate-800 dark:text-white mb-2">Nenhum pedido</h3>
                                <p className="text-gray-500 max-w-xs">
                                    {activeTab === 'ACTIVE' 
                                     ? 'Você não tem pedidos em andamento. Que tal pedir algo gostoso?' 
                                     : 'Seu histórico de pedidos está vazio.'}
                                </p>
                            </div>
                        ) : (
                            (activeTab === 'ACTIVE' ? activeOrders : historyOrders).map(order => {
                                const effectiveStatus = getEffectiveStatus(order);
                                return (
                                <div 
                                    key={order.id}
                                    onClick={() => {
                                        setSelectedOrderId(order.id);
                                        setIsListView(false);
                                    }}
                                    className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-gray-100 dark:border-slate-800 shadow-sm cursor-pointer hover:shadow-lg hover:border-red-100 dark:hover:border-red-900/30 transition-all group relative overflow-hidden"
                                >
                                    <div className="absolute top-0 left-0 w-1 h-full bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-sm ${order.status === 'COMPLETED' ? 'bg-green-100 text-green-600' : 'bg-red-50 text-red-600 dark:bg-slate-800'}`}>
                                                {effectiveStatus === 'DELIVERING'
                                                    ? getOrderType(order) === 'PICKUP'
                                                        ? <ShoppingBag size={20} />
                                                        : <Bike size={20} className="animate-pulse" />
                                                    : effectiveStatus === 'WAITING_COURIER'
                                                        ? <Clock size={20} />
                                                        : <ShoppingBag size={20} />}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                                                    {/* Ideally Store Name, fallback to ID */}
                                                    Pedido #{formatOrderNumber(order)}
                                                </h3>
                                                <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                                    <Clock size={10} /> {new Date(order.createdAt || '').toLocaleDateString()} às {new Date(order.createdAt || '').toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                </p>
                                            </div>
                                        </div>
                                        <span className="font-bold text-slate-800 dark:text-white">{formatCurrencyBRL(order.total)}</span>
                                    </div>
                                    
                                    {/* Mini Stepper for Active Orders */}
                                    {activeTab === 'ACTIVE' && order.status !== 'CANCELLED' && (
                                        <div className="mt-2 mb-4">
                                            <div className="w-full bg-gray-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                                                <div 
                                                    className="h-full bg-red-500 rounded-full transition-all duration-1000"
                                                    style={{ width: getProgressWidth(order, effectiveStatus) }}
                                                ></div>
                                            </div>
                                            <p className="text-xs font-bold text-red-600 mt-2 text-right uppercase tracking-wider">
                                                {getProgressLabel(order, effectiveStatus)}
                                            </p>
                                        </div>
                                    )}

                                    {activeTab === 'HISTORY' && (
                                        <div className="mt-2 flex gap-2">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 w-fit ${order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                {order.status === 'COMPLETED' ? <CheckCircle size={12}/> : <AlertTriangle size={12}/>}
                                                {order.status === 'COMPLETED' ? 'Concluído' : 'Cancelado'}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                            })
                        )}
                    </div>
                )}
            </main>

            {/* Refund Modal */}
            {showRefundModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl p-6 animate-scale-in">
                        <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">Solicitar Reembolso</h3>
                        <p className="text-sm text-gray-500 mb-4">Conte-nos o motivo da solicitação.</p>
                        <textarea 
                            value={refundReason}
                            onChange={(e) => setRefundReason(e.target.value)}
                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-red-500 dark:text-white mb-4"
                            rows={4}
                            placeholder="Ex: Pedido veio errado, comida fria..."
                        />
                        <div className="flex gap-3">
                            <button onClick={() => setShowRefundModal(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl">Cancelar</button>
                            <button onClick={handleRequestRefund} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg">Enviar Solicitação</button>
                        </div>
                    </div>
                </div>
            )}

            {showCancelModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl p-6 animate-scale-in">
                        <h3 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">Cancelar pedido</h3>
                        <p className="text-sm text-gray-500 mb-4">Informe o motivo do cancelamento.</p>
                        <textarea
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 dark:bg-slate-800 dark:text-white"
                            rows={4}
                            placeholder="Ex: item indisponível"
                        />
                        <div className="mt-4 flex gap-2">
                            <button
                                onClick={() => { setShowCancelModal(false); setCancelReason(''); }}
                                className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 font-bold"
                            >
                                Voltar
                            </button>
                            <button
                                onClick={handleCancelOrder}
                                className="flex-1 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700"
                                disabled={!cancelReason.trim()}
                            >
                                Confirmar cancelamento
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ClientOrders;
