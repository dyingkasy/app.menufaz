
import React, { useState, useEffect, useRef } from 'react';
import { Bike, MapPin, Navigation, CheckCircle, Clock, DollarSign, Settings, LogOut, ShieldAlert, Wallet, Bell, ChevronRight, User, Loader2 } from 'lucide-react';
import { Order, Coordinates } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getOpenOrdersForCity, acceptOrder, getCourierActiveOrders, updateCourierLocation, getCourierHistory, updateCourierCity } from '../services/db';
import { calculateDistance, GEO_API_ENABLED } from '../utils/geo';
import { formatCurrencyBRL } from '../utils/format';

interface CourierDashboardProps {
    onLogout: () => void;
}

const CourierDashboard: React.FC<CourierDashboardProps> = ({ onLogout }) => {
    const { user, refreshUser } = useAuth();
    const [activeTab, setActiveTab] = useState<'ORDERS' | 'MY_DELIVERIES' | 'WALLET' | 'SETTINGS'>('ORDERS');
    const [locationPermission, setLocationPermission] = useState<'GRANTED' | 'DENIED' | 'PROMPT'>('PROMPT');
    const [currentLocation, setCurrentLocation] = useState<Coordinates | null>(null);
    
    // Data
    const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
    const [myActiveOrders, setMyActiveOrders] = useState<Order[]>([]);
    const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);

    // Location Tracker Ref
    const watchIdRef = useRef<number | null>(null);

    // Setup Geolocation & Data Fetching
    useEffect(() => {
        if (!user) return;
        if (!GEO_API_ENABLED) {
            setLocationPermission('GRANTED');
            return;
        }

        // 1. Check/Request Location
        if (navigator.permissions) {
            navigator.permissions.query({ name: 'geolocation' }).then((result) => {
                if (result.state === 'granted') setLocationPermission('GRANTED');
                else if (result.state === 'denied') setLocationPermission('DENIED');
            });
        }

        const startTracking = () => {
            if (navigator.geolocation) {
                watchIdRef.current = navigator.geolocation.watchPosition(
                    (pos) => {
                        setLocationPermission('GRANTED');
                        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                        setCurrentLocation(coords);
                        // Update DB with throttle (simple implementation: every update)
                        // In production, throttle this to save writes.
                        updateCourierLocation(user.uid, coords);
                    },
                    (err) => {
                        console.error("Geo Error", err);
                        if (err.code === err.PERMISSION_DENIED) setLocationPermission('DENIED');
                    },
                    { enableHighAccuracy: true }
                );
            }
        };

        startTracking();

        return () => {
            if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        };
    }, [user]);

    // Data Listeners
    useEffect(() => {
        if (!user || (GEO_API_ENABLED && locationPermission !== 'GRANTED') || !user.city) return;

        const unsubscribeOpen = getOpenOrdersForCity(user.city, (orders) => {
            // Filter active only just in case
            setAvailableOrders(orders);
            setLoading(false);
        });

        const unsubscribeMyActive = getCourierActiveOrders(user.uid, (orders) => {
            setMyActiveOrders(orders);
        });

        // Fetch history once
        getCourierHistory(user.uid).then(setHistoryOrders);

        return () => {
            unsubscribeOpen();
            unsubscribeMyActive();
        };
    }, [user, locationPermission]);

    const handleAcceptOrder = async (order: Order) => {
        if (!user) return;
        if (confirm(`Aceitar corrida da loja ${order.storeId}?`)) {
            try {
                await acceptOrder(order.id, user.uid);
                setActiveTab('MY_DELIVERIES');
            } catch (e) {
                alert("Erro ao aceitar corrida. Talvez outro motoboy já tenha pego.");
            }
        }
    };

    const handleUpdateCity = async (newCity: string) => {
        if(!user) return;
        await updateCourierCity(user.uid, newCity);
        await refreshUser();
        alert("Cidade atualizada! Buscando novos pedidos...");
    };

    // --- RENDER ---

    if (GEO_API_ENABLED && locationPermission !== 'GRANTED') {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-8 text-center text-white">
                <div className="w-24 h-24 bg-red-600 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-red-600/50 animate-pulse">
                    <MapPin size={48} />
                </div>
                <h1 className="text-2xl font-bold mb-4">Localização Necessária</h1>
                <p className="text-gray-400 mb-8 max-w-xs">
                    Para receber corridas e compartilhar sua posição com os clientes, você precisa permitir o acesso à localização.
                </p>
                {locationPermission === 'DENIED' ? (
                    <div className="bg-red-900/30 p-4 rounded-xl border border-red-800 text-sm">
                        <p className="font-bold text-red-400">Acesso Negado</p>
                        <p className="text-gray-300 mt-1">Por favor, habilite a localização nas configurações do seu navegador.</p>
                    </div>
                ) : (
                    <button 
                        onClick={() => navigator.geolocation.getCurrentPosition(() => {}, () => {})}
                        className="bg-white text-slate-900 px-8 py-3 rounded-xl font-bold hover:bg-gray-100"
                    >
                        Permitir Localização
                    </button>
                )}
                <button onClick={onLogout} className="mt-8 text-gray-500 text-sm hover:text-white">Sair</button>
            </div>
        );
    }

    // Calculate Wallet
    const todayEarnings = historyOrders
        .filter(o => new Date(o.createdAt!).toDateString() === new Date().toDateString())
        .reduce((acc, o) => acc + 5.00, 0); // Assuming deliveryFee is 5.00 fixed or from order.deliveryFee (mocked)
        // Note: The prompt asked to SHOW commission. Let's assume commission is fixed R$5 or delivery fee.
        // We don't have deliveryFee in Order type strictly yet, only in Store. But createOrder passed total.
        // Let's assume a fixed R$ 5,00 per run for MVP visualization or derive from Order total logic.
    
    const totalPending = myActiveOrders.length * 5.00;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-24 font-sans">
            {/* Header */}
            <header className="bg-slate-900 text-white p-6 rounded-b-3xl shadow-lg sticky top-0 z-20">
                <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-600/50">
                            <Bike size={24} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold leading-tight">Olá, {user?.name}</h1>
                            <div className="flex items-center gap-1 text-xs text-gray-400">
                                <MapPin size={10} /> {user?.city}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button className="p-2 bg-slate-800 rounded-lg text-gray-400 relative">
                            <Bell size={20} />
                            {availableOrders.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>}
                        </button>
                    </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-800 p-3 rounded-xl">
                        <p className="text-xs text-gray-400 uppercase font-bold">Hoje</p>
                        <p className="text-xl font-bold text-green-400">{formatCurrencyBRL(todayEarnings)}</p>
                    </div>
                    <div className="bg-slate-800 p-3 rounded-xl">
                        <p className="text-xs text-gray-400 uppercase font-bold">Pendente</p>
                        <p className="text-xl font-bold text-white">{formatCurrencyBRL(totalPending)}</p>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="p-4">
                {activeTab === 'ORDERS' && (
                    <div className="space-y-4 animate-fade-in">
                        <h2 className="font-bold text-slate-800 dark:text-white text-lg flex items-center gap-2">
                            <Navigation size={20} className="text-red-600" /> Pedidos na Região
                        </h2>
                        
                        {availableOrders.length === 0 ? (
                            <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl text-center text-gray-400 border border-gray-200 dark:border-slate-800">
                                <p>Nenhum pedido disponível em {user?.city} no momento.</p>
                                <Loader2 className="animate-spin mx-auto mt-4 opacity-50" />
                            </div>
                        ) : (
                            availableOrders.map(order => {
                                // Mock commission calculation (e.g. 10% of order or fixed)
                                const commission = 5.00; 
                                const distance = currentLocation && order.storeCoordinates 
                                    ? calculateDistance(currentLocation, order.storeCoordinates).toFixed(1) 
                                    : '--';

                                return (
                                    <div key={order.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 relative overflow-hidden">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <h3 className="font-bold text-slate-800 dark:text-white">Pedido #{order.id.slice(0,4)}</h3>
                                                <p className="text-sm text-gray-500">{order.storeCity} • {distance} km da loja</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-xs text-gray-400 uppercase font-bold">Ganho</p>
                                                <p className="text-xl font-bold text-green-600">{formatCurrencyBRL(commission)}</p>
                                            </div>
                                        </div>
                                        
                                        <div className="bg-gray-50 dark:bg-slate-800 p-3 rounded-xl mb-4 text-sm space-y-1">
                                            <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300">
                                                <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
                                                <span>Coleta: <strong>Loja Parceira</strong></span>
                                            </div>
                                            <div className="h-4 border-l border-dashed border-gray-300 ml-1"></div>
                                            <div className="flex items-center gap-2 text-slate-700 dark:text-gray-300">
                                                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                                                <span>Entrega: <strong>{order.customerName}</strong></span>
                                            </div>
                                        </div>

                                        <button 
                                            onClick={() => handleAcceptOrder(order)}
                                            className="w-full bg-slate-900 dark:bg-red-600 text-white py-3 rounded-xl font-bold shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
                                        >
                                            Puxar Corrida <ChevronRight size={18} />
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {activeTab === 'MY_DELIVERIES' && (
                    <div className="space-y-4 animate-fade-in">
                         <h2 className="font-bold text-slate-800 dark:text-white text-lg">Minhas Entregas Ativas</h2>
                         {myActiveOrders.length === 0 ? (
                             <p className="text-gray-500 text-center py-8">Você não tem entregas em andamento.</p>
                         ) : (
                             myActiveOrders.map(order => (
                                <div key={order.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl shadow-md border-l-4 border-green-500">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">EM ANDAMENTO</span>
                                        <span className="font-mono text-xs text-gray-400">#{order.id.slice(0,4)}</span>
                                    </div>
                                    <h3 className="font-bold text-lg text-slate-800 dark:text-white mb-1">{order.customerName}</h3>
                                    <p className="text-sm text-gray-500 mb-4">Rua X, 123 (Mock Address)</p>
                                    
                                    <div className="flex gap-2">
                                        <button className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-bold text-sm">Abrir Mapa</button>
                                        <button className="flex-1 bg-gray-100 dark:bg-slate-800 text-slate-800 dark:text-white py-2 rounded-lg font-bold text-sm">Detalhes</button>
                                    </div>
                                </div>
                             ))
                         )}
                    </div>
                )}

                {activeTab === 'WALLET' && (
                    <div className="space-y-4 animate-fade-in">
                         <h2 className="font-bold text-slate-800 dark:text-white text-lg">Carteira</h2>
                         <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-6 text-white shadow-xl">
                             <p className="text-sm text-slate-400 mb-1">Saldo Total Disponível</p>
                             <h3 className="text-3xl font-bold mb-4">{formatCurrencyBRL(todayEarnings * 1.5)}</h3> {/* Mock total */}
                             <button className="w-full bg-white/10 hover:bg-white/20 py-2 rounded-lg font-bold text-sm transition-colors">
                                 Solicitar Saque
                             </button>
                         </div>
                         
                         <h3 className="font-bold text-gray-500 uppercase text-xs mt-6 mb-2">Histórico Recente</h3>
                         <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 divide-y divide-gray-100 dark:divide-slate-800">
                             {historyOrders.slice(0, 5).map(order => (
                                 <div key={order.id} className="p-4 flex justify-between items-center">
                                     <div>
                                         <p className="font-bold text-slate-800 dark:text-white text-sm">Entrega #{order.id.slice(0,4)}</p>
                                         <p className="text-xs text-gray-400">{new Date(order.createdAt!).toLocaleDateString()}</p>
                                     </div>
                                     <span className="text-green-600 font-bold text-sm">+ R$ 5.00</span>
                                 </div>
                             ))}
                         </div>
                    </div>
                )}

                {activeTab === 'SETTINGS' && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 space-y-6 animate-fade-in">
                        <h2 className="font-bold text-slate-800 dark:text-white text-lg">Configurações</h2>
                        
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cidade de Atuação</label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    defaultValue={user?.city} 
                                    id="cityInput"
                                    className="flex-1 p-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl outline-none dark:text-white"
                                />
                                <button 
                                    onClick={() => {
                                        const val = (document.getElementById('cityInput') as HTMLInputElement).value;
                                        handleUpdateCity(val);
                                    }}
                                    className="bg-red-600 text-white px-4 rounded-xl font-bold"
                                >
                                    Salvar
                                </button>
                            </div>
                        </div>
                        
                        <button onClick={onLogout} className="w-full py-3 border border-red-100 text-red-600 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors">
                            <LogOut size={18} /> Sair da Conta
                        </button>
                    </div>
                )}
            </main>

            {/* Bottom Nav */}
            <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800 pb-safe">
                <div className="flex justify-around items-center h-16">
                    <button onClick={() => setActiveTab('ORDERS')} className={`flex flex-col items-center gap-1 ${activeTab === 'ORDERS' ? 'text-red-600' : 'text-gray-400'}`}>
                        <Navigation size={24} />
                        <span className="text-[10px] font-bold">Corridas</span>
                    </button>
                    <button onClick={() => setActiveTab('MY_DELIVERIES')} className={`flex flex-col items-center gap-1 ${activeTab === 'MY_DELIVERIES' ? 'text-red-600' : 'text-gray-400'}`}>
                        <Bike size={24} />
                        <span className="text-[10px] font-bold">Minhas</span>
                    </button>
                    <button onClick={() => setActiveTab('WALLET')} className={`flex flex-col items-center gap-1 ${activeTab === 'WALLET' ? 'text-red-600' : 'text-gray-400'}`}>
                        <Wallet size={24} />
                        <span className="text-[10px] font-bold">Carteira</span>
                    </button>
                    <button onClick={() => setActiveTab('SETTINGS')} className={`flex flex-col items-center gap-1 ${activeTab === 'SETTINGS' ? 'text-red-600' : 'text-gray-400'}`}>
                        <User size={24} />
                        <span className="text-[10px] font-bold">Perfil</span>
                    </button>
                </div>
            </nav>
        </div>
    );
};

export default CourierDashboard;
