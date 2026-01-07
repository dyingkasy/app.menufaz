import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Building2, Users, LogOut, Search, CheckCircle, XCircle, Trash2, ExternalLink, TrendingUp, DollarSign, ShieldCheck, Inbox, Phone, MapPin, User, Check, X, Mail, Copy, Send, Loader2, AlertTriangle, Settings, Save, HelpCircle, Info, Lock, Unlock, Banknote } from 'lucide-react';
import { Store, StoreRequest, AppSettings } from '../types';
import { getStores, toggleStoreStatus, deleteStore, getStoreRequests, approveStoreRequest, rejectStoreRequest, getAppSettings, saveAppSettings } from '../services/db';
import { useAuth } from '../contexts/AuthContext';
import emailjs from '@emailjs/browser';

interface SuperAdminDashboardProps {
    onLogout: () => void;
    onManageStore: (store: Store) => void;
}

const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ onLogout, onManageStore }) => {
    const { user } = useAuth();
    const [stores, setStores] = useState<Store[]>([]);
    const [requests, setRequests] = useState<StoreRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'STORES' | 'REQUESTS' | 'USERS' | 'SETTINGS'>('OVERVIEW');

    // Settings State
    const [settings, setSettings] = useState<AppSettings>({
        emailJsServiceId: '',
        emailJsTemplateId: '',
        emailJsPublicKey: ''
    });
    const [savingSettings, setSavingSettings] = useState(false);

    // Request Modal State
    const [selectedRequest, setSelectedRequest] = useState<StoreRequest | null>(null);
    const [generatedLink, setGeneratedLink] = useState<string | null>(null);
    const [isSendingEmail, setIsSendingEmail] = useState(false);
    const [emailStatus, setEmailStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR'>('IDLE');

    // BLOCK MODAL STATE
    const [blockingStore, setBlockingStore] = useState<Store | null>(null);
    const [blockReason, setBlockReason] = useState('');
    const [isFinancialBlock, setIsFinancialBlock] = useState(false);
    const [financialValue, setFinancialValue] = useState('');
    const [financialInstallments, setFinancialInstallments] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [storesData, requestsData, settingsData] = await Promise.all([
                getStores(),
                getStoreRequests(),
                getAppSettings()
            ]);
            setStores(storesData);
            setRequests(requestsData);
            setSettings(settingsData);

            // Inicializa EmailJS se a public key estiver salva
            if (settingsData.emailJsPublicKey) {
                emailjs.init(settingsData.emailJsPublicKey);
            }
        } catch (error) {
            console.error("Error loading admin data", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveSettings = async () => {
        setSavingSettings(true);
        try {
            await saveAppSettings(settings);
            if (settings.emailJsPublicKey) {
                emailjs.init(settings.emailJsPublicKey);
            }
            alert("Configurações salvas com sucesso!");
        } catch (error) {
            alert("Erro ao salvar configurações.");
        } finally {
            setSavingSettings(false);
        }
    };

    // --- BLOCKING LOGIC ---

    const handleOpenBlockModal = (store: Store) => {
        if (!store.isActive) {
            // Se já está bloqueada, vamos desbloquear (simples confirm)
            if (confirm(`Tem certeza que deseja DESBLOQUEAR a loja ${store.name}?`)) {
                confirmUnblock(store);
            }
        } else {
            // Abrir modal de bloqueio
            setBlockingStore(store);
            setBlockReason('');
            setIsFinancialBlock(false);
            setFinancialValue('');
            setFinancialInstallments('');
        }
    };

    const confirmBlock = async () => {
        if (!blockingStore) return;
        if (!blockReason.trim()) {
            alert("A justificativa é obrigatória para bloquear uma empresa.");
            return;
        }

        if (isFinancialBlock && (!financialValue || !financialInstallments)) {
            alert("Para bloqueio financeiro, informe o valor e parcelas.");
            return;
        }

        const updatedData = {
            isActive: false,
            blockReason: blockReason,
            isFinancialBlock: isFinancialBlock,
            financialValue: isFinancialBlock ? parseFloat(financialValue) : 0,
            financialInstallments: isFinancialBlock ? parseInt(financialInstallments) : 0
        };

        try {
            await toggleStoreStatus(blockingStore.id, updatedData);
            setStores(prev => prev.map(s => s.id === blockingStore.id ? { ...s, ...updatedData } : s));
            setBlockingStore(null); // Close modal
        } catch (e) {
            alert("Erro ao bloquear empresa.");
        }
    };

    const confirmUnblock = async (store: Store) => {
        const updatedData = {
            isActive: true,
            blockReason: '',
            isFinancialBlock: false,
            financialValue: 0,
            financialInstallments: 0
        };
        try {
            await toggleStoreStatus(store.id, updatedData);
            setStores(prev => prev.map(s => s.id === store.id ? { ...s, ...updatedData } : s));
        } catch (e) {
            alert("Erro ao desbloquear empresa.");
        }
    };


    const handleDelete = async (storeId: string) => {
        if (confirm('ATENÇÃO: Essa ação é irreversível. Tem certeza que deseja excluir esta empresa?')) {
            await deleteStore(storeId);
            setStores(prev => prev.filter(s => s.id !== storeId));
        }
    };

    const handleOpenApprovalModal = (request: StoreRequest) => {
        setSelectedRequest(request);
        setGeneratedLink(null);
        setEmailStatus('IDLE');
    };

    const handleConfirmApproval = async () => {
        if (!selectedRequest) return;
        
        setIsSendingEmail(true);
        
        try {
            // 1. Aprovar no Banco de Dados
            await approveStoreRequest(selectedRequest);
            
            // 2. Gerar Link
            const link = `${window.location.origin}?finish_signup=${selectedRequest.id}`;
            setGeneratedLink(link);
            setRequests(prev => prev.map(r => r.id === selectedRequest.id ? { ...r, status: 'APPROVED' } : r));

            // 3. Enviar Email Automático via EmailJS
            if (!settings.emailJsServiceId || !settings.emailJsTemplateId || !settings.emailJsPublicKey) {
                alert("ATENÇÃO: As chaves de e-mail não estão configuradas na aba CONFIGURAÇÕES. O email NÃO foi enviado. Copie o link manualmente.");
                setEmailStatus('ERROR');
                setIsSendingEmail(false);
                return;
            }

            // Reinicializa para garantir
            emailjs.init(settings.emailJsPublicKey);

            // PARÂMETROS QUE SERÃO ENVIADOS PARA O EMAILJS
            const templateParams = {
                to_email: selectedRequest.email,     // No EmailJS campo "To Email": {{to_email}}
                owner_name: selectedRequest.ownerName, // No EmailJS corpo: {{owner_name}}
                store_name: selectedRequest.storeName, // No EmailJS corpo/assunto: {{store_name}}
                activation_link: link,                 // No EmailJS corpo: {{activation_link}}
                reply_to: 'suporte@menufaz.com.br'
            };

            const response = await emailjs.send(
                settings.emailJsServiceId, 
                settings.emailJsTemplateId, 
                templateParams
            );
            
            if (response.status === 200) {
                setEmailStatus('SUCCESS');
            } else {
                throw new Error("EmailJS status not 200");
            }

        } catch (e) {
            console.error("Erro CRÍTICO no envio de email:", e);
            setEmailStatus('ERROR');
            alert("A empresa foi aprovada, mas houve um erro ao enviar o email. Verifique o Console (F12) para ver o erro detalhado.");
        } finally {
            setIsSendingEmail(false);
        }
    };

    const handleRejectRequest = async (requestId: string) => {
        if (confirm('Tem certeza que deseja recusar esta solicitação?')) {
            try {
                await rejectStoreRequest(requestId);
                // Remove da lista local para refletir a mudança imediata (agora é REJECTED, não PENDING)
                setRequests(prev => prev.filter(r => r.id !== requestId));
            } catch (e) {
                alert("Erro ao recusar solicitação.");
            }
        }
    };

    const copyToClipboard = () => {
        if (generatedLink) {
            navigator.clipboard.writeText(generatedLink);
            alert("Link copiado!");
        }
    };

    const filteredStores = stores.filter(s => 
        s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        s.id.includes(searchTerm)
    );

    const totalRevenue = stores.length * 12500; 
    const activeStores = stores.filter(s => s.isActive).length;
    const pendingRequests = requests.filter(r => r.status === 'PENDING');

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
                <Loader2 className="animate-spin w-10 h-10 text-purple-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex font-sans">
            {/* Sidebar */}
            <aside className="w-64 bg-slate-900 text-white flex flex-col fixed h-full z-10">
                <div className="p-6 border-b border-slate-800 flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-red-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                        <ShieldCheck size={24} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">MenuFaz</h2>
                        <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest">Super Admin</p>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <button 
                        onClick={() => setActiveTab('OVERVIEW')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'OVERVIEW' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                    >
                        <LayoutDashboard size={20} /> Visão Geral
                    </button>
                    <button 
                        onClick={() => setActiveTab('STORES')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'STORES' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                    >
                        <Building2 size={20} /> Empresas
                    </button>
                    <button 
                        onClick={() => setActiveTab('REQUESTS')}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${activeTab === 'REQUESTS' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                    >
                        <div className="flex items-center gap-3">
                            <Inbox size={20} /> Solicitações
                        </div>
                        {pendingRequests.length > 0 && (
                            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">{pendingRequests.length}</span>
                        )}
                    </button>
                    <button 
                        onClick={() => setActiveTab('USERS')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'USERS' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                    >
                        <Users size={20} /> Usuários
                    </button>
                    <button 
                        onClick={() => setActiveTab('SETTINGS')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'SETTINGS' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                    >
                        <Settings size={20} /> Configurações
                    </button>
                </nav>

                <div className="p-4 border-t border-slate-800">
                    <button 
                        onClick={onLogout}
                        className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-red-600/20 hover:text-red-500 text-slate-400 py-2 rounded-lg transition-colors text-sm font-bold"
                    >
                        <LogOut size={16} /> Sair
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-64 p-8">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
                            {activeTab === 'OVERVIEW' ? 'Visão Geral' : 
                             activeTab === 'STORES' ? 'Gerenciar Empresas' : 
                             activeTab === 'REQUESTS' ? 'Solicitações de Cadastro' : 
                             activeTab === 'SETTINGS' ? 'Configurações do Sistema' :
                             'Usuários do Sistema'}
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400">Controle total da plataforma MenuFaz.</p>
                    </div>
                    <div className="flex gap-4">
                        <button onClick={loadData} className="p-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-500 hover:text-purple-600 transition-colors">
                             <TrendingUp size={20} />
                        </button>
                    </div>
                </header>

                {activeTab === 'OVERVIEW' && (
                    <div className="space-y-8 animate-fade-in">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase">Total Empresas</p>
                                        <h3 className="text-3xl font-bold text-slate-800 dark:text-white">{stores.length}</h3>
                                    </div>
                                    <div className="p-3 bg-blue-100 dark:bg-blue-900/20 text-blue-600 rounded-xl"><Building2 /></div>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-green-600 font-bold">
                                    <TrendingUp size={14} /> +12% este mês
                                </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase">Pendentes</p>
                                        <h3 className="text-3xl font-bold text-slate-800 dark:text-white">{pendingRequests.length}</h3>
                                    </div>
                                    <div className="p-3 bg-orange-100 dark:bg-orange-900/20 text-orange-600 rounded-xl"><Inbox /></div>
                                </div>
                                <div className="text-xs text-gray-400">Aguardando aprovação</div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase">Receita Global</p>
                                        <h3 className="text-3xl font-bold text-slate-800 dark:text-white">R$ {totalRevenue.toLocaleString()}</h3>
                                    </div>
                                    <div className="p-3 bg-green-100 dark:bg-green-900/20 text-green-600 rounded-xl"><DollarSign /></div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase">Lojas Ativas</p>
                                        <h3 className="text-3xl font-bold text-slate-800 dark:text-white">{activeStores}</h3>
                                    </div>
                                    <div className="p-3 bg-purple-100 dark:bg-purple-900/20 text-purple-600 rounded-xl"><CheckCircle /></div>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                                    <div className="bg-purple-600 h-1.5 rounded-full" style={{ width: `${(activeStores/stores.length || 1)*100}%` }}></div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'SETTINGS' && (
                    <div className="grid lg:grid-cols-2 gap-8 animate-fade-in">
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-xl flex items-center justify-center text-purple-600">
                                    <Mail size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">Automação de E-mail</h3>
                                    <p className="text-gray-500 text-sm">Configure o EmailJS para envio automático.</p>
                                </div>
                            </div>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 dark:text-gray-300 mb-2">Service ID</label>
                                    <input 
                                        type="text" 
                                        value={settings.emailJsServiceId}
                                        onChange={(e) => setSettings({...settings, emailJsServiceId: e.target.value})}
                                        placeholder="Ex: service_xxxxx"
                                        className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 dark:text-gray-300 mb-2">Template ID</label>
                                    <input 
                                        type="text" 
                                        value={settings.emailJsTemplateId}
                                        onChange={(e) => setSettings({...settings, emailJsTemplateId: e.target.value})}
                                        placeholder="Ex: template_xxxxx"
                                        className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-sm font-bold text-slate-700 dark:text-gray-300">Public Key</label>
                                        <a 
                                            href="https://dashboard.emailjs.com/admin/account" 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-xs text-purple-600 hover:underline flex items-center gap-1"
                                        >
                                            Onde encontrar? <ExternalLink size={12} />
                                        </a>
                                    </div>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            value={settings.emailJsPublicKey}
                                            onChange={(e) => setSettings({...settings, emailJsPublicKey: e.target.value})}
                                            placeholder="Ex: user_xxxxx (Antigo User ID)"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                </div>
                            </div>
                            
                            <div className="mt-8 flex justify-end">
                                <button 
                                    onClick={handleSaveSettings}
                                    disabled={savingSettings}
                                    className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl flex items-center gap-2 transition-all disabled:opacity-70"
                                >
                                    {savingSettings ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                                    Salvar Configurações
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'REQUESTS' && (
                    <div className="space-y-4 animate-fade-in">
                        {pendingRequests.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 text-gray-400">
                                <Inbox size={48} className="mb-4 opacity-20" />
                                <p>Nenhuma solicitação pendente.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {pendingRequests.map(req => (
                                    <div key={req.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-6 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="w-12 h-12 bg-purple-50 dark:bg-purple-900/20 rounded-xl flex items-center justify-center text-purple-600">
                                                <Building2 size={24} />
                                            </div>
                                            <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                                                Pendente
                                            </span>
                                        </div>
                                        
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{req.storeName}</h3>
                                        <div className="space-y-2 mb-6">
                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                                <User size={16} className="text-gray-400" /> {req.ownerName}
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                                <Phone size={16} className="text-gray-400" /> {req.phone}
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                                <Mail size={16} className="text-gray-400" /> {req.email}
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                                                <MapPin size={16} className="text-gray-400" /> {req.city}
                                            </div>
                                        </div>

                                        <div className="flex gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
                                            <button 
                                                onClick={() => handleRejectRequest(req.id)}
                                                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg font-bold text-sm transition-colors"
                                            >
                                                <X size={18} /> Recusar
                                            </button>
                                            <button 
                                                onClick={() => handleOpenApprovalModal(req)}
                                                className="flex-1 flex items-center justify-center gap-2 py-2.5 text-white bg-green-600 hover:bg-green-700 rounded-lg font-bold text-sm transition-colors shadow-md shadow-green-600/20"
                                            >
                                                <Check size={18} /> Aprovar
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'STORES' && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden animate-fade-in">
                        <div className="p-6 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center">
                            <div className="relative w-96">
                                <input 
                                    type="text" 
                                    placeholder="Buscar empresa por nome ou ID..." 
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                                />
                                <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 dark:bg-slate-800 text-left">
                                    <tr>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Empresa</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Categoria</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Avaliação</th>
                                        <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                    {filteredStores.map((store) => (
                                        <tr key={store.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700 overflow-hidden">
                                                        <img src={store.imageUrl} alt={store.name} className="w-full h-full object-cover" />
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-800 dark:text-white text-sm">{store.name}</p>
                                                        <p className="text-xs text-gray-500">ID: {store.id.slice(0,8)}...</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                                                {store.category}
                                            </td>
                                            <td className="px-6 py-4">
                                                <button 
                                                    onClick={() => handleOpenBlockModal(store)}
                                                    className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border ${store.isActive ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200' : 'bg-red-50 text-red-700 border-red-200 hover:bg-green-50 hover:text-green-600 hover:border-green-200'} transition-all w-fit`}
                                                >
                                                    {store.isActive ? (
                                                        <><CheckCircle size={12} /> Ativa</>
                                                    ) : (
                                                        <><XCircle size={12} /> Bloqueada</>
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-sm font-bold text-yellow-600">
                                                ⭐ {store.rating}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button 
                                                        onClick={() => onManageStore(store)}
                                                        className="p-2 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors" 
                                                        title="Acessar Painel da Loja"
                                                    >
                                                        <ExternalLink size={18} />
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(store.id)}
                                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Excluir Empresa"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'USERS' && (
                    <div className="flex flex-col items-center justify-center h-96 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 text-gray-400">
                        <Users size={48} className="mb-4 opacity-20" />
                        <p>Gestão de Usuários em desenvolvimento.</p>
                    </div>
                )}
            </main>

            {/* BLOCK STORE MODAL */}
            {blockingStore && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
                        <div className="p-5 border-b border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-900/20 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-red-700 dark:text-red-400 flex items-center gap-2">
                                <Lock size={20} /> Bloquear Acesso
                            </h3>
                            <button onClick={() => setBlockingStore(null)} className="p-2 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-full text-red-700 dark:text-red-400">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="p-6">
                            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                                Você está bloqueando a empresa <strong>{blockingStore.name}</strong>. Ela perderá o acesso ao painel imediatamente.
                            </p>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Justificativa (Obrigatório)</label>
                                    <textarea 
                                        value={blockReason}
                                        onChange={(e) => setBlockReason(e.target.value)}
                                        placeholder="Ex: Falta de pagamento, violação de termos..."
                                        className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white min-h-[100px]"
                                    />
                                </div>

                                <label className="flex items-start gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                                    <input 
                                        type="checkbox" 
                                        checked={isFinancialBlock} 
                                        onChange={(e) => setIsFinancialBlock(e.target.checked)} 
                                        className="w-5 h-5 accent-red-600 mt-0.5" 
                                    />
                                    <div>
                                        <span className="font-bold text-slate-800 dark:text-white block flex items-center gap-2">
                                            <Banknote size={16} className="text-green-600"/> Bloqueio por Mensalidade
                                        </span>
                                        <span className="text-xs text-gray-500">Marque se o motivo for inadimplência.</span>
                                    </div>
                                </label>

                                {isFinancialBlock && (
                                    <div className="grid grid-cols-2 gap-4 animate-fade-in">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor em Aberto (R$)</label>
                                            <input 
                                                type="number" 
                                                value={financialValue}
                                                onChange={(e) => setFinancialValue(e.target.value)}
                                                placeholder="0.00"
                                                className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nº Parcelas</label>
                                            <input 
                                                type="number" 
                                                value={financialInstallments}
                                                onChange={(e) => setFinancialInstallments(e.target.value)}
                                                placeholder="1"
                                                className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 flex gap-3">
                                <button 
                                    onClick={() => setBlockingStore(null)}
                                    className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl"
                                >
                                    Cancelar
                                </button>
                                <button 
                                    onClick={confirmBlock}
                                    className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg shadow-red-600/20"
                                >
                                    Confirmar Bloqueio
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Approval Modal */}
            {selectedRequest && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
                            <div>
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Aprovar Cadastro</h3>
                                <p className="text-sm text-gray-500">O email será enviado automaticamente.</p>
                            </div>
                            <button onClick={() => setSelectedRequest(null)} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                                <X size={20} className="text-gray-500" />
                            </button>
                        </div>

                         {/* Warning if Keys are default */}
                         {(!settings.emailJsServiceId || !settings.emailJsPublicKey) && (
                            <div className="p-4 bg-orange-100 border-b border-orange-200 text-orange-800 text-sm flex gap-2 items-center">
                                <AlertTriangle size={18} />
                                <span>
                                    <strong>Atenção:</strong> Você precisa configurar o EmailJS na aba CONFIGURAÇÕES para a automação funcionar.
                                </span>
                            </div>
                         )}

                        <div className="flex-1 overflow-y-auto p-8 bg-gray-100 dark:bg-slate-950">
                             {/* Email Template Preview */}
                             <div className="max-w-lg mx-auto bg-white rounded-xl overflow-hidden shadow-xl border border-gray-200">
                                 <div className="bg-slate-900 p-6 text-center">
                                     <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white mx-auto mb-2">
                                         <Building2 size={20} strokeWidth={3} />
                                     </div>
                                     <h2 className="text-2xl font-bold text-white tracking-tight">Menu<span className="text-red-500">Faz</span></h2>
                                 </div>
                                 <div className="p-8 text-center">
                                     <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                                         <CheckCircle size={32} />
                                     </div>
                                     <h1 className="text-2xl font-bold text-slate-800 mb-4">Cadastro Aprovado! 🚀</h1>
                                     <p className="text-gray-600 mb-6 leading-relaxed">
                                         Olá <strong>{selectedRequest.ownerName}</strong>,<br/><br/>
                                         A solicitação da sua loja <strong>{selectedRequest.storeName}</strong> foi analisada e aprovada com sucesso pela nossa equipe.
                                     </p>
                                     <p className="text-gray-600 mb-8">
                                         Um email será enviado agora para <strong>{selectedRequest.email}</strong> com o link de ativação.
                                     </p>
                                 </div>
                             </div>
                        </div>

                        <div className="p-6 border-t border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                            {emailStatus === 'IDLE' ? (
                                <div className="flex justify-end gap-3">
                                    <button 
                                        onClick={() => setSelectedRequest(null)}
                                        className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                                        disabled={isSendingEmail}
                                    >
                                        Cancelar
                                    </button>
                                    <button 
                                        onClick={handleConfirmApproval}
                                        disabled={isSendingEmail}
                                        className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg shadow-green-600/20 flex items-center gap-2 transition-all disabled:opacity-70"
                                    >
                                        {isSendingEmail ? <Loader2 className="animate-spin" /> : <Send size={18} />}
                                        {isSendingEmail ? 'Processando...' : 'Aprovar & Enviar Automático'}
                                    </button>
                                </div>
                            ) : emailStatus === 'SUCCESS' ? (
                                <div className="animate-fade-in">
                                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 rounded-xl p-4 mb-4 flex items-start gap-3">
                                        <CheckCircle className="text-green-600 shrink-0 mt-1" size={20} />
                                        <div>
                                            <h4 className="font-bold text-green-800 dark:text-green-300 text-sm">Sucesso!</h4>
                                            <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                                                A empresa foi aprovada e o e-mail de boas-vindas foi enviado automaticamente para o cliente.
                                            </p>
                                        </div>
                                    </div>
                                    
                                    <div className="mt-4 flex justify-end">
                                        <button 
                                            onClick={() => setSelectedRequest(null)}
                                            className="bg-slate-800 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-700"
                                        >
                                            Fechar
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="animate-fade-in">
                                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-4 flex items-start gap-3">
                                        <XCircle className="text-red-600 shrink-0 mt-1" size={20} />
                                        <div>
                                            <h4 className="font-bold text-red-800 dark:text-red-300 text-sm">Erro no envio automático</h4>
                                            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                                                A empresa foi aprovada, mas o envio falhou. Copie o link abaixo e envie manualmente.
                                            </p>
                                        </div>
                                    </div>
                                     <div className="flex gap-2">
                                        <div className="flex-1 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-300 truncate">
                                            {generatedLink}
                                        </div>
                                        <button 
                                            onClick={copyToClipboard}
                                            className="bg-slate-800 dark:bg-slate-700 text-white px-4 py-2 rounded-xl hover:bg-slate-700 transition-colors flex items-center gap-2 font-bold text-sm"
                                        >
                                            <Copy size={16} /> Copiar
                                        </button>
                                    </div>
                                    <div className="mt-4 flex justify-end">
                                        <button 
                                            onClick={() => setSelectedRequest(null)}
                                            className="text-gray-500 font-bold text-sm hover:underline"
                                        >
                                            Fechar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SuperAdminDashboard;