import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, Legend, ComposedChart
} from 'recharts';
import { 
    DollarSign, Users, ClipboardList, AlertTriangle, 
    CheckCircle, XCircle, ArrowLeft, LayoutDashboard, 
    ShoppingBasket, UtensilsCrossed, Settings, LogOut, Menu, Search, Plus, Edit, Trash, CreditCard, Clock, Store, Image as ImageIcon, UploadCloud, Calendar, X, ChevronRight, Layers, Tag, Save, Copy, Timer, Percent, CalendarDays, Bike, UserPlus, ChevronLeft, Power, Banknote, Calculator, ChevronDown, Check, TrendingUp, TrendingDown, Activity, AlertCircle, Lock, Unlock, Phone, MapPin, User, Zap, Ticket, PieChart as PieChartIcon, Wallet, Upload, Trash2, Eye, Package, Trophy, Navigation, MessageSquare, ArrowUpCircle, ArrowDownCircle, Coins, Receipt, EyeOff, Send, ShieldAlert, ShieldCheck, Mail, ToggleLeft, ToggleRight, Slice, Database
} from 'lucide-react';
import { UserRole, DashboardSection, Product, Order, ProductOptionGroup, ProductOption, Courier, Store as StoreType, ScheduleDay, Coupon, FinancialTransaction, PaymentMethod, PizzaFlavor } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getStoreById, updateStore, getProductsByStore, saveProduct, deleteProduct, subscribeToOrders, updateOrderStatus, getCouponsByStore, saveCoupon, deleteCoupon, getCouriersByStore, saveCourier, deleteCourier, getExpensesByStore, saveExpense, deleteExpense, deleteOrder, getPizzaFlavorsByStore, savePizzaFlavor, deletePizzaFlavor } from '../services/db';
import { DEFAULT_PAYMENT_METHODS } from '../constants';
import { searchAddress } from '../utils/geo';

interface AdminDashboardProps {
    onBack: () => void;
    userRole: UserRole;
    targetStoreId?: string | null;
    isDarkMode: boolean;
    toggleTheme: () => void;
}

// --- CONSTANTS ---
const TRANSACTION_CATEGORIES = [
    // SAÍDAS
    { id: 'VENDAS', label: 'Custo de Venda (Taxas)', color: '#F59E0B', type: 'EXPENSE' },
    { id: 'INSUMOS', label: 'Insumos/Estoque', color: '#EF4444', type: 'EXPENSE' },
    { id: 'ALUGUEL', label: 'Aluguel/Condomínio', color: '#3B82F6', type: 'EXPENSE' },
    { id: 'ENERGIA', label: 'Energia/Água/Gás', color: '#06B6D4', type: 'EXPENSE' },
    { id: 'ENTREGADORES', label: 'Pagamento Entregadores', color: '#8B5CF6', type: 'EXPENSE' },
    { id: 'MARKETING', label: 'Marketing/Ads', color: '#EC4899', type: 'EXPENSE' },
    { id: 'REEMBOLSO', label: 'Reembolsos', color: '#6366F1', type: 'EXPENSE' },
    { id: 'PERDAS', label: 'Perdas/Desperdício', color: '#64748B', type: 'EXPENSE' },
    { id: 'OUTROS_SAIDA', label: 'Outras Saídas', color: '#94A3B8', type: 'EXPENSE' },
    
    // ENTRADAS
    { id: 'APORTE', label: 'Aporte de Caixa', color: '#10B981', type: 'INCOME' },
    { id: 'VENDA_OFF', label: 'Venda Balcão/Fora', color: '#34D399', type: 'INCOME' },
    { id: 'OUTROS_ENTRADA', label: 'Outras Entradas', color: '#6EE7B7', type: 'INCOME' },
];

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack, userRole, targetStoreId, isDarkMode, toggleTheme }) => {
  const { user } = useAuth();
  const storeId = targetStoreId || user?.storeId;

  const [activeSection, setActiveSection] = useState<DashboardSection>('OVERVIEW');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Refs for File Uploads
  const storeLogoInputRef = useRef<HTMLInputElement>(null);
  const productInfoInputRef = useRef<HTMLInputElement>(null);

  // --- STORE SETTINGS STATE ---
  const [storeProfile, setStoreProfile] = useState<Partial<StoreType>>({});
  const [settingsTab, setSettingsTab] = useState<'STORE' | 'ADDRESS' | 'DELIVERY' | 'SCHEDULE' | 'PAYMENTS' | 'SECURITY'>('STORE');
  
  // Endereço Local State (para edição)
  const [addressForm, setAddressForm] = useState({
      cep: '',
      street: '',
      number: '',
      district: '',
      city: '',
      state: '',
      complement: '',
      cnpj: '',
      phone: '',
      email: ''
  });
  
  // Payment Methods State
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(DEFAULT_PAYMENT_METHODS);

  // --- MENU STATE ---
  const [products, setProducts] = useState<Product[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({});
  const [productError, setProductError] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('Todos');

  // --- FLAVOR MANAGER STATE ---
  const [pizzaFlavors, setPizzaFlavors] = useState<PizzaFlavor[]>([]);
  const [showFlavorModal, setShowFlavorModal] = useState(false);
  const [newFlavor, setNewFlavor] = useState<Partial<PizzaFlavor>>({});

  // --- COUPONS STATE ---
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Partial<Coupon>>({});

  // --- ORDERS & REQUESTS STATE ---
  const [orders, setOrders] = useState<Order[]>([]);
  const [isAutoAcceptEnabled, setIsAutoAcceptEnabled] = useState(false);
  
  // --- COURIERS STATE ---
  const [couriers, setCouriers] = useState<Courier[]>([]); 
  const [showCourierModal, setShowCourierModal] = useState(false);
  const [newCourier, setNewCourier] = useState<Partial<Courier>>({ commissionRate: 10, isActive: true });

  // --- FINANCE & TRANSACTIONS STATE ---
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [newTransaction, setNewTransaction] = useState<Partial<FinancialTransaction>>({
      type: 'EXPENSE',
      date: new Date().toISOString().split('T')[0],
      status: 'PAID',
      category: 'OUTROS_SAIDA'
  });

  // --- SALES FILTER STATE ---
  const [salesFilterStatus, setSalesFilterStatus] = useState('ALL');
  const [salesFilterDate, setSalesFilterDate] = useState('');
  const [deleteSaleId, setDeleteSaleId] = useState<string | null>(null);
  const [adminPassInput, setAdminPassInput] = useState('');

  // --- SECURITY SETTINGS STATE ---
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);

  // --- INITIAL DATA LOADING ---
  useEffect(() => {
      if (storeId) {
          const loadStoreData = async () => {
              try {
                  const storeData = await getStoreById(storeId);
                  if (storeData) {
                      // Inicializa Schedule se não existir
                      if (!storeData.schedule || storeData.schedule.length === 0) {
                          const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
                          storeData.schedule = days.map(day => ({
                              day,
                              openTime: '18:00',
                              closeTime: '23:00',
                              isOpen: true
                          }));
                      }

                      setStoreProfile(storeData);
                      // Load extended address fields if they exist
                      const extendedData = storeData as any;
                      setAddressForm({
                          cep: extendedData.cep || '',
                          street: extendedData.street || '',
                          number: extendedData.number || '',
                          district: extendedData.district || '',
                          city: extendedData.city || '',
                          state: extendedData.state || '',
                          complement: extendedData.complement || '',
                          cnpj: extendedData.cnpj || '',
                          phone: extendedData.phone || '',
                          email: extendedData.email || ''
                      });
                      
                      if (extendedData.paymentMethods) {
                          setPaymentMethods(extendedData.paymentMethods);
                      }
                  }

                  const productsData = await getProductsByStore(storeId);
                  setProducts(productsData);

                  const flavorsData = await getPizzaFlavorsByStore(storeId);
                  setPizzaFlavors(flavorsData);

                  const couponsData = await getCouponsByStore(storeId);
                  setCoupons(couponsData);

                  const couriersData = await getCouriersByStore(storeId);
                  setCouriers(couriersData);

                  const expensesData = await getExpensesByStore(storeId);
                  setTransactions(expensesData);

                  setLoading(false);
              } catch (e) {
                  console.error("Error loading store dashboard data:", e);
              }
          };

          loadStoreData();

          const unsubscribeOrders = subscribeToOrders(storeId, (newOrders) => {
              setOrders(newOrders);
          });

          return () => {
              unsubscribeOrders();
          };
      }
  }, [storeId]);

  // --- AUTO ACCEPT LOGIC ---
  useEffect(() => {
      let interval: any;
      if (isAutoAcceptEnabled) {
          interval = setInterval(() => {
              const pendingOrders = orders.filter(o => o.status === 'PENDING');
              pendingOrders.forEach(order => {
                  handleUpdateStatus(order.id, 'PREPARING');
              });
          }, 5000); // Check every 5 seconds
      }
      return () => clearInterval(interval);
  }, [isAutoAcceptEnabled, orders]);

  // --- CALCULATED METRICS ---
  
  // Receita dos últimos 7 dias (Gráfico)
  const weeklyRevenueData = useMemo(() => {
      const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const today = new Date();
      const last7Days = Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(today.getDate() - (6 - i));
          return d;
      });

      return last7Days.map(date => {
          const dateStr = date.toDateString();
          const dayName = days[date.getDay()];
          
          const dailyTotal = orders
              .filter(o => o.status === 'COMPLETED' && new Date(o.createdAt || '').toDateString() === dateStr)
              .reduce((sum, o) => sum + o.total, 0);

          return { name: dayName, value: dailyTotal, fullDate: dateStr };
      });
  }, [orders]);

  // Dados Financeiros Reais
  const financialSummary = useMemo(() => {
      const orderSales = orders
          .filter(o => o.status === 'COMPLETED')
          .reduce((sum, o) => sum + o.total, 0);

      const manualIncome = transactions
          .filter(t => t.type === 'INCOME')
          .reduce((sum, t) => sum + t.amount, 0);

      const totalExpenses = transactions
          .filter(t => t.type === 'EXPENSE')
          .reduce((sum, t) => sum + t.amount, 0);

      const totalRevenue = orderSales + manualIncome;
      const netProfit = totalRevenue - totalExpenses;

      return { totalRevenue, totalExpenses, netProfit, orderSales, manualIncome };
  }, [orders, transactions]);


  // --- HANDLERS ---

  const handleToggleOpenStore = async () => {
      if (!storeId) return;
      const newState = !storeProfile.isActive;
      
      // Optimistic UI Update
      setStoreProfile(prev => ({ ...prev, isActive: newState }));
      
      try {
          await updateStore(storeId, { isActive: newState });
      } catch (e) {
          console.error(e);
          alert("Erro ao atualizar status da loja.");
          // Revert
          setStoreProfile(prev => ({ ...prev, isActive: !newState }));
      }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, target: 'STORE' | 'PRODUCT') => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { alert("A imagem deve ter no máximo 2MB."); return; }
      const reader = new FileReader();
      reader.onload = (event) => {
          const base64 = event.target?.result as string;
          if (target === 'STORE') { setStoreProfile(prev => ({ ...prev, imageUrl: base64 })); } 
          else { setNewProduct(prev => ({ ...prev, imageUrl: base64 })); }
      };
      reader.readAsDataURL(file);
  };

  // ... (Product Handlers remain same) ...
  const handleAddOptionGroup = () => {
      const newGroup: ProductOptionGroup = { id: Date.now().toString(), name: 'Novo Grupo (ex: Molhos)', min: 0, max: 1, options: [] };
      setNewProduct(prev => ({ ...prev, optionGroups: [...(prev.optionGroups || []), newGroup] }));
  };
  const handleUpdateOptionGroup = (groupId: string, field: keyof ProductOptionGroup, value: any) => {
      setNewProduct(prev => ({ ...prev, optionGroups: prev.optionGroups?.map(g => g.id === groupId ? { ...g, [field]: value } : g) }));
  };
  const handleRemoveOptionGroup = (groupId: string) => {
      setNewProduct(prev => ({ ...prev, optionGroups: prev.optionGroups?.filter(g => g.id !== groupId) }));
  };
  const handleAddOptionToGroup = (groupId: string) => {
      const newOption: ProductOption = { id: Date.now().toString(), name: 'Nova Opção', price: 0, isAvailable: true };
      setNewProduct(prev => ({ ...prev, optionGroups: prev.optionGroups?.map(g => { if (g.id === groupId) return { ...g, options: [...g.options, newOption] }; return g; }) }));
  };
  const handleUpdateOption = (groupId: string, optionId: string, field: keyof ProductOption, value: any) => {
      setNewProduct(prev => ({ ...prev, optionGroups: prev.optionGroups?.map(g => { if (g.id === groupId) return { ...g, options: g.options.map(o => o.id === optionId ? { ...o, [field]: value } : o) }; return g; }) }));
  };
  const handleRemoveOption = (groupId: string, optionId: string) => {
      setNewProduct(prev => ({ ...prev, optionGroups: prev.optionGroups?.map(g => { if (g.id === groupId) return { ...g, options: g.options.filter(o => o.id !== optionId) }; return g; }) }));
  };
  const handleSaveProduct = async () => {
      if (!storeId) return;
      if (!newProduct.name) { setProductError('Nome é obrigatório.'); return; }
      if ((newProduct.price || 0) <= 0) { setProductError('Preço deve ser maior que zero.'); return; }
      
      const isPizza = !!newProduct.isPizza;
      const maxFlavors = isPizza ? (newProduct.maxFlavors || 1) : 1;

      const productToSave: Product = {
          id: newProduct.id || Date.now().toString(), storeId: storeId, name: newProduct.name, description: newProduct.description || '', price: Number(newProduct.price),
          promoPrice: newProduct.promoPrice ? Number(newProduct.promoPrice) : undefined, category: newProduct.category || 'Lanches', imageUrl: newProduct.imageUrl || '', 
          isAvailable: newProduct.isAvailable !== undefined ? newProduct.isAvailable : true, 
          isPizza: isPizza, 
          maxFlavors: maxFlavors,
          allowHalfHalf: maxFlavors >= 2, 
          splitSurcharge: newProduct.splitSurcharge ? Number(newProduct.splitSurcharge) : undefined,
          availableFlavorIds: newProduct.availableFlavorIds || [],
          optionGroups: newProduct.optionGroups || []
      };
      try { await saveProduct(productToSave); if (newProduct.id) setProducts(products.map(p => p.id === productToSave.id ? productToSave : p)); else setProducts([productToSave, ...products]); setShowProductModal(false); } catch (e) { alert("Erro ao salvar produto."); }
  };

  const handleDeleteProduct = async (id: string) => {
      if (confirm('Tem certeza que deseja excluir este produto?')) {
          try { await deleteProduct(id); setProducts(products.filter(p => p.id !== id)); } catch (e) { alert("Erro ao excluir produto."); }
      }
  };

  // --- Pizza Flavor Handlers ---
  const handleSaveFlavor = async () => {
      if (!storeId || !newFlavor.name) return;
      const flavorToSave: PizzaFlavor = {
          id: newFlavor.id || Date.now().toString(),
          storeId,
          name: newFlavor.name,
          description: newFlavor.description || '',
          isAvailable: newFlavor.isAvailable ?? true
      };
      try {
          await savePizzaFlavor(flavorToSave);
          if(newFlavor.id) setPizzaFlavors(prev => prev.map(f => f.id === flavorToSave.id ? flavorToSave : f));
          else setPizzaFlavors(prev => [...prev, flavorToSave]);
          setNewFlavor({}); 
          alert("Sabor salvo!");
      } catch (e) { alert("Erro ao salvar sabor."); }
  };

  const handleDeleteFlavor = async (id: string) => {
      if(confirm("Excluir sabor?")) {
          try { await deletePizzaFlavor(id); setPizzaFlavors(prev => prev.filter(f => f.id !== id)); }
          catch(e) { alert("Erro ao excluir."); }
      }
  };

  // ... (Rest of the handlers) ...
  const handleSaveTransaction = async () => {
      if (!storeId) return;
      if (!newTransaction.description || !newTransaction.amount) { alert("Descrição e valor são obrigatórios"); return; }
      const transactionToSave: FinancialTransaction & { storeId: string } = {
          id: newTransaction.id || `trx_${Date.now()}`, storeId: storeId, description: newTransaction.description, type: newTransaction.type || 'EXPENSE',
          amount: Number(newTransaction.amount), date: newTransaction.date || new Date().toISOString().split('T')[0], category: newTransaction.category || 'OUTROS_SAIDA', status: newTransaction.status || 'PAID'
      };
      try { await saveExpense(transactionToSave); if (newTransaction.id) setTransactions(prev => prev.map(e => e.id === transactionToSave.id ? transactionToSave : e)); else setTransactions(prev => [...prev, transactionToSave]); setShowTransactionModal(false); } catch (e) { alert("Erro ao salvar transação."); }
  };
  const handleSaveCourier = async () => {
      if (!storeId || !newCourier.name) return;
      const courierToSave: Courier & { storeId: string } = { id: newCourier.id || Date.now().toString(), storeId, name: newCourier.name, phone: newCourier.phone || '', plate: newCourier.plate || '', commissionRate: Number(newCourier.commissionRate), isActive: newCourier.isActive ?? true };
      try { await saveCourier(courierToSave); if (newCourier.id) setCouriers(prev => prev.map(c => c.id === courierToSave.id ? courierToSave : c)); else setCouriers(prev => [...prev, courierToSave]); setShowCourierModal(false); } catch (e) { alert("Erro ao salvar entregador."); }
  };
  const handleDeleteCourier = async (id: string) => {
      if(confirm('Excluir entregador?')) { try { await deleteCourier(id); setCouriers(prev => prev.filter(c => c.id !== id)); } catch(e) { alert("Erro ao excluir"); } }
  };
  const handleSaveCoupon = async () => {
      if (!editingCoupon.code || !editingCoupon.discountValue) return;
      const couponToSave: Coupon = { id: editingCoupon.id || Date.now().toString(), code: editingCoupon.code.toUpperCase(), discountType: editingCoupon.discountType || 'PERCENTAGE', discountValue: Number(editingCoupon.discountValue), minOrderValue: Number(editingCoupon.minOrderValue) || 0, isActive: editingCoupon.isActive ?? true, description: editingCoupon.description || '', usageCount: editingCoupon.usageCount || 0, usageLimit: editingCoupon.usageLimit ? Number(editingCoupon.usageLimit) : undefined, expiresAt: editingCoupon.expiresAt };
      try { await saveCoupon(couponToSave); if (editingCoupon.id) setCoupons(prev => prev.map(c => c.id === couponToSave.id ? couponToSave : c)); else setCoupons(prev => [...prev, couponToSave]); setShowCouponModal(false); } catch(e) { alert("Erro ao salvar cupom."); }
  };
  const handleDeleteCoupon = async (id: string) => {
      if(confirm("Excluir cupom?")) { try { await deleteCoupon(id); setCoupons(prev => prev.filter(c => c.id !== id)); } catch(e) { alert("Erro ao excluir"); } }
  };
  const handleUpdateStatus = async (orderId: string, status: string) => { try { await updateOrderStatus(orderId, status); } catch (e) { alert("Erro ao atualizar status."); } };

  // --- SALES & DELETION LOGIC ---
  const handleDeleteSale = async () => {
      if (!deleteSaleId) return;
      if (adminPassInput !== storeProfile.adminPassword) {
          alert("Senha administrativa incorreta.");
          return;
      }
      try {
          await deleteOrder(deleteSaleId);
          setDeleteSaleId(null);
          setAdminPassInput('');
      } catch (e) {
          alert("Erro ao excluir venda.");
      }
  };

  // --- SECURITY LOGIC ---
  const handleRequestViewCode = () => {
      if (showAdminPass) {
          setShowAdminPass(false);
          return;
      }
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setVerificationCode(code);
      setIsVerifyingCode(true);
      alert(`Um código de verificação foi enviado para o e-mail da empresa.\n\n(SIMULAÇÃO: O código é ${code})`);
  };

  const handleVerifyCode = () => {
      if (inputCode === verificationCode) {
          setShowAdminPass(true);
          setIsVerifyingCode(false);
          setInputCode('');
          setVerificationCode('');
      } else {
          alert("Código incorreto.");
      }
  };

  // Address Handlers
  const handleCepBlur = async () => {
      const cleanCep = addressForm.cep.replace(/\D/g, '');
      if (cleanCep.length === 8) {
          try { const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`); const data = await response.json(); if (!data.erro) { setAddressForm(prev => ({ ...prev, street: data.logradouro, district: data.bairro, city: data.localidade, state: data.uf })); } else { alert("CEP não encontrado."); } } catch (error) { alert("Erro ao buscar CEP."); }
      }
  };
  const handleGeocodeAddress = async () => {
      if (!addressForm.street || !addressForm.number || !addressForm.city) { alert("Preencha Rua, Número e Cidade para buscar."); return; }
      const query = `${addressForm.street}, ${addressForm.number} - ${addressForm.district}, ${addressForm.city}`;
      try { const results = await searchAddress(query); if (results && results.length > 0) { setStoreProfile(prev => ({ ...prev, coordinates: results[0].coordinates })); alert("Localização atualizada com sucesso no mapa!"); } else { alert("Endereço não encontrado."); } } catch (e) { alert("Erro ao buscar localização."); }
  };
  const handleSaveStoreSettings = async () => {
      if (!storeId || !storeProfile) return;
      try { const payload = { ...storeProfile, ...addressForm, paymentMethods }; await updateStore(storeId, payload); alert("Configurações salvas com sucesso!"); } catch (e) { alert("Erro ao salvar configurações."); }
  };
  const handleTogglePaymentMethod = (id: string) => { setPaymentMethods(prev => prev.map(pm => pm.id === id ? { ...pm, active: !pm.active } : pm)); };

  // --- RENDERERS ---

  // FIX: Logic now checks for explicit blockReason, not just isActive=false
  const renderBlockedScreen = () => (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-red-200 dark:border-red-900/50">
              <div className="bg-red-600 text-white p-8 text-center">
                  <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm"><Lock size={40} /></div>
                  <h1 className="text-2xl font-bold">Acesso Suspenso</h1><p className="text-red-100 mt-2">Sua loja está temporariamente bloqueada.</p>
              </div>
              <div className="p-8">
                  <div className="mb-8"><h2 className="text-sm font-bold text-gray-500 uppercase mb-2 flex items-center gap-2"><AlertTriangle size={16} className="text-red-600"/> Motivo do Bloqueio</h2><p className="text-slate-800 dark:text-white text-lg leading-relaxed">{storeProfile.blockReason || "Entre em contato com o suporte."}</p></div>
                  {storeProfile.isFinancialBlock && (<div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-xl p-6 mb-8"><h3 className="text-red-700 dark:text-red-400 font-bold mb-4 flex items-center gap-2"><Banknote size={20} /> Pendência Financeira</h3><div className="grid grid-cols-2 gap-6"><div><p className="text-xs font-bold text-gray-500 uppercase">Valor</p><p className="text-3xl font-extrabold text-slate-900 dark:text-white">R$ {storeProfile.financialValue?.toFixed(2)}</p></div><div><p className="text-xs font-bold text-gray-500 uppercase">Parcelas</p><p className="text-3xl font-extrabold text-slate-900 dark:text-white">{storeProfile.financialInstallments}x</p></div></div></div>)}
                  <div className="flex gap-4"><button onClick={onBack} className="flex-1 py-4 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Voltar</button><a href="https://wa.me/5538998074444" target="_blank" rel="noreferrer" className="flex-1 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 transition-colors"><MessageSquare size={20} /> Falar com Suporte</a></div>
              </div>
          </div>
      </div>
  );

  const renderOverview = () => (
      <div className="animate-fade-in space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-end gap-4 mb-4">
              <div><h2 className="text-3xl font-bold text-slate-800 dark:text-white tracking-tight">Painel de Controle</h2><p className="text-gray-500 dark:text-gray-400 mt-1">Acompanhe o desempenho do seu negócio em tempo real.</p></div>
              <div className="flex items-center gap-3"><div className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-sm text-sm font-medium text-slate-600 dark:text-gray-300 flex items-center gap-2"><Calendar size={16} className="text-red-600"/> {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                  <div className="w-14 h-14 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center text-green-600"><DollarSign size={28} /></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase">Faturamento Hoje</p><h3 className="text-2xl font-extrabold text-slate-800 dark:text-white">R$ {orders.filter(o => o.status !== 'CANCELLED' && new Date(o.createdAt || '').toDateString() === new Date().toDateString()).reduce((acc, o) => acc + o.total, 0).toFixed(2)}</h3></div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                  <div className="w-14 h-14 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center text-blue-600"><ShoppingBasket size={28} /></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase">Pedidos Hoje</p><h3 className="text-2xl font-extrabold text-slate-800 dark:text-white">{orders.filter(o => new Date(o.createdAt || '').toDateString() === new Date().toDateString()).length}</h3></div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                  <div className="w-14 h-14 bg-purple-50 dark:bg-purple-900/20 rounded-full flex items-center justify-center text-purple-600"><Users size={28} /></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase">Novos Clientes</p><h3 className="text-2xl font-extrabold text-slate-800 dark:text-white">--</h3></div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
                  <div className="w-14 h-14 bg-orange-50 dark:bg-orange-900/20 rounded-full flex items-center justify-center text-orange-600"><AlertTriangle size={28} /></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase">Pendentes</p><h3 className="text-2xl font-extrabold text-slate-800 dark:text-white">{orders.filter(o => o.status === 'PENDING').length}</h3></div>
              </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
                  <h3 className="font-bold text-slate-800 dark:text-white mb-6">Receita Semanal (Real)</h3>
                  <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={weeklyRevenueData}>
                              <defs><linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#EF4444" stopOpacity={0} /></linearGradient></defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF' }} />
                              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9CA3AF' }} tickFormatter={(value) => `R$${value}`} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#fff', border: isDarkMode ? '1px solid #1e293b' : 'none', borderRadius: '8px' }} 
                                itemStyle={{ color: isDarkMode ? '#e2e8f0' : '#1e293b' }}
                                labelStyle={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}
                              />
                              <Area type="monotone" dataKey="value" stroke="#EF4444" strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                          </AreaChart>
                      </ResponsiveContainer>
                  </div>
              </div>
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
                  <h3 className="font-bold text-slate-800 dark:text-white mb-6">Pedidos Recentes</h3>
                  <div className="space-y-4">
                      {orders.length === 0 ? (
                          <p className="text-gray-400 text-center text-sm py-8">Nenhum pedido recente.</p>
                      ) : (
                          orders.slice(0, 5).map(order => (
                              <div key={order.id} className="flex items-center gap-3 pb-3 border-b border-gray-50 last:border-0">
                                  <div className="w-10 h-10 bg-gray-100 dark:bg-slate-800 rounded-lg flex items-center justify-center font-bold text-gray-500 text-xs">#{order.id.slice(0,4)}</div>
                                  <div className="flex-1"><p className="font-bold text-sm text-slate-800 dark:text-white">{order.customerName}</p><p className="text-xs text-gray-400">{order.items.length} itens • {order.time}</p></div>
                                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${order.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' : order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{order.status === 'PENDING' ? 'Novo' : order.status}</span>
                              </div>
                          ))
                      )}
                  </div>
              </div>
          </div>
      </div>
  );

  const renderOrders = () => {
      const columns = [
          { id: 'PENDING', label: 'Novos', color: 'bg-yellow-500' },
          { id: 'PREPARING', label: 'Em Preparo', color: 'bg-blue-500' },
          { id: 'WAITING_COURIER', label: 'Aguardando Motoboy', color: 'bg-purple-500' },
          { id: 'DELIVERING', label: 'Saiu para Entrega', color: 'bg-orange-500' },
          { id: 'COMPLETED', label: 'Concluídos', color: 'bg-green-500' }
      ];

      return (
          <div className="h-[calc(100vh-140px)] flex flex-col">
              <div className="flex justify-between items-center mb-4 px-2">
                  <h3 className="font-bold text-lg text-gray-700 dark:text-gray-300">Quadro de Pedidos</h3>
                  <button 
                    onClick={() => setIsAutoAcceptEnabled(!isAutoAcceptEnabled)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs transition-all shadow-sm ${isAutoAcceptEnabled ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-slate-800 text-gray-500'}`}
                  >
                      {isAutoAcceptEnabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                      {isAutoAcceptEnabled ? 'Auto-Aceitar Ativado' : 'Auto-Aceitar Desativado'}
                  </button>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-6 h-full px-2">
                  {columns.map(col => {
                      const colOrders = orders.filter(o => o.status === col.id);
                      return (
                          <div key={col.id} className="min-w-[300px] w-full max-w-xs flex flex-col bg-gray-100 dark:bg-slate-900 rounded-2xl p-3 h-full border border-gray-200 dark:border-slate-800">
                              <div className={`flex justify-between items-center mb-3 px-2 py-1.5 rounded-lg ${col.color} bg-opacity-10`}>
                                  <h3 className={`font-bold text-sm ${col.id === 'PENDING' ? 'text-yellow-700' : col.id === 'PREPARING' ? 'text-blue-700' : col.id === 'WAITING_COURIER' ? 'text-purple-700' : col.id === 'DELIVERING' ? 'text-orange-700' : 'text-green-700'}`}>{col.label}</h3>
                                  <span className="bg-white dark:bg-slate-800 px-2 py-0.5 rounded text-xs font-bold shadow-sm text-slate-700 dark:text-white">{colOrders.length}</span>
                              </div>
                              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                                  {colOrders.map(order => (
                                      <div key={order.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 hover:shadow-md transition-shadow group relative">
                                          <div className="flex justify-between items-start mb-2">
                                              <span className="font-mono text-xs text-gray-400">#{order.id.slice(0, 5)}</span>
                                              <span className="text-xs font-bold text-slate-600 dark:text-gray-300">{order.time}</span>
                                          </div>
                                          <h4 className="font-bold text-slate-800 dark:text-white mb-1 text-sm">{order.customerName}</h4>
                                          
                                          {/* Updated Items List to Show Full Details (Pizzas) */}
                                          <div className="space-y-2 mb-3 bg-gray-50 dark:bg-slate-900/50 p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                              {order.items.map((item, idx) => (
                                                  <div key={idx} className="flex items-start gap-2">
                                                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 shrink-0"></div>
                                                      <p className="text-xs text-gray-600 dark:text-gray-300 leading-snug">{item}</p>
                                                  </div>
                                              ))}
                                          </div>
                                          
                                          <div className="flex justify-between items-center border-t border-gray-100 dark:border-slate-700 pt-3">
                                              <span className="font-bold text-slate-800 dark:text-white text-sm">R$ {order.total.toFixed(2)}</span>
                                              {col.id !== 'COMPLETED' && col.id !== 'DELIVERING' && col.id !== 'WAITING_COURIER' && (
                                                  <button 
                                                    onClick={() => handleUpdateStatus(order.id, col.id === 'PENDING' ? 'PREPARING' : 'WAITING_COURIER')}
                                                    className="px-3 py-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity"
                                                  >
                                                      {col.id === 'PENDING' ? 'Aceitar' : 'Chamar Motoboy'}
                                                  </button>
                                              )}
                                              {col.id === 'WAITING_COURIER' && (
                                                  <span className="text-xs font-bold text-purple-600 animate-pulse">Aguardando...</span>
                                              )}
                                              {col.id === 'DELIVERING' && (
                                                  <button onClick={() => handleUpdateStatus(order.id, 'COMPLETED')} className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700">
                                                      Concluir
                                                  </button>
                                              )}
                                          </div>
                                          {order.status === 'PENDING' && (
                                              <button onClick={() => handleUpdateStatus(order.id, 'CANCELLED')} className="absolute top-2 right-2 p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><X size={16} /></button>
                                          )}
                                      </div>
                                  ))}
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };

  const renderMenu = () => {
      const categories = Array.from(new Set(products.map(p => p.category)));
      const filteredProducts = products.filter(p => 
          (selectedCategoryTab === 'Todos' || p.category === selectedCategoryTab) &&
          p.name.toLowerCase().includes(menuSearch.toLowerCase())
      );

      return (
          <div className="animate-fade-in">
              <div className="flex justify-between items-center mb-6">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                      <button onClick={() => setSelectedCategoryTab('Todos')} className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${selectedCategoryTab === 'Todos' ? 'bg-red-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>Todos</button>
                      {categories.map(cat => (
                          <button key={cat} onClick={() => setSelectedCategoryTab(cat)} className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${selectedCategoryTab === cat ? 'bg-red-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700'}`}>{cat}</button>
                      ))}
                  </div>
                  <div className="flex gap-2">
                      <button onClick={() => { setNewProduct({ isAvailable: true }); setShowProductModal(true); }} className="bg-white dark:bg-slate-800 text-gray-600 dark:text-white border border-gray-200 dark:border-slate-700 px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"><Plus size={18} /> Novo Item</button>
                      <button onClick={() => { setNewFlavor({}); setShowFlavorModal(true); }} className="bg-orange-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/20"><Database size={18} /> Sabores de Pizza</button>
                  </div>
              </div>

              <div className="mb-6 relative">
                  <input 
                    type="text" 
                    placeholder="Buscar item no cardápio..." 
                    value={menuSearch} 
                    onChange={(e) => setMenuSearch(e.target.value)} 
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-slate-800 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 outline-none" 
                  />
                  <Search className="absolute left-3 top-3.5 text-gray-400" size={20} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredProducts.map(product => (
                      <div key={product.id} className={`bg-white dark:bg-slate-900 rounded-xl p-4 border flex gap-4 group hover:shadow-lg transition-all ${product.isAvailable ? 'border-gray-200 dark:border-slate-800 hover:border-red-200 dark:hover:border-red-900/50' : 'border-gray-300 dark:border-slate-700 opacity-70 bg-gray-50 dark:bg-slate-950'}`}>
                          <div className="w-28 h-28 bg-gray-100 dark:bg-slate-800 rounded-lg overflow-hidden flex-shrink-0 relative">
                              {product.imageUrl ? <img src={product.imageUrl} alt={product.name} className={`w-full h-full object-cover ${!product.isAvailable ? 'grayscale' : ''}`} /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><UtensilsCrossed /></div>}
                              {product.isPizza && (
                                  <span className="absolute top-1 right-1 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-sm">Pizza</span>
                              )}
                              {!product.isAvailable && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 font-bold text-white text-xs uppercase">Inativo</div>
                              )}
                          </div>
                          <div className="flex-1 flex flex-col">
                              <div className="flex justify-between items-start">
                                  <h4 className="font-bold text-slate-800 dark:text-white line-clamp-1 text-base">{product.name}</h4>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={() => { setNewProduct(product); setShowProductModal(true); }} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"><Edit size={16} /></button>
                                      <button onClick={() => handleDeleteProduct(product.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash size={16} /></button>
                                  </div>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1 mb-auto">{product.description}</p>
                              <div className="flex justify-between items-end mt-3 pt-3 border-t border-gray-50 dark:border-slate-800">
                                  <div className="flex flex-col">
                                      {product.promoPrice ? (
                                          <>
                                              <span className="text-xs text-gray-400 line-through">R$ {product.price.toFixed(2)}</span>
                                              <span className="font-bold text-green-600">R$ {product.promoPrice.toFixed(2)}</span>
                                          </>
                                      ) : (
                                          <span className="font-bold text-slate-800 dark:text-white">R$ {product.price.toFixed(2)}</span>
                                      )}
                                  </div>
                                  <label className="flex items-center cursor-pointer" title={product.isAvailable ? 'Disponível' : 'Indisponível'}>
                                      <input type="checkbox" checked={product.isAvailable} onChange={() => saveProduct({...product, isAvailable: !product.isAvailable})} className="sr-only peer" />
                                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                                  </label>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      );
  };

  // ... (renderCoupons, renderCouriers, renderFinance, renderExpenses, renderSales, renderSettings remain same) ...
  const renderCoupons = () => (
      <div className="animate-fade-in">
           <div className="flex justify-between items-center mb-6">
               <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Cupons de Desconto</h2>
               <button onClick={() => { setEditingCoupon({}); setShowCouponModal(true); }} className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-700"><Plus size={18} /> Criar Cupom</button>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {coupons.map(coupon => (
                   <div key={coupon.id} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-dashed border-gray-300 dark:border-slate-700 relative overflow-hidden group">
                       <div className="absolute -right-6 -top-6 bg-red-50 dark:bg-red-900/20 w-24 h-24 rounded-full flex items-end justify-start p-4"><Ticket className="text-red-200 dark:text-red-800" size={40} /></div>
                       <div className="relative z-10">
                           <h3 className="text-2xl font-black text-slate-800 dark:text-white tracking-widest mb-1">{coupon.code}</h3>
                           <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{coupon.description || 'Sem descrição'}</p>
                           <div className="flex items-center gap-2 mb-4">
                               <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">{coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}% OFF` : `R$ ${coupon.discountValue} OFF`}</span>
                               {coupon.minOrderValue > 0 && <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold">Mín. R$ {coupon.minOrderValue}</span>}
                           </div>
                           <div className="flex justify-between items-center pt-4 border-t border-gray-100 dark:border-slate-800">
                               <div className="text-xs text-gray-400">Usos: {coupon.usageCount} {coupon.usageLimit ? `/ ${coupon.usageLimit}` : ''}</div>
                               <div className="flex gap-2">
                                   <button onClick={() => { setEditingCoupon(coupon); setShowCouponModal(true); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"><Edit size={16}/></button>
                                   <button onClick={() => handleDeleteCoupon(coupon.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                               </div>
                           </div>
                       </div>
                   </div>
               ))}
           </div>
      </div>
  );

  const renderCouriers = () => (
      <div className="animate-fade-in">
          <div className="flex justify-between items-center mb-6">
              <div><h2 className="text-2xl font-bold text-slate-800 dark:text-white">Entregadores</h2><p className="text-gray-500">Gerencie sua frota própria.</p></div>
              <button onClick={() => { setNewCourier({ commissionRate: 10, isActive: true }); setShowCourierModal(true); }} className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-700"><Plus size={18} /> Novo Entregador</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {couriers.map(courier => (
                  <div key={courier.id} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex flex-col items-center text-center relative group">
                      <button onClick={() => handleDeleteCourier(courier.id)} className="absolute top-4 right-4 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={18}/></button>
                      <div className="w-20 h-20 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4 text-gray-400"><Bike size={32} /></div>
                      <h3 className="font-bold text-lg text-slate-800 dark:text-white">{courier.name}</h3>
                      <p className="text-sm text-gray-500 mb-1">{courier.phone}</p>
                      <p className="text-xs text-gray-400 uppercase tracking-wider font-bold mb-4">{courier.plate || 'Sem placa'}</p>
                      <div className="w-full grid grid-cols-2 gap-2 border-t border-gray-100 dark:border-slate-800 pt-4">
                          <div><p className="text-xs text-gray-400">Comissão</p><p className="font-bold text-slate-800 dark:text-white">{courier.commissionRate}%</p></div>
                          <div><p className="text-xs text-gray-400">Status</p><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${courier.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{courier.isActive ? 'Ativo' : 'Inativo'}</span></div>
                      </div>
                  </div>
              ))}
          </div>
      </div>
  );

  const renderFinance = () => {
      // Dados calculados no hook useMemo (financialSummary)
      const { totalRevenue, totalExpenses, netProfit, orderSales, manualIncome } = financialSummary;

      const barData = [
          { name: 'Entradas', value: totalRevenue },
          { name: 'Saídas', value: totalExpenses },
      ];

      return (
          <div className="animate-fade-in">
               <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">Painel Financeiro</h2>
               
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                   <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
                       <p className="text-sm font-bold text-gray-500 uppercase mb-2">Receita Total</p>
                       <h3 className="text-3xl font-extrabold text-green-600">R$ {totalRevenue.toFixed(2)}</h3>
                       <div className="mt-2 text-xs text-gray-400">
                           Vendas: R$ {orderSales.toFixed(2)} | Outros: R$ {manualIncome.toFixed(2)}
                       </div>
                   </div>
                   <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
                       <p className="text-sm font-bold text-gray-500 uppercase mb-2">Despesas</p>
                       <h3 className="text-3xl font-extrabold text-red-600">R$ {totalExpenses.toFixed(2)}</h3>
                       <p className="text-xs text-gray-400 mt-2">Total de saídas registradas</p>
                   </div>
                   <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
                       <p className="text-sm font-bold text-gray-500 uppercase mb-2">Lucro Líquido</p>
                       <h3 className={`text-3xl font-extrabold ${netProfit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>R$ {netProfit.toFixed(2)}</h3>
                       <p className="text-xs text-gray-400 mt-2">Saldo final</p>
                   </div>
               </div>

               <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm h-80">
                   <h3 className="font-bold text-slate-800 dark:text-white mb-6">Balanço Geral</h3>
                   <ResponsiveContainer width="100%" height="100%">
                       <BarChart data={barData}>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                           <XAxis dataKey="name" axisLine={false} tickLine={false} />
                           <YAxis axisLine={false} tickLine={false} />
                           <Tooltip 
                                cursor={{fill: 'transparent'}}
                                contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#fff', border: isDarkMode ? '1px solid #1e293b' : 'none', borderRadius: '8px' }} 
                           />
                           <Bar dataKey="value" fill="#3B82F6" radius={[4, 4, 0, 0]}>
                               {barData.map((entry, index) => (
                                   <Cell key={`cell-${index}`} fill={entry.name === 'Entradas' ? '#10B981' : '#EF4444'} />
                               ))}
                           </Bar>
                       </BarChart>
                   </ResponsiveContainer>
               </div>
          </div>
      );
  };

  const renderExpenses = () => (
      <div className="animate-fade-in">
          <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Fluxo de Caixa (Entradas/Saídas)</h2>
              <button onClick={() => { setNewTransaction({ type: 'EXPENSE', date: new Date().toISOString().split('T')[0], status: 'PAID', category: 'OUTROS_SAIDA' }); setShowTransactionModal(true); }} className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-700"><Plus size={18} /> Nova Movimentação</button>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-slate-800 text-left">
                      <tr><th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Data</th><th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Descrição</th><th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Categoria</th><th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Valor</th><th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">Ações</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {transactions.map(t => (
                          <tr key={t.id}>
                              <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">{new Date(t.date).toLocaleDateString()}</td>
                              <td className="px-6 py-4 font-bold text-slate-800 dark:text-white">{t.description}</td>
                              <td className="px-6 py-4 text-sm text-gray-500">{TRANSACTION_CATEGORIES.find(c => c.id === t.category)?.label || t.category}</td>
                              <td className={`px-6 py-4 font-bold ${t.type === 'INCOME' ? 'text-green-600' : 'text-red-600'}`}>{t.type === 'INCOME' ? '+' : '-'} R$ {t.amount.toFixed(2)}</td>
                              <td className="px-6 py-4"><button onClick={() => { if(confirm('Excluir?')) deleteExpense(t.id); }} className="text-gray-400 hover:text-red-600"><Trash2 size={16}/></button></td>
                          </tr>
                      ))}
                      {transactions.length === 0 && (
                          <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-400">Nenhuma movimentação registrada.</td></tr>
                      )}
                  </tbody>
              </table>
          </div>
      </div>
  );

  const renderSales = () => {
      const filteredOrders = orders.filter(o => {
          const statusMatch = salesFilterStatus === 'ALL' ? true : 
                              salesFilterStatus === 'COMPLETED' ? o.status === 'COMPLETED' :
                              salesFilterStatus === 'CANCELLED' ? o.status === 'CANCELLED' : false;
          
          const dateMatch = !salesFilterDate || new Date(o.createdAt || '').toLocaleDateString('en-CA') === salesFilterDate;
          return statusMatch && dateMatch;
      });

      return (
          <div className="animate-fade-in">
              <div className="flex justify-between items-center mb-6">
                  <div>
                      <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Gestão de Vendas</h2>
                      <p className="text-gray-500">Histórico completo de todos os pedidos.</p>
                  </div>
              </div>

              {/* Filters */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-slate-800 mb-6 flex flex-wrap gap-4 items-center">
                  <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-500">Filtrar por:</span>
                      <select 
                        value={salesFilterStatus} 
                        onChange={(e) => setSalesFilterStatus(e.target.value)}
                        className="bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold outline-none dark:text-white"
                      >
                          <option value="ALL">Todos os Status</option>
                          <option value="COMPLETED">Concluídos</option>
                          <option value="CANCELLED">Cancelados</option>
                      </select>
                  </div>
                  <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-500">Data:</span>
                      <input 
                        type="date" 
                        value={salesFilterDate}
                        onChange={(e) => setSalesFilterDate(e.target.value)}
                        className="bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none dark:text-white"
                        style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                      />
                      {salesFilterDate && (
                          <button onClick={() => setSalesFilterDate('')} className="text-red-500 hover:text-red-700"><X size={16}/></button>
                      )}
                  </div>
              </div>

              {/* Sales Table */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                      <table className="w-full">
                          <thead className="bg-gray-50 dark:bg-slate-800 text-left">
                              <tr>
                                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Pedido</th>
                                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Cliente</th>
                                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Data</th>
                                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Pagamento</th>
                                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Total</th>
                                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                  <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Ações</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                              {filteredOrders.map(order => (
                                  <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                      <td className="px-6 py-4 font-mono text-sm text-gray-600 dark:text-gray-400">#{order.id.slice(0,5)}</td>
                                      <td className="px-6 py-4 font-bold text-slate-800 dark:text-white text-sm">{order.customerName}</td>
                                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                                          {new Date(order.createdAt || '').toLocaleString()}
                                      </td>
                                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{order.paymentMethod}</td>
                                      <td className="px-6 py-4 font-bold text-slate-800 dark:text-white text-sm">R$ {order.total.toFixed(2)}</td>
                                      <td className="px-6 py-4">
                                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                                              order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 
                                              order.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                                          }`}>
                                              {order.status}
                                          </span>
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                          <button 
                                            onClick={() => setDeleteSaleId(order.id)}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="Excluir Venda"
                                          >
                                              <Trash2 size={18} />
                                          </button>
                                      </td>
                                  </tr>
                              ))}
                              {filteredOrders.length === 0 && (
                                  <tr>
                                      <td colSpan={7} className="px-6 py-12 text-center text-gray-400">Nenhuma venda encontrada com os filtros atuais.</td>
                                  </tr>
                              )}
                          </tbody>
                      </table>
                  </div>
              </div>

              {/* Delete Sale Modal */}
              {deleteSaleId && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl p-6 animate-scale-in border border-red-100 dark:border-red-900/50">
                          <div className="flex items-center gap-3 text-red-600 mb-4">
                              <ShieldAlert size={28} />
                              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Excluir Venda</h3>
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                              Esta ação removerá permanentemente o registro da venda. Para confirmar, insira a <strong>Senha Administrativa</strong>.
                          </p>
                          
                          <div className="mb-6">
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Senha Admin</label>
                              <input 
                                  type="password" 
                                  value={adminPassInput}
                                  onChange={(e) => setAdminPassInput(e.target.value)}
                                  className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 dark:bg-slate-800 dark:text-white"
                                  placeholder="Digite a senha..."
                              />
                          </div>

                          <div className="flex gap-3">
                              <button 
                                onClick={() => { setDeleteSaleId(null); setAdminPassInput(''); }}
                                className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl"
                              >
                                  Cancelar
                              </button>
                              <button 
                                onClick={handleDeleteSale}
                                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg"
                              >
                                  Confirmar Exclusão
                              </button>
                          </div>
                      </div>
                  </div>
              )}
          </div>
      );
  };

  const renderSettings = () => (
      <div className="animate-fade-in">
           <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">Configurações da Loja</h2>
           
           <div className="flex flex-wrap border-b border-gray-200 dark:border-slate-800 mb-6">
               {[
                   {id: 'STORE', label: 'Dados da Loja', icon: Store},
                   {id: 'ADDRESS', label: 'Endereço & Contato', icon: MapPin},
                   {id: 'DELIVERY', label: 'Entrega', icon: Bike},
                   {id: 'SCHEDULE', label: 'Horários', icon: Clock},
                   {id: 'PAYMENTS', label: 'Pagamento', icon: Wallet},
                   {id: 'SECURITY', label: 'Segurança', icon: ShieldCheck}, 
               ].map(tab => (
                   <button key={tab.id} onClick={() => setSettingsTab(tab.id as any)} className={`flex items-center gap-2 px-6 py-3 text-sm font-bold border-b-2 transition-colors ${settingsTab === tab.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                       <tab.icon size={16}/> {tab.label}
                   </button>
               ))}
           </div>

           {/* ... (Settings content remains same) ... */}
           <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm">
               {settingsTab === 'STORE' && (
                   <div className="grid md:grid-cols-2 gap-8">
                       <div className="space-y-4">
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Estabelecimento</label>
                               <input type="text" value={storeProfile.name} onChange={(e) => setStoreProfile({...storeProfile, name: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição / Bio</label>
                               <textarea value={storeProfile.description} onChange={(e) => setStoreProfile({...storeProfile, description: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" rows={3} />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoria Principal</label>
                               <input type="text" value={storeProfile.category} onChange={(e) => setStoreProfile({...storeProfile, category: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
                           </div>
                       </div>
                       <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Logo / Imagem de Capa</label>
                           <div 
                               onClick={() => storeLogoInputRef.current?.click()}
                               className="w-full h-48 rounded-xl border-2 border-dashed border-gray-300 dark:border-slate-700 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:border-red-500 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-all relative overflow-hidden"
                           >
                               {storeProfile.imageUrl ? <img src={storeProfile.imageUrl} alt="Store" className="w-full h-full object-cover absolute" /> : <><UploadCloud size={32} className="mb-2" /><span>Clique para enviar imagem</span></>}
                           </div>
                           <input type="file" ref={storeLogoInputRef} className="hidden" onChange={(e) => handleFileUpload(e, 'STORE')} accept="image/*" />
                       </div>
                   </div>
               )}

               {settingsTab === 'ADDRESS' && (
                   <div className="grid md:grid-cols-2 gap-6">
                       <div className="md:col-span-2 flex items-end gap-2">
                           <div className="flex-1">
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                               <input type="text" value={addressForm.cep} onChange={(e) => setAddressForm({...addressForm, cep: e.target.value})} onBlur={handleCepBlur} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" maxLength={9} placeholder="00000-000" />
                           </div>
                           <div className="flex-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cidade</label><input type="text" value={addressForm.city} onChange={(e) => setAddressForm({...addressForm, city: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                           <button onClick={handleGeocodeAddress} className="bg-red-100 text-red-600 p-3 rounded-lg font-bold hover:bg-red-200" title="Atualizar Local no Mapa"><MapPin size={20} /></button>
                       </div>
                       <div className="md:col-span-2"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rua / Logradouro</label><input type="text" value={addressForm.street} onChange={(e) => setAddressForm({...addressForm, street: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                       <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número</label><input type="text" value={addressForm.number} onChange={(e) => setAddressForm({...addressForm, number: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                       <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Bairro</label><input type="text" value={addressForm.district} onChange={(e) => setAddressForm({...addressForm, district: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                       <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone / WhatsApp</label><input type="text" value={addressForm.phone} onChange={(e) => setAddressForm({...addressForm, phone: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                   </div>
               )}

               {settingsTab === 'DELIVERY' && (
                   <div className="space-y-6">
                       <div className="grid grid-cols-2 gap-6">
                           <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tempo Médio (min)</label><input type="text" value={storeProfile.deliveryTime} onChange={(e) => setStoreProfile({...storeProfile, deliveryTime: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Ex: 40-50 min" /></div>
                           <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Taxa de Entrega (R$)</label><input type="number" value={storeProfile.deliveryFee} onChange={(e) => setStoreProfile({...storeProfile, deliveryFee: parseFloat(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                       </div>
                       <div className="flex items-center gap-4">
                           <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700"><input type="checkbox" checked={storeProfile.acceptsDelivery} onChange={(e) => setStoreProfile({...storeProfile, acceptsDelivery: e.target.checked})} className="w-5 h-5 accent-red-600" /><span className="font-bold text-slate-700 dark:text-white">Aceita Delivery</span></label>
                           <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700"><input type="checkbox" checked={storeProfile.acceptsPickup} onChange={(e) => setStoreProfile({...storeProfile, acceptsPickup: e.target.checked})} className="w-5 h-5 accent-red-600" /><span className="font-bold text-slate-700 dark:text-white">Aceita Retirada</span></label>
                       </div>
                   </div>
               )}

               {settingsTab === 'SCHEDULE' && (
                   <div className="space-y-3">
                       {storeProfile.schedule?.map((day, idx) => (
                           <div key={idx} className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                               <div className="w-24 font-bold text-slate-700 dark:text-white">{day.day}</div>
                               <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={day.isOpen} onChange={(e) => { const newSched = [...(storeProfile.schedule || [])]; newSched[idx].isOpen = e.target.checked; setStoreProfile({...storeProfile, schedule: newSched}); }} className="sr-only peer" /><div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div></label>
                               <div className="flex items-center gap-2">
                                   <input type="time" value={day.openTime} onChange={(e) => { const newSched = [...(storeProfile.schedule || [])]; newSched[idx].openTime = e.target.value; setStoreProfile({...storeProfile, schedule: newSched}); }} className="p-1 border rounded text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white" style={{ colorScheme: isDarkMode ? 'dark' : 'light' }} disabled={!day.isOpen} />
                                   <span className="text-gray-400">-</span>
                                   <input type="time" value={day.closeTime} onChange={(e) => { const newSched = [...(storeProfile.schedule || [])]; newSched[idx].closeTime = e.target.value; setStoreProfile({...storeProfile, schedule: newSched}); }} className="p-1 border rounded text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white" style={{ colorScheme: isDarkMode ? 'dark' : 'light' }} disabled={!day.isOpen} />
                               </div>
                           </div>
                       ))}
                   </div>
               )}

               {settingsTab === 'PAYMENTS' && (
                   <div className="space-y-4">
                       <p className="text-sm text-gray-500 mb-4">Selecione os métodos de pagamento aceitos na entrega ou retirada.</p>
                       <div className="grid md:grid-cols-2 gap-4">
                           {paymentMethods.map(pm => (
                               <div key={pm.id} onClick={() => handleTogglePaymentMethod(pm.id)} className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${pm.active ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 hover:border-gray-300 dark:bg-slate-800 dark:border-slate-700'}`}>
                                   <span className={`font-bold ${pm.active ? 'text-green-700' : 'text-gray-500 dark:text-gray-400'}`}>{pm.name}</span>
                                   <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${pm.active ? 'bg-green-600 border-green-600' : 'bg-white border-gray-300'}`}>{pm.active && <Check size={14} className="text-white" />}</div>
                               </div>
                           ))}
                       </div>
                       <div className="mt-6 pt-6 border-t border-gray-100 dark:border-slate-800">
                          <label className="flex items-center gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer bg-blue-50 dark:bg-blue-900/20">
                              <input type="checkbox" checked={storeProfile.acceptsCardOnDelivery} onChange={(e) => setStoreProfile({...storeProfile, acceptsCardOnDelivery: e.target.checked})} className="w-5 h-5 accent-blue-600" />
                              <div>
                                  <span className="font-bold text-blue-800 dark:text-blue-300 block">Aceitar Cartão na Entrega (Maquininha)</span>
                                  <span className="text-xs text-blue-600 dark:text-blue-400">Permite que o cliente escolha pagar com cartão físico ao receber o pedido.</span>
                              </div>
                          </label>
                       </div>
                   </div>
               )}

               {settingsTab === 'SECURITY' && (
                   <div className="max-w-2xl animate-fade-in">
                       <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                           <Lock size={20} className="text-red-600" /> Senha Administrativa
                       </h3>
                        <div className="bg-gray-50 dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Senha Atual</label>
                           <div className="flex gap-2 mb-4">
                               <div className="relative flex-1">
                                   <input 
                                       type={showAdminPass ? "text" : "password"} 
                                       value={storeProfile.adminPassword || ''} 
                                       onChange={(e) => setStoreProfile({...storeProfile, adminPassword: e.target.value})}
                                       className="w-full p-3 pr-12 border rounded-lg dark:bg-slate-900 dark:border-slate-600 dark:text-white font-mono"
                                       placeholder="Não definida"
                                       readOnly={!showAdminPass} 
                                   />
                                   <button 
                                       onClick={handleRequestViewCode}
                                       className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-slate-600"
                                       title={showAdminPass ? "Ocultar" : "Visualizar"}
                                   >
                                       {showAdminPass ? <EyeOff size={18} /> : <Eye size={18} />}
                                   </button>
                               </div>
                           </div>

                           {isVerifyingCode && (
                               <div className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-blue-200 dark:border-blue-800 animate-slide-up">
                                   <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-2">
                                       <Mail size={14} /> Código enviado para o e-mail!
                                   </p>
                                   <div className="flex gap-2">
                                       <input 
                                           type="text" 
                                           value={inputCode}
                                           onChange={(e) => setInputCode(e.target.value)}
                                           placeholder="Digite o código"
                                           className="flex-1 p-2 border rounded text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                                       />
                                       <button 
                                           onClick={handleVerifyCode}
                                           className="bg-blue-600 text-white px-4 py-2 rounded font-bold text-sm hover:bg-blue-700"
                                       >
                                           Verificar
                                       </button>
                                   </div>
                               </div>
                           )}

                           {!showAdminPass && !isVerifyingCode && (
                               <p className="text-xs text-orange-600 flex items-center gap-1">
                                   <AlertTriangle size={12} /> Para visualizar ou alterar, clique no olho e confirme o código enviado por e-mail.
                               </p>
                           )}
                       </div>
                   </div>
               )}

               <div className="mt-8 pt-6 border-t border-gray-100 dark:border-slate-800 flex justify-end">
                   <button onClick={handleSaveStoreSettings} className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-600/20 flex items-center gap-2"><Save size={20}/> Salvar Alterações</button>
               </div>
           </div>
      </div>
  );

  // --- MAIN RENDER LOGIC ---

  // Only block if there's a reason, NOT just because it's closed (isActive=false)
  if (!loading && storeProfile.blockReason && userRole !== 'ADMIN') {
      return renderBlockedScreen();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex font-sans transition-colors duration-300">
      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 z-50 flex flex-col transition-transform duration-300 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
            <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-red-500/30">
                    <LayoutDashboard size={18} />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">MenuFaz</h2>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Gestor</p>
                </div>
            </div>
            <div className="flex-1 py-6 px-3 overflow-y-auto">
                <p className="px-4 text-xs font-bold text-gray-400 mb-4 uppercase">Painel</p>
                {[
                    { id: 'OVERVIEW', icon: Activity, label: 'Visão Geral' },
                    { id: 'ORDERS', icon: ClipboardList, label: 'Pedidos', count: orders.filter(o => o.status === 'PENDING').length },
                    { id: 'SALES', icon: Receipt, label: 'Vendas' }, 
                    { id: 'FINANCE', icon: DollarSign, label: 'Financeiro' }, 
                    { id: 'EXPENSES', icon: Wallet, label: 'Retirada / Entrada' }, 
                    { id: 'MENU', icon: UtensilsCrossed, label: 'Cardápio' },
                    { id: 'COUPONS', icon: Ticket, label: 'Cupons' },
                    { id: 'COURIERS', icon: Bike, label: 'Entregadores' },
                    { id: 'SETTINGS', icon: Settings, label: 'Configurações' }
                ].map((item) => (
                    <button 
                        key={item.id}
                        onClick={() => { setActiveSection(item.id as DashboardSection); setIsMobileMenuOpen(false); }}
                        className={`w-full flex items-center justify-between px-4 py-3 mb-1 rounded-xl transition-all font-medium ${activeSection === item.id ? 'bg-red-600 text-white shadow-lg shadow-red-200 dark:shadow-none' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`}
                    >
                        <div className="flex items-center gap-3">
                            <item.icon size={20} />
                            <span>{item.label}</span>
                        </div>
                        {item.count ? <span className="bg-white text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">{item.count}</span> : null}
                    </button>
                ))}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-slate-800">
                <button onClick={onBack} className="w-full flex items-center gap-2 text-gray-500 hover:text-red-600 px-4 py-2 rounded-lg transition-colors text-sm font-medium">
                    <LogOut size={16} /> {userRole === 'ADMIN' ? 'Voltar Admin' : 'Sair'}
                </button>
            </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {/* Header */}
          <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 h-16 px-8 flex items-center justify-between sticky top-0 z-30 shadow-sm">
              <div className="flex items-center gap-4">
                  <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden text-slate-600"><Menu /></button>
                  <h1 className="text-xl font-bold text-slate-800 dark:text-white hidden sm:block">
                      {activeSection === 'OVERVIEW' ? 'Painel de Controle' : 
                       activeSection === 'ORDERS' ? 'Gestão de Pedidos' : 
                       activeSection === 'MENU' ? 'Cardápio Digital' : 
                       activeSection === 'COUPONS' ? 'Cupons' :
                       activeSection === 'COURIERS' ? 'Frota de Entregas' :
                       activeSection === 'FINANCE' ? 'Financeiro' :
                       activeSection === 'EXPENSES' ? 'Retirada / Entrada' :
                       activeSection === 'SALES' ? 'Relatório de Vendas' :
                       activeSection === 'SETTINGS' ? 'Configurações' : activeSection}
                  </h1>
              </div>
              <div className="flex items-center gap-4">
                  <button onClick={toggleTheme} className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                      {isDarkMode ? <Banknote size={20} /> : <Banknote size={20} />}
                  </button>
                  
                  <div className={`px-3 py-1 rounded-full border text-xs font-bold flex items-center gap-2 ${storeProfile.isActive ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${storeProfile.isActive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                      {storeProfile.isActive ? 'LOJA ABERTA' : 'LOJA FECHADA'}
                  </div>
                  <button onClick={handleToggleOpenStore} className="text-xs underline text-gray-500 hover:text-slate-800 dark:hover:text-white">(Toggle)</button>
              </div>
          </header>

          <main className="p-4 sm:p-8 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-slate-700 bg-gray-50 dark:bg-slate-950">
              {activeSection === 'OVERVIEW' && renderOverview()}
              {activeSection === 'SETTINGS' && renderSettings()}
              {activeSection === 'MENU' && renderMenu()}
              {activeSection === 'ORDERS' && renderOrders()}
              {activeSection === 'COUPONS' && renderCoupons()}
              {activeSection === 'COURIERS' && renderCouriers()}
              {activeSection === 'FINANCE' && renderFinance()}
              {activeSection === 'EXPENSES' && renderExpenses()}
              {activeSection === 'SALES' && renderSales()}
          </main>
      </div>

      {/* PRODUCT MODAL */}
      {showProductModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-scale-in">
                  <div className="p-6 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-white">{newProduct.id ? 'Editar Produto' : 'Novo Produto'}</h3>
                      <label className="flex items-center cursor-pointer gap-2 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm">
                          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Status</span>
                          <div className="relative">
                              <input 
                                  type="checkbox" 
                                  className="sr-only peer" 
                                  checked={newProduct.isAvailable !== false} 
                                  onChange={(e) => setNewProduct({ ...newProduct, isAvailable: e.target.checked })}
                              />
                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                          </div>
                          <span className={`text-xs font-bold ${newProduct.isAvailable !== false ? 'text-green-600' : 'text-gray-400'}`}>
                              {newProduct.isAvailable !== false ? 'Ativo' : 'Inativo'}
                          </span>
                      </label>
                      <button onClick={() => setShowProductModal(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors"><X size={20} /></button>
                  </div>
                  <div className="p-8 overflow-y-auto">
                      {/* Basic Info */}
                      <div className="grid md:grid-cols-2 gap-8 mb-8">
                          <div className="flex flex-col gap-4">
                              {/* Image Uploader */}
                              <div 
                                  onClick={() => productInfoInputRef.current?.click()}
                                  className="aspect-square rounded-xl border-2 border-dashed border-gray-300 dark:border-slate-700 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:border-red-500 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-all relative overflow-hidden bg-gray-50 dark:bg-slate-800"
                              >
                                  {newProduct.imageUrl ? <img src={newProduct.imageUrl} alt="Product" className="w-full h-full object-cover absolute" /> : <><ImageIcon size={40} className="mb-2" /><span>Enviar Imagem</span></>}
                              </div>
                              <input type="file" ref={productInfoInputRef} className="hidden" onChange={(e) => handleFileUpload(e, 'PRODUCT')} accept="image/*" />

                              {newProduct.isPizza && (
                                  <div className="bg-orange-50 dark:bg-orange-900/10 p-4 rounded-xl border border-orange-200 dark:border-orange-800 flex flex-col items-center justify-center animate-fade-in">
                                      <p className="text-xs font-bold text-orange-700 dark:text-orange-400 mb-2 uppercase">Pré-visualização da Divisão</p>
                                      <div className="w-32 h-32">
                                          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-md">
                                              <circle cx="50" cy="50" r="48" fill="white" stroke="#333" strokeWidth="2" />
                                              {(newProduct.maxFlavors || 1) >= 2 && (
                                                  <line x1="50" y1="2" x2="50" y2="98" stroke="#333" strokeWidth="2" />
                                              )}
                                              {(newProduct.maxFlavors || 1) === 3 && (
                                                  <>
                                                      <circle cx="50" cy="50" r="48" fill="white" stroke="#333" strokeWidth="2" />
                                                      <line x1="50" y1="50" x2="50" y2="2" stroke="#333" strokeWidth="2" />
                                                      <line x1="50" y1="50" x2="91.5" y2="74" stroke="#333" strokeWidth="2" />
                                                      <line x1="50" y1="50" x2="8.5" y2="74" stroke="#333" strokeWidth="2" />
                                                  </>
                                              )}
                                              {(newProduct.maxFlavors || 1) === 4 && (
                                                  <line x1="2" y1="50" x2="98" y2="50" stroke="#333" strokeWidth="2" />
                                              )}
                                              <circle cx="50" cy="50" r="42" fill="none" stroke="#ddd" strokeWidth="1" strokeDasharray="4 2" />
                                          </svg>
                                      </div>
                                      <p className="text-[10px] text-orange-600 mt-2 text-center">
                                          {(newProduct.maxFlavors || 1) === 1 ? "Pizza Inteira (1 Sabor)" : `${newProduct.maxFlavors} Fatias de Sabores`}
                                      </p>
                                  </div>
                              )}
                          </div>
                          
                          <div className="space-y-4">
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Produto</label>
                                <input type="text" value={newProduct.name || ''} onChange={(e) => setNewProduct({...newProduct, name: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Ex: X-Bacon" />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label>
                                <textarea value={newProduct.description || ''} onChange={(e) => setNewProduct({...newProduct, description: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" rows={3} placeholder="Ingredientes, detalhes..." />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Preço (R$)</label><input type="number" value={newProduct.price || ''} onChange={(e) => setNewProduct({...newProduct, price: parseFloat(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold" placeholder="0.00" /></div>
                                  <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Preço Promo (Opcional)</label><input type="number" value={newProduct.promoPrice || ''} onChange={(e) => setNewProduct({...newProduct, promoPrice: parseFloat(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white border-green-200" placeholder="0.00" /></div>
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoria</label>
                                <input type="text" value={newProduct.category || ''} onChange={(e) => setNewProduct({...newProduct, category: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Ex: Lanches" />
                              </div>
                              
                              <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer bg-gray-50 dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                                  <input 
                                    type="checkbox" 
                                    checked={newProduct.isPizza || false} 
                                    onChange={(e) => setNewProduct({ ...newProduct, isPizza: e.target.checked, maxFlavors: e.target.checked ? (newProduct.maxFlavors || 2) : 1 })}
                                    className="w-5 h-5 accent-orange-500 rounded"
                                  />
                                  <div className="flex flex-col">
                                      <span className="font-bold text-sm text-slate-800 dark:text-white flex items-center gap-2"><Slice size={16} className="text-orange-500"/> É Pizza?</span>
                                      <span className="text-xs text-gray-500 dark:text-gray-400">Habilita opções de meio a meio e bordas.</span>
                                  </div>
                              </label>

                              {newProduct.isPizza && (
                                  <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-xl border border-orange-200 dark:border-orange-800 animate-fade-in">
                                      <h4 className="text-xs font-bold text-orange-800 dark:text-orange-300 uppercase mb-3 flex items-center gap-2">
                                          <Layers size={14}/> Divisão de Sabores
                                      </h4>
                                      <div className="flex gap-2 mb-4">
                                          {[1, 2, 3, 4].map(num => (
                                              <button
                                                  key={num}
                                                  onClick={() => setNewProduct({ ...newProduct, maxFlavors: num })}
                                                  className={`flex-1 py-2 rounded-lg font-bold text-sm border transition-all ${
                                                      (newProduct.maxFlavors || 1) === num 
                                                      ? 'bg-orange-600 text-white border-orange-600 shadow-md' 
                                                      : 'bg-white dark:bg-slate-900 text-gray-500 border-gray-200 dark:border-slate-700 hover:bg-orange-100 dark:hover:bg-slate-800'
                                                  }`}
                                              >
                                                  {num === 1 ? 'Int.' : `${num}x`}
                                              </button>
                                          ))}
                                      </div>
                                      
                                      {(newProduct.maxFlavors || 1) > 1 && (
                                          <div className="mb-4">
                                              <label className="block text-xs font-bold text-orange-800 dark:text-orange-300 uppercase mb-1">Taxa de Divisão (R$)</label>
                                              <input 
                                                  type="number" 
                                                  value={newProduct.splitSurcharge || ''} 
                                                  onChange={(e) => setNewProduct({...newProduct, splitSurcharge: parseFloat(e.target.value)})} 
                                                  className="w-full p-2 border border-orange-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 font-bold text-orange-700 dark:text-orange-400"
                                                  placeholder="0.00"
                                              />
                                          </div>
                                      )}

                                      <h4 className="text-xs font-bold text-orange-800 dark:text-orange-300 uppercase mb-2 flex items-center gap-2 border-t border-orange-200 dark:border-orange-800 pt-3">
                                          <Database size={14}/> Sabores Disponíveis
                                      </h4>
                                      <div className="max-h-40 overflow-y-auto pr-1 space-y-1 bg-white dark:bg-slate-900 rounded-lg p-2 border border-orange-200 dark:border-slate-700">
                                          {pizzaFlavors.length === 0 && <p className="text-xs text-gray-400 italic text-center">Nenhum sabor cadastrado.</p>}
                                          {pizzaFlavors.map(flavor => (
                                              <label key={flavor.id} className="flex items-center gap-2 p-1 hover:bg-gray-50 dark:hover:bg-slate-800 rounded cursor-pointer">
                                                  <input 
                                                      type="checkbox"
                                                      checked={(newProduct.availableFlavorIds || []).includes(flavor.id)}
                                                      onChange={(e) => {
                                                          const currentIds = newProduct.availableFlavorIds || [];
                                                          if (e.target.checked) {
                                                              setNewProduct({...newProduct, availableFlavorIds: [...currentIds, flavor.id]});
                                                          } else {
                                                              setNewProduct({...newProduct, availableFlavorIds: currentIds.filter(id => id !== flavor.id)});
                                                          }
                                                      }}
                                                      className="w-4 h-4 accent-orange-600"
                                                  />
                                                  <span className="text-sm text-slate-700 dark:text-gray-300">{flavor.name}</span>
                                              </label>
                                          ))}
                                      </div>
                                  </div>
                              )}
                          </div>
                      </div>
                      
                      <div className="border-t border-gray-100 dark:border-slate-800 pt-6">
                          <div className="flex justify-between items-center mb-4">
                              <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><Layers size={18}/> Complementos e Opções</h4>
                              <button onClick={handleAddOptionGroup} className="text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition-colors">+ Adicionar Grupo</button>
                          </div>
                          
                          <div className="space-y-4">
                              {newProduct.optionGroups?.map((group, gIdx) => (
                                  <div key={group.id} className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-200 dark:border-slate-700">
                                      <div className="flex items-start gap-4 mb-4">
                                          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                                              <input type="text" value={group.name} onChange={(e) => handleUpdateOptionGroup(group.id, 'name', e.target.value)} className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm font-bold" placeholder="Nome do Grupo" />
                                              <div className="flex items-center gap-2"><span className="text-xs text-gray-500">Mín:</span><input type="number" value={group.min} onChange={(e) => handleUpdateOptionGroup(group.id, 'min', parseInt(e.target.value))} className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" /></div>
                                              <div className="flex items-center gap-2"><span className="text-xs text-gray-500">Máx:</span><input type="number" value={group.max} onChange={(e) => handleUpdateOptionGroup(group.id, 'max', parseInt(e.target.value))} className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" /></div>
                                          </div>
                                          <button onClick={() => handleRemoveOptionGroup(group.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={18}/></button>
                                      </div>
                                      
                                      <div className="pl-4 border-l-2 border-gray-200 dark:border-slate-600 space-y-2">
                                          {group.options.map((opt, oIdx) => (
                                              <div key={opt.id} className="flex items-center gap-2">
                                                  <input type="text" value={opt.name} onChange={(e) => handleUpdateOption(group.id, opt.id, 'name', e.target.value)} className="flex-1 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" placeholder="Nome da Opção" />
                                                  <input type="number" value={opt.price} onChange={(e) => handleUpdateOption(group.id, opt.id, 'price', parseFloat(e.target.value))} className="w-24 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" placeholder="R$ 0.00" />
                                                  <button onClick={() => handleRemoveOption(group.id, opt.id)} className="text-gray-300 hover:text-red-500"><X size={16}/></button>
                                              </div>
                                          ))}
                                          <button onClick={() => handleAddOptionToGroup(group.id)} className="text-xs font-bold text-blue-600 mt-2 flex items-center gap-1 hover:underline"><Plus size={12}/> Adicionar Opção</button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {productError && <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg font-bold">{productError}</div>}
                  </div>
                  <div className="p-6 border-t border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-end gap-3">
                      <button onClick={() => setShowProductModal(false)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors">Cancelar</button>
                      <button onClick={handleSaveProduct} className="px-8 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg shadow-red-600/20 transition-transform active:scale-95">Salvar Produto</button>
                  </div>
              </div>
          </div>
      )}

      {/* FLAVOR MANAGER MODAL */}
      {showFlavorModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-scale-in">
                  <div className="p-6 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center bg-orange-50 dark:bg-slate-800">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                          <Slice size={20} className="text-orange-500"/> Gerenciar Sabores
                      </h3>
                      <button onClick={() => setShowFlavorModal(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors"><X size={20} /></button>
                  </div>
                  
                  <div className="p-6 flex-1 overflow-y-auto bg-white dark:bg-slate-900">
                      {/* Create New Flavor Form */}
                      <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700 mb-6">
                          <h4 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-3 uppercase">{newFlavor.id ? 'Editar Sabor' : 'Adicionar Novo Sabor'}</h4>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                              <div className="md:col-span-1">
                                  <input 
                                      type="text" 
                                      placeholder="Nome (Ex: Calabresa)" 
                                      value={newFlavor.name || ''}
                                      onChange={e => setNewFlavor({...newFlavor, name: e.target.value})}
                                      className="w-full p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                  />
                              </div>
                              <div className="md:col-span-2 flex gap-2">
                                  <input 
                                      type="text" 
                                      placeholder="Descrição (Ingredientes)" 
                                      value={newFlavor.description || ''}
                                      onChange={e => setNewFlavor({...newFlavor, description: e.target.value})}
                                      className="flex-1 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                  />
                                  <button 
                                      onClick={handleSaveFlavor}
                                      className="bg-green-600 text-white px-4 py-2 rounded font-bold text-sm hover:bg-green-700 flex items-center gap-1"
                                  >
                                      <Save size={16}/> {newFlavor.id ? 'Salvar' : 'Criar'}
                                  </button>
                                  {newFlavor.id && (
                                      <button 
                                          onClick={() => setNewFlavor({})}
                                          className="bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-3 py-2 rounded font-bold text-sm"
                                      >
                                          Cancelar
                                      </button>
                                  )}
                              </div>
                          </div>
                      </div>

                      {/* Flavors List */}
                      <div className="space-y-2">
                          <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-800 pb-2 mb-2">
                              <span className="text-xs font-bold text-gray-400 uppercase">Sabor</span>
                              <span className="text-xs font-bold text-gray-400 uppercase">Ingredientes</span>
                              <span className="text-xs font-bold text-gray-400 uppercase w-20 text-right">Ações</span>
                          </div>
                          {pizzaFlavors.length === 0 ? (
                              <p className="text-center text-gray-400 py-4 text-sm">Nenhum sabor cadastrado.</p>
                          ) : (
                              pizzaFlavors.map(flavor => (
                                  <div key={flavor.id} className="flex justify-between items-center p-3 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg border border-transparent hover:border-gray-100 dark:hover:border-slate-700 transition-all group">
                                      <div className="font-bold text-slate-800 dark:text-white text-sm w-1/3">{flavor.name}</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 flex-1 truncate px-2">{flavor.description}</div>
                                      <div className="flex gap-1 w-20 justify-end opacity-50 group-hover:opacity-100 transition-opacity">
                                          <button onClick={() => setNewFlavor(flavor)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded"><Edit size={14}/></button>
                                          <button onClick={() => handleDeleteFlavor(flavor.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14}/></button>
                                      </div>
                                  </div>
                              ))
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* ... (Other modals: COUPON, COURIER, TRANSACTION) remain same ... */}
      {/* COUPON MODAL */}
      {showCouponModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl p-6 animate-scale-in">
                  <h3 className="font-bold text-lg mb-6 text-slate-800 dark:text-white">{editingCoupon.id ? 'Editar Cupom' : 'Novo Cupom'}</h3>
                  <div className="space-y-4">
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Código</label><input type="text" value={editingCoupon.code || ''} onChange={(e) => setEditingCoupon({...editingCoupon, code: e.target.value.toUpperCase()})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-mono uppercase tracking-widest" placeholder="EX: PROMO10" /></div>
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label><input type="text" value={editingCoupon.description || ''} onChange={(e) => setEditingCoupon({...editingCoupon, description: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Desconto de inauguração" /></div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                              <select value={editingCoupon.discountType || 'PERCENTAGE'} onChange={(e) => setEditingCoupon({...editingCoupon, discountType: e.target.value as any})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                                  <option value="PERCENTAGE">Porcentagem (%)</option>
                                  <option value="FIXED">Valor Fixo (R$)</option>
                              </select>
                          </div>
                          <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor</label><input type="number" value={editingCoupon.discountValue || ''} onChange={(e) => setEditingCoupon({...editingCoupon, discountValue: parseFloat(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                           <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pedido Mínimo</label><input type="number" value={editingCoupon.minOrderValue || ''} onChange={(e) => setEditingCoupon({...editingCoupon, minOrderValue: parseFloat(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                           <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Limite de Usos</label><input type="number" value={editingCoupon.usageLimit || ''} onChange={(e) => setEditingCoupon({...editingCoupon, usageLimit: parseInt(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                      </div>
                  </div>
                  <div className="mt-6 flex gap-3">
                      <button onClick={() => setShowCouponModal(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl">Cancelar</button>
                      <button onClick={handleSaveCoupon} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg">Salvar Cupom</button>
                  </div>
              </div>
          </div>
      )}

      {/* COURIER MODAL */}
      {showCourierModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl p-6 animate-scale-in">
                  <h3 className="font-bold text-lg mb-6 text-slate-800 dark:text-white">Novo Entregador</h3>
                  <div className="space-y-4">
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome</label><input type="text" value={newCourier.name || ''} onChange={(e) => setNewCourier({...newCourier, name: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone</label><input type="text" value={newCourier.phone || ''} onChange={(e) => setNewCourier({...newCourier, phone: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Placa do Veículo</label><input type="text" value={newCourier.plate || ''} onChange={(e) => setNewCourier({...newCourier, plate: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white uppercase" /></div>
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Comissão (%)</label><input type="number" value={newCourier.commissionRate || ''} onChange={(e) => setNewCourier({...newCourier, commissionRate: parseFloat(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                  </div>
                  <div className="mt-6 flex gap-3">
                      <button onClick={() => setShowCourierModal(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl">Cancelar</button>
                      <button onClick={handleSaveCourier} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg">Salvar</button>
                  </div>
              </div>
          </div>
      )}
      
      {/* TRANSACTION MODAL */}
      {showTransactionModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl p-6 animate-scale-in">
                  <h3 className="font-bold text-lg mb-6 text-slate-800 dark:text-white">Nova Movimentação</h3>
                  <div className="space-y-4">
                      <div className="flex bg-gray-100 dark:bg-slate-800 p-1 rounded-lg mb-4">
                          <button onClick={() => setNewTransaction({...newTransaction, type: 'INCOME'})} className={`flex-1 py-2 rounded font-bold text-sm transition-all ${newTransaction.type === 'INCOME' ? 'bg-green-600 text-white shadow' : 'text-gray-500'}`}>Entrada (+)</button>
                          <button onClick={() => setNewTransaction({...newTransaction, type: 'EXPENSE'})} className={`flex-1 py-2 rounded font-bold text-sm transition-all ${newTransaction.type === 'EXPENSE' ? 'bg-red-600 text-white shadow' : 'text-gray-500'}`}>Saída (-)</button>
                      </div>
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição</label><input type="text" value={newTransaction.description || ''} onChange={(e) => setNewTransaction({...newTransaction, description: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor (R$)</label><input type="number" value={newTransaction.amount || ''} onChange={(e) => setNewTransaction({...newTransaction, amount: parseFloat(e.target.value)})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold" /></div>
                      <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoria</label>
                          <select value={newTransaction.category} onChange={(e) => setNewTransaction({...newTransaction, category: e.target.value as any})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white">
                               {TRANSACTION_CATEGORIES.filter(c => c.type === newTransaction.type).map(c => (
                                   <option key={c.id} value={c.id}>{c.label}</option>
                               ))}
                          </select>
                      </div>
                      <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data</label><input type="date" value={newTransaction.date} onChange={(e) => setNewTransaction({...newTransaction, date: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" style={{ colorScheme: isDarkMode ? 'dark' : 'light' }} /></div>
                  </div>
                  <div className="mt-6 flex gap-3">
                      <button onClick={() => setShowTransactionModal(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl">Cancelar</button>
                      <button onClick={handleSaveTransaction} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg">Salvar</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default AdminDashboard;