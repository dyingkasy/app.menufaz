import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, Legend, ComposedChart
} from 'recharts';
import { 
    DollarSign, Users, ClipboardList, AlertTriangle, 
    CheckCircle, XCircle, ArrowLeft, LayoutDashboard, 
    ShoppingBasket, UtensilsCrossed, Settings, LogOut, Menu, Search, Plus, Edit, Trash, CreditCard, Clock, Store, Image as ImageIcon, UploadCloud, Calendar, X, ChevronRight, Layers, Tag, Save, Copy, Timer, Percent, CalendarDays, Bike, UserPlus, ChevronLeft, Power, Banknote, Calculator, ChevronDown, Check, TrendingUp, TrendingDown, Activity, AlertCircle, Lock, Unlock, Phone, MapPin, User, Zap, Ticket, PieChart as PieChartIcon, Wallet, Upload, Trash2, Eye, Package, Trophy, Navigation, MessageSquare, ArrowUpCircle, ArrowDownCircle, Coins, Receipt, EyeOff, Send, ShieldAlert, ShieldCheck, Mail, ToggleLeft, ToggleRight, Slice, Database, Table, Download, GripVertical, Loader2
} from 'lucide-react';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import {
    UserRole,
    DashboardSection,
    Product,
    Order,
    ProductOptionGroup,
    ProductOption,
    OptionGroupTemplate,
    Courier,
    Store as StoreType,
    StoreAvailability,
    ScheduleDay,
    Coupon,
    FinancialTransaction,
    PaymentMethod,
    PizzaFlavor,
    Address,
    DeliveryNeighborhood,
    DeliveryZone,
    TabletDevice,
    Customer
} from '../types';
import { formatCurrencyBRL, formatOrderNumber } from '../utils/format';
import { compressImageFile } from '../utils/image';
import { uploadImageKit, deleteImageKit } from '../services/imagekit';
import { useAuth } from '../contexts/AuthContext';
import {
    getStoreById,
    updateStore,
    updateStoreSchedule,
    updateStoreAutoAccept,
    updateStoreAutoOpen,
    getStoreAvailability,
    pauseStore,
    resumeStorePause,
    getProductsByStore,
    getOptionGroupTemplatesByStore,
    saveOptionGroupTemplate,
    deleteOptionGroupTemplate,
    saveProduct,
    deleteProduct,
    subscribeToOrders,
    updateOrderStatus,
    updateOrderPayment,
    printOrder,
    printDeliveryCourier,
    getCouponsByStore,
    saveCoupon,
    deleteCoupon,
    getCouriersByStore,
    saveCourier,
    deleteCourier,
    getExpensesByStore,
    saveExpense,
    deleteExpense,
    deleteOrder,
    getPizzaFlavorsByStore,
    savePizzaFlavor,
    deletePizzaFlavor,
    generateMerchantId,
    revokeMerchantId,
    importNeighborhoodsForStore,
    getPixRepasseConfig,
    updatePixRepasseConfig,
    getMerchantProductsWithStock,
    updateProductStock,
    createTabletQr,
    listTablets,
    revokeTablet,
    listCustomers
} from '../services/db';
import { DEFAULT_PAYMENT_METHODS } from '../constants';
import { searchAddress, GEO_API_ENABLED, fetchCepData, ensureGoogleMapsLoaded } from '../utils/geo';

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

const PIZZA_SIZE_GROUP_ID = 'size-group';
const PIZZA_SIZE_OPTIONS = [
    { key: 'brotinho', label: 'Brotinho', optionId: 'size-brotinho', order: 1 },
    { key: 'pequena', label: 'Pequena', optionId: 'size-pequena', order: 2 },
    { key: 'media', label: 'Média', optionId: 'size-media', order: 3 },
    { key: 'grande', label: 'Grande', optionId: 'size-grande', order: 4 },
    { key: 'familia', label: 'Família', optionId: 'size-familia', order: 5 }
];

const PRICING_STRATEGIES = [
    { id: 'NORMAL', label: 'Normal' },
    { id: 'PROPORCIONAL', label: 'Proporcional' },
    { id: 'MAX', label: 'Maior sabor' }
];

const normalizeCategoryValue = (value: string) => (value || '').toString().toLowerCase().trim();

const ORDER_STATUS_FLOW_BY_TYPE: Record<Order['type'] | 'DEFAULT', Order['status'][]> = {
    DELIVERY: ['PENDING', 'PREPARING', 'WAITING_COURIER', 'DELIVERING', 'COMPLETED', 'CANCELLED'],
    PICKUP: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED'],
    TABLE: ['PENDING', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'],
    DEFAULT: ['PENDING', 'PREPARING', 'WAITING_COURIER', 'DELIVERING', 'COMPLETED', 'CANCELLED']
};

const ORDER_STATUS_LABELS: Record<Order['status'], string> = {
    PENDING: 'Novo',
    CONFIRMED: 'Confirmado',
    PREPARING: 'Em Preparo',
    READY_FOR_PICKUP: 'Pronto p/ Retirada',
    READY: 'Pronto',
    SERVED: 'Entregue na Mesa',
    WAITING_COURIER: 'Aguardando Motoboy',
    DELIVERING: 'Saiu para Entrega',
    COMPLETED: 'Concluído',
    CANCELLED: 'Cancelado'
};

const normalizeSizeKey = (value: string) =>
    (value || '')
        .toString()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();

const resolvePizzaSizeKey = (value: string) => {
    const normalized = normalizeSizeKey(value);
    if (!normalized) return '';
    if (PIZZA_SIZE_OPTIONS.some((size) => size.key === normalized)) return normalized;
    if (normalized.includes('sizebrotinho') || normalized.includes('brotinho')) return 'brotinho';
    if (normalized.includes('sizepequena') || normalized.includes('pequena') || normalized.includes('pequeno')) return 'pequena';
    if (normalized.includes('sizemedia') || normalized.includes('media') || normalized.includes('medio')) return 'media';
    if (normalized.includes('sizegrande') || normalized.includes('grande')) return 'grande';
    if (normalized.includes('sizefamilia') || normalized.includes('familia')) return 'familia';
    return '';
};

const getSizeKeyFromOption = (option?: ProductOption) => {
    if (!option) return '';
    const byId = PIZZA_SIZE_OPTIONS.find((size) => size.optionId === option.id);
    if (byId) return byId.key;
    return resolvePizzaSizeKey(option.name || '');
};

const isPizzaSizeGroup = (group?: ProductOptionGroup) => {
    if (!group) return false;
    if (group.id === PIZZA_SIZE_GROUP_ID) return true;
    return /tamanho|gramatura/i.test(group.name || '');
};

const ensurePizzaSizeGroup = (optionGroups?: ProductOptionGroup[]) => {
    const groups = [...(optionGroups || [])];
    const groupIndex = groups.findIndex((group) => isPizzaSizeGroup(group));
    const createOption = (size: typeof PIZZA_SIZE_OPTIONS[number]): ProductOption => ({
        id: size.optionId,
        name: size.label,
        price: 0,
        isAvailable: true,
        order: size.order,
        stockProductId: ''
    });

    if (groupIndex === -1) {
        const sizeGroup: ProductOptionGroup = {
            id: PIZZA_SIZE_GROUP_ID,
            name: 'Tamanho',
            min: 1,
            max: 1,
            options: PIZZA_SIZE_OPTIONS.map(createOption),
            isRequired: true,
            selectionType: 'SINGLE',
            order: groups.length + 1,
            extraChargeAfter: 0,
            extraChargeAmount: 0
        };
        return [...groups, sizeGroup];
    }

    const group = groups[groupIndex];
    const existingKeys = new Set(
        (group.options || []).map((opt) => getSizeKeyFromOption(opt)).filter(Boolean)
    );
    const missingOptions = PIZZA_SIZE_OPTIONS.filter((size) => !existingKeys.has(size.key)).map(createOption);
    if (missingOptions.length === 0) return groups;
    groups[groupIndex] = {
        ...group,
        options: [...(group.options || []), ...missingOptions]
    };
    return groups;
};

const ChartContainer: React.FC<{
    className?: string;
    children: (size: { width: number; height: number }) => React.ReactNode;
}> = ({ className, children }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const mergedClassName = ['w-full', className].filter(Boolean).join(' ');

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const observer = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (rect && rect.width > 0 && rect.height > 0) {
                setSize({ width: rect.width, height: rect.height });
            } else {
                setSize(null);
            }
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={containerRef} className={mergedClassName} style={{ minWidth: 1, minHeight: 1 }}>
            {size ? children(size) : null}
        </div>
    );
};

const SortableCategoryItem: React.FC<{
    id: string;
    label: string;
    onRemove: () => void;
    onEdit: () => void;
    isEditing: boolean;
    editValue: string;
    onEditChange: (value: string) => void;
    onEditSave: () => void;
    onEditCancel: () => void;
}> = ({ id, label, onRemove, onEdit, isEditing, editValue, onEditChange, onEditSave, onEditCancel }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        boxShadow: isDragging ? '0 10px 20px rgba(15, 23, 42, 0.15)' : undefined,
        opacity: isDragging ? 0.95 : 1
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
            <div className="flex items-center gap-3 flex-1">
                <button
                    type="button"
                    className="p-2 text-gray-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing"
                    aria-label="Arrastar categoria"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical size={16} />
                </button>
                {isEditing ? (
                    <input
                        type="text"
                        value={editValue}
                        onChange={(e) => onEditChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                onEditSave();
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                onEditCancel();
                            }
                        }}
                        className="flex-1 p-2 border rounded-lg text-sm dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        autoFocus
                    />
                ) : (
                    <span className="text-sm font-semibold text-slate-700 dark:text-gray-200">{label}</span>
                )}
            </div>
            <div className="flex items-center gap-2">
                {isEditing ? (
                    <>
                        <button
                            onClick={onEditSave}
                            className="p-2 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-slate-800 rounded-full"
                            title="Salvar edição"
                        >
                            <Check size={16} />
                        </button>
                        <button
                            onClick={onEditCancel}
                            className="p-2 text-gray-400 hover:text-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full"
                            title="Cancelar edição"
                        >
                            <X size={16} />
                        </button>
                    </>
                ) : (
                    <button
                        onClick={onEdit}
                        className="p-2 text-gray-400 hover:text-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full"
                        title="Editar categoria"
                    >
                        <Edit size={16} />
                    </button>
                )}
                <button
                    onClick={onRemove}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-slate-800 rounded-full"
                    title="Remover categoria"
                >
                    <Trash2 size={16} />
                </button>
            </div>
        </div>
    );
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onBack, userRole, targetStoreId, isDarkMode, toggleTheme }) => {
  const { user } = useAuth();
  const storeId = targetStoreId || user?.storeId;
  const fallbackDashboardKey = 'admin_dashboard_state';
  const dashboardStorageKey = storeId ? `admin_dashboard_state_${storeId}` : fallbackDashboardKey;
  const readDashboardState = (key: string) => {
      if (typeof window === 'undefined') return null;
      try {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
          return null;
      }
  };
  const getStoredDashboardState = () => {
      const primary = storeId ? readDashboardState(dashboardStorageKey) : null;
      return primary || readDashboardState(fallbackDashboardKey);
  };

  const [activeSection, setActiveSection] = useState<DashboardSection>(() => {
      const stored = getStoredDashboardState();
      return (stored?.activeSection as DashboardSection) || 'OVERVIEW';
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; tone: 'error' | 'success' } | null>(null);
  
  // Refs for File Uploads
  const storeLogoInputRef = useRef<HTMLInputElement>(null);
  const storeCoverInputRef = useRef<HTMLInputElement>(null);
  const productInfoInputRef = useRef<HTMLInputElement>(null);
  const buildableProductInputRef = useRef<HTMLInputElement>(null);
  const deliveryZoneMapRef = useRef<any>(null);
  const deliveryZoneMapContainerRef = useRef<HTMLDivElement>(null);
  const [deliveryZoneMapReady, setDeliveryZoneMapReady] = useState(false);
  const deliveryZoneCircleRefs = useRef<Map<string, any>>(new Map());
  const deliveryZonePolygonRefs = useRef<Map<string, any>>(new Map());
  const deliveryZoneDrawingManagerRef = useRef<any>(null);
  const deliveryZoneUpdateTimersRef = useRef<Map<string, any>>(new Map());
  const deliveryZoneSyncGuardRef = useRef<Set<string>>(new Set());
  const lastZoneIdsRef = useRef<string>('');
  const hasSyncedDerivedCategoriesRef = useRef(false);

  // --- STORE SETTINGS STATE ---
  const [storeProfile, setStoreProfile] = useState<Partial<StoreType>>({});
  const [menuQrDataUrl, setMenuQrDataUrl] = useState('');
  const [menuCategories, setMenuCategories] = useState<string[]>([]);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [categoryOrderDirty, setCategoryOrderDirty] = useState(false);
  const [categoryOrderNotice, setCategoryOrderNotice] = useState<string | null>(null);
  const [deliveryNeighborhoodSearch, setDeliveryNeighborhoodSearch] = useState('');
  const [deliveryNeighborhoodLoading, setDeliveryNeighborhoodLoading] = useState(false);
  const [deliveryNeighborhoodError, setDeliveryNeighborhoodError] = useState<string | null>(null);
  const [deliveryNeighborhoodInfo, setDeliveryNeighborhoodInfo] = useState<string | null>(null);
  const [manualNeighborhoodName, setManualNeighborhoodName] = useState('');
  const [manualNeighborhoodFee, setManualNeighborhoodFee] = useState('');
  const [selectedDeliveryZoneId, setSelectedDeliveryZoneId] = useState<string | null>(null);
  const [deliveryZoneError, setDeliveryZoneError] = useState<string | null>(null);
  const [deliveryZoneNotice, setDeliveryZoneNotice] = useState<string | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSavingCategories, setIsSavingCategories] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'STORE' | 'ADDRESS' | 'DELIVERY' | 'SCHEDULE' | 'PAYMENTS' | 'SECURITY' | 'HOMOLOGATION' | 'EXTRA'>(() => {
      const stored = getStoredDashboardState();
      return stored?.settingsTab || 'STORE';
  });
  const [merchantActionLoading, setMerchantActionLoading] = useState(false);
  
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
      email: '',
      whatsappOrderRequired: false
  });
  
  // Payment Methods State
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(DEFAULT_PAYMENT_METHODS);
  const [pixRepasseConfig, setPixRepasseConfig] = useState({
      pix_enabled: false,
      pix_hash_recebedor_01: '',
      pix_hash_recebedor_02: '',
      pix_identificacao_pdv: ''
  });
  const [pixRepasseLoading, setPixRepasseLoading] = useState(false);
  const [pixRepasseError, setPixRepasseError] = useState<string | null>(null);
  const [pixRepasseNotice, setPixRepasseNotice] = useState<string | null>(null);

  // --- MENU STATE ---
  const [products, setProducts] = useState<Product[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({});
  const [productError, setProductError] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState('');
  const [selectedCategoryTab, setSelectedCategoryTab] = useState<string>('Todos');
  const [stockProducts, setStockProducts] = useState<Product[]>([]);
  const [stockSearch, setStockSearch] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [stockEdits, setStockEdits] = useState<Record<string, string>>({});
  const [stockSavingIds, setStockSavingIds] = useState<Record<string, boolean>>({});
  const [showBuildableProductModal, setShowBuildableProductModal] = useState(false);
  const [buildableProduct, setBuildableProduct] = useState<Partial<Product>>({});
  const [buildableError, setBuildableError] = useState<string | null>(null);
  const [optionGroupTemplates, setOptionGroupTemplates] = useState<OptionGroupTemplate[]>([]);
  const [showOptionGroupTemplateModal, setShowOptionGroupTemplateModal] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<Partial<OptionGroupTemplate>>({});
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);

  const appliedTemplateIds = useMemo(() => {
      const ids = (newProduct.optionGroups || [])
          .map((group) => group.templateId)
          .filter(Boolean) as string[];
      return new Set(ids);
  }, [newProduct.optionGroups]);

  const isTemplateApplied = useCallback(
      (template: OptionGroupTemplate) => {
          if (appliedTemplateIds.has(template.id)) return true;
          const templateName = (template.name || '').toLowerCase().trim();
          if (!templateName) return false;
          return (newProduct.optionGroups || []).some(
              (group) => (group.name || '').toLowerCase().trim() === templateName
          );
      },
      [appliedTemplateIds, newProduct.optionGroups]
  );

  const suggestedTemplates = useMemo(() => {
      const category = normalizeCategoryValue((newProduct.category || '').toString());
      if (!category) return [];
      return optionGroupTemplates.filter((template) => {
          const linked = template.linkedCategoryIds || [];
          if (linked.length === 0) return false;
          return linked.some((value) => normalizeCategoryValue(value) === category);
      });
  }, [optionGroupTemplates, newProduct.category]);

  const suggestedTemplateIds = useMemo(
      () => new Set(suggestedTemplates.map((template) => template.id)),
      [suggestedTemplates]
  );

  const availableTemplates = useMemo(
      () => optionGroupTemplates.filter((template) => !suggestedTemplateIds.has(template.id)),
      [optionGroupTemplates, suggestedTemplateIds]
  );

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
  const [isAutoAcceptUpdating, setIsAutoAcceptUpdating] = useState(false);
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<Order | null>(null);

  const [availability, setAvailability] = useState<StoreAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [pauseMinutes, setPauseMinutes] = useState('');
  const [pauseReason, setPauseReason] = useState('');
  const [pauseUpdating, setPauseUpdating] = useState(false);
  
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
  const tableCountValue = Math.max(0, Number(storeProfile.tableCount || 0));
  const deliveryFeeMode =
      storeProfile.deliveryFeeMode === 'BY_NEIGHBORHOOD'
          ? 'BY_NEIGHBORHOOD'
          : storeProfile.deliveryFeeMode === 'BY_RADIUS'
          ? 'BY_RADIUS'
          : 'FIXED';
  const deliveryNeighborhoods = Array.isArray(storeProfile.neighborhoodFees)
      ? (storeProfile.neighborhoodFees as DeliveryNeighborhood[])
      : Array.isArray(storeProfile.deliveryNeighborhoods)
      ? (storeProfile.deliveryNeighborhoods as DeliveryNeighborhood[])
      : [];
  const filteredDeliveryNeighborhoods = useMemo(() => {
      const search = deliveryNeighborhoodSearch.trim().toLowerCase();
      return deliveryNeighborhoods
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => {
              if (!search) return true;
              return (item.name || '').toLowerCase().includes(search);
          });
  }, [deliveryNeighborhoodSearch, deliveryNeighborhoods]);
  const deliveryZones = Array.isArray(storeProfile.deliveryZones)
      ? (storeProfile.deliveryZones as DeliveryZone[])
      : [];
  const selectedDeliveryZone = deliveryZones.find((zone) => zone.id === selectedDeliveryZoneId) || null;
  const [isDownloadingTables, setIsDownloadingTables] = useState(false);
  const [tabletDevices, setTabletDevices] = useState<TabletDevice[]>([]);
  const [tabletLoading, setTabletLoading] = useState(false);
  const [tabletError, setTabletError] = useState('');
  const [downloadingTable, setDownloadingTable] = useState<number | null>(null);
  const [downloadingTabletTable, setDownloadingTabletTable] = useState<number | null>(null);
  const [tabletQrOpen, setTabletQrOpen] = useState(false);
  const [tabletQrTable, setTabletQrTable] = useState<number | null>(null);
  const [tabletQrDataUrl, setTabletQrDataUrl] = useState<string | null>(null);
  const [tabletQrUrl, setTabletQrUrl] = useState<string | null>(null);
  const [tabletQrExpiresAt, setTabletQrExpiresAt] = useState<string | null>(null);
  const [tabletQrCountdown, setTabletQrCountdown] = useState('05:00');
  const [tabletQrToken, setTabletQrToken] = useState<string | null>(null);
  const [tabletQrSuccess, setTabletQrSuccess] = useState<string | null>(null);
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);
  const [selectedTablePayment, setSelectedTablePayment] = useState('');
  const [paymentOrderTarget, setPaymentOrderTarget] = useState<Order | null>(null);
  const [paymentOrderMethod, setPaymentOrderMethod] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const orderAlertActiveRef = useRef(false);
  const orderAlertContextRef = useRef<AudioContext | null>(null);
  const orderAlertTimerRef = useRef<number | null>(null);
  const playOrderChime = useCallback((context: AudioContext) => {
      const now = context.currentTime;
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      gain.connect(context.destination);

      const hit = (freq: number, startOffset: number, duration: number) => {
          const osc = context.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          osc.connect(gain);
          osc.start(now + startOffset);
          osc.stop(now + startOffset + duration);
      };

      // Soft bell-like double chime
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.42, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      hit(784, 0, 0.6);
      hit(988, 0.05, 0.5);

      gain.gain.setValueAtTime(0.0001, now + 1.3);
      gain.gain.exponentialRampToValueAtTime(0.36, now + 1.32);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
      hit(659, 1.3, 0.6);
      hit(784, 1.35, 0.5);
  }, []);
  const formatTabletDate = (value?: string | null) => {
      if (!value) return '--';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return '--';
      return parsed.toLocaleString('pt-BR');
  };
  const loadTabletDevices = useCallback(async () => {
      if (!storeId || !storeProfile.acceptsTableOrders) return;
      setTabletLoading(true);
      setTabletError('');
      try {
          const data = await listTablets(storeId);
          setTabletDevices(Array.isArray(data) ? data : []);
      } catch (error) {
          setTabletError('Nao foi possivel carregar tablets conectados.');
      } finally {
          setTabletLoading(false);
      }
  }, [storeId, storeProfile.acceptsTableOrders]);

  const loadCustomers = useCallback(async () => {
      if (!storeId) return;
      setCustomersLoading(true);
      setCustomersError('');
      try {
          const data = await listCustomers(storeId);
          setCustomers(Array.isArray(data) ? data : []);
      } catch (error) {
          setCustomersError('Nao foi possivel carregar clientes.');
      } finally {
          setCustomersLoading(false);
      }
  }, [storeId]);

  useEffect(() => {
      const stored = getStoredDashboardState();
      if (!stored) return;
      if (stored.activeSection) {
          setActiveSection(stored.activeSection as DashboardSection);
      }
      if (stored.settingsTab) {
          setSettingsTab(stored.settingsTab);
      }
  }, [dashboardStorageKey]);

  useEffect(() => {
      if (typeof window === 'undefined') return;
      const payload = {
          activeSection,
          settingsTab
      };
      localStorage.setItem(dashboardStorageKey, JSON.stringify(payload));
      localStorage.setItem(fallbackDashboardKey, JSON.stringify(payload));
  }, [dashboardStorageKey, activeSection, settingsTab]);

  // --- INITIAL DATA LOADING ---
  useEffect(() => {
      if (storeId) {
          const loadStoreData = async () => {
              try {
                  const storeData = await getStoreById(storeId);
                  if (storeData) {
                      const normalizeSchedule = (schedule?: ScheduleDay[]) => {
                          const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
                          if (!schedule || schedule.length === 0) {
                              return days.map(day => ({
                                  day,
                                  morningOpenTime: '00:00',
                                  morningCloseTime: '12:00',
                                  afternoonOpenTime: '12:01',
                                  afternoonCloseTime: '23:59',
                                  isMorningOpen: true,
                                  isAfternoonOpen: true
                              }));
                          }
                          return schedule.map((day, index) => {
                              const fallbackDay = days[index] || day.day;
                              const legacyOpen = (day as any).openTime;
                              const legacyClose = (day as any).closeTime;
                              return {
                                  day: day.day || fallbackDay,
                                  morningOpenTime: day.morningOpenTime || legacyOpen || '00:00',
                                  morningCloseTime: day.morningCloseTime || legacyClose || '12:00',
                                  afternoonOpenTime: day.afternoonOpenTime || '12:01',
                                  afternoonCloseTime: day.afternoonCloseTime || '23:59',
                                  isMorningOpen: day.isMorningOpen ?? day.isOpen ?? true,
                                  isAfternoonOpen: day.isAfternoonOpen ?? day.isOpen ?? true
                              };
                          });
                      };
                      // Inicializa Schedule se não existir
                      storeData.schedule = normalizeSchedule(storeData.schedule);
                      storeData.acceptsTableOrders = storeData.acceptsTableOrders ?? false;
                      storeData.tableCount = storeData.tableCount ?? 0;
                      storeData.logoUrl = storeData.logoUrl || '';

                      setStoreProfile(storeData);
                      const storedCategories = Array.isArray((storeData as any).menuCategories)
                          ? (storeData as any).menuCategories
                              .map((value: string) => value?.toString().trim())
                              .filter((value: string) => value)
                          : [];
                      setMenuCategories(storedCategories);
                      setIsAutoAcceptEnabled(Boolean(storeData.autoAcceptOrders));
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
                          email: extendedData.email || '',
                          whatsappOrderRequired: Boolean(extendedData.whatsappOrderRequired)
                      });
                      
                      if (extendedData.paymentMethods) {
                          setPaymentMethods(extendedData.paymentMethods);
                      }

                      setPixRepasseLoading(true);
                      try {
                          const pixConfig = await getPixRepasseConfig(storeId);
                          setPixRepasseConfig({
                              pix_enabled: !!pixConfig.pix_enabled,
                              pix_hash_recebedor_01: pixConfig.pix_hash_recebedor_01 || '',
                              pix_hash_recebedor_02: pixConfig.pix_hash_recebedor_02 || '',
                              pix_identificacao_pdv: pixConfig.pix_identificacao_pdv || ''
                          });
                      } catch (error) {
                          setPixRepasseError('Não foi possível carregar o PIX Repasse.');
                      } finally {
                          setPixRepasseLoading(false);
                      }

                      setAvailabilityLoading(true);
                      try {
                          const latestAvailability = await getStoreAvailability(storeId);
                          setAvailability(latestAvailability);
                      } catch (error) {
                          console.error('Error loading store availability:', error);
                      } finally {
                          setAvailabilityLoading(false);
                      }
                  }

                  const productsData = await getProductsByStore(storeId);
                  setProducts(
                      productsData.map((product) => ({
                          ...product,
                          category: product.category || 'Lanches',
                          isAvailable: product.isAvailable ?? true
                      }))
                  );

                  const flavorsData = await getPizzaFlavorsByStore(storeId);
                  setPizzaFlavors(flavorsData);

                  const templatesData = await getOptionGroupTemplatesByStore(storeId);
                  setOptionGroupTemplates(templatesData);

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

  useEffect(() => {
      if (activeSection !== 'CUSTOMERS') return;
      loadCustomers();
  }, [activeSection, loadCustomers]);

  const loadStockProducts = useCallback(async () => {
      if (!storeId) return;
      setStockLoading(true);
      try {
          const data = await getMerchantProductsWithStock(storeId);
          setStockProducts(data);
          setStockEdits(
              data.reduce<Record<string, string>>((acc, product) => {
                  const value = typeof product.stock_qty === 'number' ? product.stock_qty : 0;
                  acc[product.id] = String(value);
                  return acc;
              }, {})
          );
      } catch (error) {
          console.error('Error loading stock products:', error);
          showToast('Erro ao carregar estoque.');
      } finally {
          setStockLoading(false);
      }
  }, [storeId]);

  useEffect(() => {
      if (activeSection !== 'STOCK') return;
      loadStockProducts();
  }, [activeSection, loadStockProducts]);

  useEffect(() => {
      const pendingCount = orders.filter((order) => order.status === 'PENDING').length;
      if (pendingCount > 0 && !orderAlertActiveRef.current) {
          orderAlertActiveRef.current = true;
          try {
              const context = new (window.AudioContext || (window as any).webkitAudioContext)();
              orderAlertContextRef.current = context;
              playOrderChime(context);
              orderAlertTimerRef.current = window.setInterval(() => {
                  playOrderChime(context);
              }, 5000);
          } catch (error) {
              orderAlertActiveRef.current = false;
          }
      }

      if (pendingCount === 0 && orderAlertActiveRef.current) {
          orderAlertActiveRef.current = false;
          if (orderAlertTimerRef.current) {
              window.clearInterval(orderAlertTimerRef.current);
              orderAlertTimerRef.current = null;
          }
          try {
              orderAlertContextRef.current?.close();
          } catch {}
          orderAlertContextRef.current = null;
      }
  }, [orders, playOrderChime]);

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

  useEffect(() => {
      if (menuCategories.length > 0) return;
      const derived = Array.from(
          new Set(
              products
                  .map((product) => (product.category || '').toString().trim())
                  .filter((value) => value)
          )
      );
      if (derived.length > 0) setMenuCategories(derived);
  }, [products, menuCategories.length]);

  useEffect(() => {
      if (hasSyncedDerivedCategoriesRef.current) return;
      if (!storeId || menuCategories.length > 0 || products.length === 0) return;
      const derived = Array.from(
          new Set(
              products
                  .map((product) => (product.category || '').toString().trim())
                  .filter((value) => value)
          )
      );
      if (derived.length === 0) return;
      hasSyncedDerivedCategoriesRef.current = true;
      persistMenuCategories(derived);
  }, [products, menuCategories.length, storeId]);

  useEffect(() => {
      const shouldLoad =
          deliveryFeeMode === 'BY_NEIGHBORHOOD' &&
          deliveryNeighborhoods.length === 0;
      if (!shouldLoad) return;
      importNeighborhoods(false);
  }, [deliveryFeeMode, deliveryNeighborhoods.length]);

  useEffect(() => {
      if (deliveryFeeMode !== 'BY_RADIUS') return;
      if (deliveryZones.length === 0) {
          setSelectedDeliveryZoneId(null);
          return;
      }
      if (!selectedDeliveryZoneId) {
          setSelectedDeliveryZoneId(deliveryZones[0].id);
          return;
      }
      if (!deliveryZones.find((zone) => zone.id === selectedDeliveryZoneId)) {
          setSelectedDeliveryZoneId(deliveryZones[0].id);
      }
  }, [deliveryFeeMode, deliveryZones, selectedDeliveryZoneId]);

  useEffect(() => {
      if (settingsTab !== 'DELIVERY' || deliveryFeeMode !== 'BY_RADIUS') {
          setDeliveryZoneError(null);
          setDeliveryZoneMapReady(false);
          return;
      }
      let cancelled = false;
      const initMap = async () => {
          setDeliveryZoneError(null);
          const loaded = await ensureGoogleMapsLoaded();
          if (cancelled) return;
          if (!loaded) {
              setDeliveryZoneError('Erro ao carregar o mapa. Verifique a configuração da chave Google Maps.');
              setDeliveryZoneMapReady(false);
              return;
          }
          setDeliveryZoneError(null);
          const container = deliveryZoneMapContainerRef.current;
          if (!container) {
              setDeliveryZoneMapReady(false);
              return;
          }
          const center = storeProfile.coordinates || { lat: -23.561684, lng: -46.655981 };
          if (!deliveryZoneMapRef.current || deliveryZoneMapRef.current.getDiv() !== container) {
              deliveryZoneMapRef.current = new window.google.maps.Map(container, {
                  center,
                  zoom: 13,
                  mapTypeControl: false,
                  streetViewControl: false,
                  fullscreenControl: false
              });
              deliveryZoneCircleRefs.current.forEach((circle) => {
                  circle.setMap(deliveryZoneMapRef.current);
              });
              window.google.maps.event.trigger(deliveryZoneMapRef.current, 'resize');
          } else if (storeProfile.coordinates) {
              deliveryZoneMapRef.current.setCenter(storeProfile.coordinates);
              window.google.maps.event.trigger(deliveryZoneMapRef.current, 'resize');
          }
          setDeliveryZoneMapReady(true);
      };
      initMap();
      return () => {
          cancelled = true;
      };
  }, [settingsTab, deliveryFeeMode, storeProfile.coordinates?.lat, storeProfile.coordinates?.lng]);

  useEffect(() => {
      if (settingsTab !== 'DELIVERY' || !storeProfile.acceptsTableOrders) return;
      let active = true;
      const run = async () => {
          if (!active) return;
          await loadTabletDevices();
      };
      run();
      const interval = setInterval(run, 30000);
      return () => {
          active = false;
          clearInterval(interval);
      };
  }, [settingsTab, storeProfile.acceptsTableOrders, loadTabletDevices]);

  useEffect(() => {
      if (!tabletQrOpen || !tabletQrExpiresAt) return;
      const update = () => {
          const diff = new Date(tabletQrExpiresAt).getTime() - Date.now();
          if (Number.isNaN(diff)) {
              setTabletQrCountdown('--:--');
              return;
          }
          if (diff <= 0) {
              setTabletQrCountdown('00:00');
              setTabletQrOpen(false);
              return;
          }
          const minutes = Math.floor(diff / 60000);
          const seconds = Math.floor((diff % 60000) / 1000);
          setTabletQrCountdown(`${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
      };
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
  }, [tabletQrOpen, tabletQrExpiresAt]);
  useEffect(() => {
      if (!tabletQrOpen || !tabletQrToken || !storeId) return;
      let active = true;
      const poll = async () => {
          try {
              const devices = await listTablets(storeId);
              if (!active) return;
              setTabletDevices(Array.isArray(devices) ? devices : []);
              const matched = devices.find((device) => device.token === tabletQrToken && device.device_id);
              if (matched) {
                  setTabletQrOpen(false);
                  setTabletQrSuccess(`Tablet conectado com sucesso na Mesa ${matched.table_number || '--'}.`);
                  return;
              }
          } catch {}
          if (active) {
              setTimeout(poll, 3000);
          }
      };
      poll();
      return () => {
          active = false;
      };
  }, [tabletQrOpen, tabletQrToken, storeId]);
  useEffect(() => {
      if (!tabletQrSuccess) return;
      const timer = setTimeout(() => {
          setTabletQrSuccess(null);
      }, 6000);
      return () => clearTimeout(timer);
  }, [tabletQrSuccess]);

  useEffect(() => {
      if (deliveryFeeMode !== 'BY_RADIUS') return;
      if (!deliveryZoneMapReady) return;
      if (!deliveryZoneMapRef.current || !window.google) return;
      const map = deliveryZoneMapRef.current;
      const circleMap = deliveryZoneCircleRefs.current;
      const polygonMap = deliveryZonePolygonRefs.current;
      const guard = deliveryZoneSyncGuardRef.current;
      const timers = deliveryZoneUpdateTimersRef.current;
      const selectedId = selectedDeliveryZoneId;

      const activeIds = new Set(deliveryZones.map((zone) => zone.id));
      for (const [zoneId, circle] of circleMap.entries()) {
          if (!activeIds.has(zoneId)) {
              window.google.maps.event.clearInstanceListeners(circle);
              circle.setMap(null);
              circleMap.delete(zoneId);
              const timer = timers.get(zoneId);
              if (timer) clearTimeout(timer);
              timers.delete(zoneId);
              guard.delete(zoneId);
          }
      }
      for (const [zoneId, polygon] of polygonMap.entries()) {
          if (!activeIds.has(zoneId)) {
              window.google.maps.event.clearInstanceListeners(polygon);
              polygon.setMap(null);
              polygonMap.delete(zoneId);
              const timer = timers.get(zoneId);
              if (timer) clearTimeout(timer);
              timers.delete(zoneId);
              guard.delete(zoneId);
          }
      }

      deliveryZones.forEach((zone) => {
          if (!zone) return;
          const type = getZoneType(zone);
          const isSelected = selectedId === zone.id;
          const strokeColor = isSelected ? '#0ea5e9' : '#ef4444';
          const fillColor = isSelected ? '#0ea5e9' : '#ef4444';
          if (type === 'POLYGON') {
              const path = Array.isArray(zone.polygonPath) ? zone.polygonPath : [];
              if (path.length < 3) return;
              let polygon = polygonMap.get(zone.id);
              if (!polygon) {
                  polygon = new window.google.maps.Polygon({
                      map,
                      paths: path,
                      editable: true,
                      draggable: true,
                      fillColor,
                      fillOpacity: 0.2,
                      strokeColor,
                      strokeWeight: 2
                  });
                  polygon.addListener('click', () => setSelectedDeliveryZoneId(zone.id));
                  const scheduleSync = () => {
                      if (guard.has(zone.id)) return;
                      const timer = timers.get(zone.id);
                      if (timer) clearTimeout(timer);
                      timers.set(
                          zone.id,
                          setTimeout(() => {
                              const points = polygon
                                  .getPath()
                                  .getArray()
                                  .map((point: any) => ({ lat: point.lat(), lng: point.lng() }));
                              if (points.length < 3) return;
                              const avg = points.reduce(
                                  (acc, item) => ({ lat: acc.lat + item.lat, lng: acc.lng + item.lng }),
                                  { lat: 0, lng: 0 }
                              );
                              const centerLat = avg.lat / points.length;
                              const centerLng = avg.lng / points.length;
                              handleUpdateDeliveryZone(zone.id, {
                                  polygonPath: points,
                                  centerLat,
                                  centerLng
                              });
                          }, 150)
                      );
                  };
                  polygon.getPath().addListener('set_at', scheduleSync);
                  polygon.getPath().addListener('insert_at', scheduleSync);
                  polygon.getPath().addListener('remove_at', scheduleSync);
                  polygon.addListener('dragend', scheduleSync);
                  polygonMap.set(zone.id, polygon);
                  return;
              }
              if (polygon.getMap() !== map) {
                  polygon.setMap(map);
              }
              polygon.setOptions({ strokeColor, fillColor });
              const currentPath = polygon.getPath().getArray().map((point: any) => ({
                  lat: point.lat(),
                  lng: point.lng()
              }));
              const needsUpdate =
                  currentPath.length !== path.length ||
                  currentPath.some(
                      (point: any, idx: number) =>
                          Math.abs(point.lat - path[idx].lat) > 0.000001 ||
                          Math.abs(point.lng - path[idx].lng) > 0.000001
                  );
              if (needsUpdate) {
                  guard.add(zone.id);
                  polygon.setPaths(path);
                  setTimeout(() => guard.delete(zone.id), 0);
              }
              return;
          }
          const center = { lat: Number(zone.centerLat), lng: Number(zone.centerLng) };
          const radius = Number(zone.radiusMeters || 0);
          let circle = circleMap.get(zone.id);

          if (!circle) {
              circle = new window.google.maps.Circle({
                  map,
                  center,
                  radius,
                  editable: true,
                  draggable: true,
                  fillColor,
                  fillOpacity: 0.2,
                  strokeColor,
                  strokeWeight: 2
              });
              circle.addListener('click', () => setSelectedDeliveryZoneId(zone.id));
              circleMap.set(zone.id, circle);

              const scheduleSync = () => {
                  if (guard.has(zone.id)) return;
                  const timer = timers.get(zone.id);
                  if (timer) clearTimeout(timer);
                  timers.set(
                      zone.id,
                      setTimeout(() => {
                          const nextCenter = circle.getCenter();
                          if (!nextCenter) return;
                          const nextRadius = Math.round(circle.getRadius());
                          handleUpdateDeliveryZone(zone.id, {
                              centerLat: nextCenter.lat(),
                              centerLng: nextCenter.lng(),
                              radiusMeters: nextRadius
                          });
                      }, 150)
                  );
              };

              circle.addListener('center_changed', scheduleSync);
              circle.addListener('radius_changed', scheduleSync);
              circle.addListener('dragend', scheduleSync);
              return;
          }

          if (circle.getMap() !== map) {
              circle.setMap(map);
          }
          circle.setOptions({ strokeColor, fillColor });

          const currentCenter = circle.getCenter();
          const currentRadius = circle.getRadius();
          const needsCenter =
              !currentCenter ||
              Math.abs(currentCenter.lat() - center.lat) > 0.000001 ||
              Math.abs(currentCenter.lng() - center.lng) > 0.000001;
          const needsRadius = Math.abs(currentRadius - radius) > 0.5;

          if (needsCenter || needsRadius) {
              guard.add(zone.id);
              if (needsCenter) circle.setCenter(center);
              if (needsRadius) circle.setRadius(radius);
              setTimeout(() => guard.delete(zone.id), 0);
          }
      });

      const zoneIdsKey = deliveryZones.map((zone) => zone.id).join('|');
      if (zoneIdsKey !== lastZoneIdsRef.current) {
          lastZoneIdsRef.current = zoneIdsKey;
          if (deliveryZones.length > 0) {
              const bounds = new window.google.maps.LatLngBounds();
              deliveryZones.forEach((zone) => {
                  const type = getZoneType(zone);
                  if (type === 'POLYGON' && Array.isArray(zone.polygonPath)) {
                      zone.polygonPath.forEach((point) => bounds.extend(point));
                      return;
                  }
                  const lat = Number(zone.centerLat);
                  const lng = Number(zone.centerLng);
                  const radiusMeters = Number(zone.radiusMeters || 0);
                  if (!Number.isFinite(lat) || !Number.isFinite(lng) || radiusMeters <= 0) return;
                  const latDelta = radiusMeters / 111320;
                  const lngDelta = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
                  bounds.extend({ lat: lat + latDelta, lng: lng + lngDelta });
                  bounds.extend({ lat: lat - latDelta, lng: lng - lngDelta });
              });
              map.fitBounds(bounds);
          }
      }
  }, [deliveryFeeMode, deliveryZones, selectedDeliveryZoneId, deliveryZoneMapReady]);

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

  const refreshAvailability = async () => {
      if (!storeId) return;
      setAvailabilityLoading(true);
      try {
          const latestAvailability = await getStoreAvailability(storeId);
          setAvailability(latestAvailability);
          setStoreProfile(prev => ({
              ...prev,
              isActive: latestAvailability.isOpen,
              autoOpenClose: latestAvailability.autoOpenClose,
              pause: latestAvailability.pause || prev.pause
          }));
      } catch (error) {
          console.error('Error refreshing availability:', error);
      } finally {
          setAvailabilityLoading(false);
      }
  };

  const [manualStatusUpdating, setManualStatusUpdating] = useState(false);

  const handleToggleOpenStore = async () => {
      if (!storeId || manualStatusUpdating) return;
      const availabilitySnapshot = availability;
      const isManualClosed = availabilitySnapshot?.pause?.active === true;
      const scheduleOpen = availabilitySnapshot?.scheduleOpen === true;
      const manualOpenOutsideSchedule =
          storeProfile.isActive === true && availabilitySnapshot?.scheduleOpen === false && !isManualClosed;
      const isCurrentlyOpen = (availabilitySnapshot?.isOpen ?? false) || manualOpenOutsideSchedule;

      if (storeProfile.autoOpenClose) {
          const confirmed = window.confirm('Auto abertura esta ativa. Deseja desativar e abrir/fechar manualmente?');
          if (!confirmed) return;
          try {
              await updateStoreAutoOpen(storeId, false);
              setStoreProfile(prev => ({ ...prev, autoOpenClose: false }));
          } catch (e) {
              showToast('Erro ao desativar auto abertura.');
              return;
          }
      }

      setManualStatusUpdating(true);
      try {
          if (isCurrentlyOpen) {
              const result = await pauseStore(storeId, 720, 'Fechada manualmente pelo lojista');
              setStoreProfile(prev => ({ ...prev, pause: result.pause, isActive: false }));
              await refreshAvailability();
              showToast('Loja fechada com sucesso.', 'success');
          } else {
              if (!scheduleOpen) {
                  const confirmed = window.confirm(
                      'A loja está fora do horário configurado agora. Deseja abrir manualmente mesmo assim?'
                  );
                  if (!confirmed) {
                      setManualStatusUpdating(false);
                      return;
                  }
              }
              const result = await resumeStorePause(storeId);
              setStoreProfile(prev => ({ ...prev, pause: result.pause, isActive: true }));
              await refreshAvailability();
              showToast('Loja aberta com sucesso.', 'success');
          }
      } catch (e) {
          console.error(e);
          showToast('Não foi possível alterar o status da loja. Tente novamente.');
          await refreshAvailability();
      } finally {
          setManualStatusUpdating(false);
      }
  };

  const handleToggleAutoAccept = async () => {
      if (!storeId || isAutoAcceptUpdating) return;
      const next = !isAutoAcceptEnabled;
      setIsAutoAcceptUpdating(true);
      setIsAutoAcceptEnabled(next);
      setStoreProfile(prev => ({ ...prev, autoAcceptOrders: next }));
      try {
          await updateStoreAutoAccept(storeId, next);
      } catch (error) {
          console.error(error);
          alert('Erro ao atualizar auto-aceite.');
          setIsAutoAcceptEnabled(!next);
          setStoreProfile(prev => ({ ...prev, autoAcceptOrders: !next }));
      } finally {
          setIsAutoAcceptUpdating(false);
      }
  };

  const handleToggleAutoOpen = async () => {
      if (!storeId) return;
      const next = !storeProfile.autoOpenClose;
      setStoreProfile(prev => ({ ...prev, autoOpenClose: next }));
      try {
          await updateStoreAutoOpen(storeId, next);
          await refreshAvailability();
      } catch (error) {
          console.error(error);
          alert('Erro ao atualizar auto abertura.');
          setStoreProfile(prev => ({ ...prev, autoOpenClose: !next }));
      }
  };

  const handlePauseStore = async () => {
      if (!storeId || pauseUpdating) return;
      const minutesValue = Number(pauseMinutes);
      if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
          alert('Informe os minutos de pausa.');
          return;
      }
      if (!pauseReason.trim()) {
          alert('Informe o motivo da pausa.');
          return;
      }
      setPauseUpdating(true);
      try {
          const result = await pauseStore(storeId, minutesValue, pauseReason.trim());
          setStoreProfile(prev => ({ ...prev, pause: result.pause, isActive: false }));
          setPauseMinutes('');
          setPauseReason('');
          await refreshAvailability();
      } catch (error) {
          console.error(error);
          alert('Erro ao pausar loja.');
      } finally {
          setPauseUpdating(false);
      }
  };

  const handleResumePause = async () => {
      if (!storeId || pauseUpdating) return;
      setPauseUpdating(true);
      try {
          const result = await resumeStorePause(storeId);
          setStoreProfile(prev => ({ ...prev, pause: result.pause }));
          await refreshAvailability();
      } catch (error) {
          console.error(error);
          alert('Erro ao retomar loja.');
      } finally {
          setPauseUpdating(false);
      }
  };

  const handleStockInputChange = (productId: string, value: string) => {
      setStockEdits((prev) => ({ ...prev, [productId]: value }));
  };

  const handleSaveStock = async (product: Product) => {
      if (!storeId) return;
      const rawValue = stockEdits[product.id];
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(parsed)) {
          showToast('Informe um estoque válido.');
          return;
      }
      setStockSavingIds((prev) => ({ ...prev, [product.id]: true }));
      try {
          const updated = await updateProductStock(product.id, parsed, storeId);
          setStockProducts((prev) =>
              prev.map((item) => (item.id === product.id ? { ...item, stock_qty: updated.stock_qty } : item))
          );
          setStockEdits((prev) => ({ ...prev, [product.id]: String(updated.stock_qty ?? parsed) }));
          showToast('Estoque atualizado.', 'success');
      } catch (error) {
          showToast('Erro ao atualizar estoque.');
          setStockEdits((prev) => ({
              ...prev,
              [product.id]: String(typeof product.stock_qty === 'number' ? product.stock_qty : 0)
          }));
      } finally {
          setStockSavingIds((prev) => ({ ...prev, [product.id]: false }));
      }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'STORE_LOGO' | 'STORE_COVER' | 'PRODUCT' | 'BUILDABLE_PRODUCT') => {
      const file = e.target.files?.[0];
      if (!file) return;
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) { alert('A imagem deve ter no máximo 10MB.'); return; }

      try {
          const options = target === 'STORE_LOGO'
              ? { maxWidth: 384, maxHeight: 384, mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 0.8 }
              : target === 'STORE_COVER'
                  ? { maxWidth: 1280, maxHeight: 720, mimeType: 'image/jpeg', quality: 0.75 }
                  : { maxWidth: 900, maxHeight: 900, mimeType: 'image/jpeg', quality: 0.75 };
          const base64 = await compressImageFile(file, options);
          const upload = await uploadImageKit(base64, file.name);
          if (target === 'STORE_LOGO') {
              const previousId = storeProfile.logoFileId;
              setStoreProfile(prev => ({ ...prev, logoUrl: upload.url, logoFileId: upload.fileId }));
              if (previousId) {
                  try { await deleteImageKit(previousId); } catch {}
              }
          } else if (target === 'STORE_COVER') {
              const previousId = storeProfile.imageFileId;
              setStoreProfile(prev => ({ ...prev, imageUrl: upload.url, imageFileId: upload.fileId }));
              if (previousId) {
                  try { await deleteImageKit(previousId); } catch {}
              }
          } else if (target === 'PRODUCT') {
              const previousId = newProduct.imageFileId;
              setNewProduct(prev => ({ ...prev, imageUrl: upload.url, imageFileId: upload.fileId }));
              if (previousId) {
                  try { await deleteImageKit(previousId); } catch {}
              }
          } else {
              const previousId = buildableProduct.imageFileId;
              setBuildableProduct(prev => ({ ...prev, imageUrl: upload.url, imageFileId: upload.fileId }));
              if (previousId) {
                  try { await deleteImageKit(previousId); } catch {}
              }
          }
      } catch (error) {
          console.error('Image upload failed', error);
          alert('Falha ao enviar imagem. Tente novamente.');
      }
  };

  const handleRemoveStoreLogo = async () => {
      if (!storeProfile.logoUrl) return;
      if (!confirm('Remover logo da loja?')) return;
      const previousId = storeProfile.logoFileId;
      if (previousId) {
          try { await deleteImageKit(previousId); } catch {}
      }
      setStoreProfile(prev => ({ ...prev, logoUrl: '', logoFileId: '' }));
  };

  const handleRemoveStoreCover = async () => {
      if (!storeProfile.imageUrl) return;
      if (!confirm('Remover capa da loja?')) return;
      const previousId = storeProfile.imageFileId;
      if (previousId) {
          try { await deleteImageKit(previousId); } catch {}
      }
      setStoreProfile(prev => ({ ...prev, imageUrl: '', imageFileId: '' }));
  };

  const handleRemoveProductImage = async () => {
      if (!newProduct.imageUrl) return;
      if (!confirm('Remover imagem do produto?')) return;
      const previousId = newProduct.imageFileId;
      if (previousId) {
          try { await deleteImageKit(previousId); } catch {}
      }
      setNewProduct(prev => ({ ...prev, imageUrl: '', imageFileId: '' }));
  };

  const handleRemoveBuildableImage = async () => {
      if (!buildableProduct.imageUrl) return;
      if (!confirm('Remover imagem do produto montavel?')) return;
      const previousId = buildableProduct.imageFileId;
      if (previousId) {
          try { await deleteImageKit(previousId); } catch {}
      }
      setBuildableProduct(prev => ({ ...prev, imageUrl: '', imageFileId: '' }));
  };

  // ... (Product Handlers remain same) ...
  const handleAddOptionGroup = () => {
      const newGroup: ProductOptionGroup = { 
          id: Date.now().toString(), 
          name: 'Novo Grupo (ex: Molhos)', 
          min: 0, 
          max: 1, 
          options: [],
          isRequired: false,
          selectionType: 'SINGLE',
          order: (newProduct.optionGroups?.length || 0) + 1,
          extraChargeAfter: 0,
          extraChargeAmount: 0
      };
      setNewProduct(prev => ({ ...prev, optionGroups: [...(prev.optionGroups || []), newGroup] }));
  };
  const handleUpdateOptionGroup = (groupId: string, field: keyof ProductOptionGroup, value: any) => {
      setNewProduct(prev => ({ ...prev, optionGroups: prev.optionGroups?.map(g => g.id === groupId ? { ...g, [field]: value } : g) }));
  };
  const handleRemoveOptionGroup = (groupId: string) => {
      setNewProduct(prev => {
          const target = prev.optionGroups?.find((group) => group.id === groupId);
          if (prev.isPizza && isPizzaSizeGroup(target)) {
              return prev;
          }
          return { ...prev, optionGroups: prev.optionGroups?.filter(g => g.id !== groupId) };
      });
  };
  const handleAddOptionToGroup = (groupId: string) => {
      setNewProduct(prev => ({
          ...prev,
          optionGroups: prev.optionGroups?.map(g => {
              if (g.id !== groupId) return g;
              const newOption: ProductOption = { 
                  id: Date.now().toString(), 
                  name: 'Nova Opção', 
                  price: 0, 
                  isAvailable: true,
                  order: (g.options?.length || 0) + 1,
                  stockProductId: ''
              };
              return { ...g, options: [...g.options, newOption] };
          })
      }));
  };
  const handleUpdateOption = (groupId: string, optionId: string, field: keyof ProductOption, value: any) => {
      setNewProduct(prev => ({ ...prev, optionGroups: prev.optionGroups?.map(g => { if (g.id === groupId) return { ...g, options: g.options.map(o => o.id === optionId ? { ...o, [field]: value } : o) }; return g; }) }));
  };
  const handleRemoveOption = (groupId: string, optionId: string) => {
      setNewProduct(prev => {
          const target = prev.optionGroups?.find((group) => group.id === groupId);
          if (prev.isPizza && isPizzaSizeGroup(target)) {
              return prev;
          }
          return {
              ...prev,
              optionGroups: prev.optionGroups?.map(g => {
                  if (g.id === groupId) return { ...g, options: g.options.filter(o => o.id !== optionId) };
                  return g;
              })
          };
      });
  };
  const handleSaveProduct = async () => {
      if (!storeId) return;
      if (!newProduct.name) { setProductError('Nome é obrigatório.'); return; }
      const priceValue = Number(newProduct.price);
      if (!Number.isFinite(priceValue) || priceValue < 0) {
          setProductError('Preço deve ser zero ou maior.');
          return;
      }
      
      const isPizza = !!newProduct.isPizza;
      const maxFlavors = isPizza ? (newProduct.maxFlavors || 1) : 1;
      const sizeGroup = isPizza
          ? (newProduct.optionGroups || []).find((group) => isPizzaSizeGroup(group))
          : null;
      const availableSizeOptions = sizeGroup
          ? (sizeGroup.options || []).filter((opt) => opt.isAvailable !== false)
          : [];
      const availableSizeKeys = Array.from(
          new Set(availableSizeOptions.map((opt) => getSizeKeyFromOption(opt)).filter(Boolean))
      );

      if (isPizza) {
          if (!sizeGroup) {
              setProductError('Adicione o grupo de tamanho para pizzas.');
              return;
          }
          if (availableSizeOptions.length === 0) {
              setProductError('Selecione pelo menos um tamanho disponível.');
              return;
          }
          if (newProduct.priceMode === 'BY_SIZE') {
              const missingPrices = availableSizeOptions
                  .filter((opt) => !Number.isFinite(Number(opt.price)) || Number(opt.price) <= 0)
                  .map((opt) => opt.name || 'Tamanho');
              if (missingPrices.length > 0) {
                  setProductError(`Preencha o preço dos tamanhos disponíveis: ${missingPrices.join(', ')}`);
                  return;
              }
          }
      }

      if (isPizza && newProduct.priceMode === 'BY_SIZE') {
          const sizeKeys = availableSizeKeys;
          const allowedIds = (newProduct.availableFlavorIds || []).length
              ? newProduct.availableFlavorIds || []
              : pizzaFlavors.map((flavor) => flavor.id);
          const flavorsToCheck = pizzaFlavors.filter((flavor) => allowedIds.includes(flavor.id));
          if (sizeKeys.length > 0 && flavorsToCheck.length > 0) {
              const missing: string[] = [];
              flavorsToCheck.forEach((flavor) => {
                  const prices = flavor.pricesBySize || {};
                  sizeKeys.forEach((sizeKey) => {
                      const value = prices[sizeKey];
                      if (!value || Number(value) <= 0) {
                          missing.push(`${flavor.name} (${sizeKey})`);
                      }
                  });
              });
              if (missing.length > 0) {
                  setProductError(`Preencha os preços dos sabores para os tamanhos usados: ${missing.join(', ')}`);
                  return;
              }
          }
      }

      const productToSave: Omit<Product, 'id'> & { id?: string } = {
          id: newProduct.id, storeId: storeId, name: newProduct.name, description: newProduct.description || '', price: priceValue,
          promoPrice: newProduct.promoPrice ? Number(newProduct.promoPrice) : undefined, category: newProduct.category || 'Lanches', imageUrl: newProduct.imageUrl || '', imageFileId: newProduct.imageFileId,
          isAvailable: newProduct.isAvailable !== undefined ? newProduct.isAvailable : true,
          isBuildable: newProduct.isBuildable ?? false,
          priceMode: newProduct.priceMode,
          isPizza: isPizza, 
          maxFlavors: maxFlavors,
          allowHalfHalf: maxFlavors >= 2, 
          maxFlavorsBySize: isPizza
              ? (() => {
                    const defaults: Record<string, number> = {
                        brotinho: 2,
                        pequena: 2,
                        media: 3,
                        grande: 4,
                        familia: 5
                    };
                    const current = { ...(newProduct.maxFlavorsBySize || {}) } as Record<string, number>;
                    availableSizeKeys.forEach((sizeKey) => {
                        const raw = current[sizeKey];
                        if (!Number.isFinite(Number(raw)) || Number(raw) <= 0) {
                            current[sizeKey] = defaults[sizeKey] || 1;
                        }
                    });
                    return current;
                })()
              : newProduct.maxFlavorsBySize,
          pricingStrategiesAllowed: newProduct.pricingStrategiesAllowed,
          defaultPricingStrategy: newProduct.defaultPricingStrategy,
          customerCanChoosePricingStrategy: newProduct.customerCanChoosePricingStrategy,
          availableFlavorIds: newProduct.availableFlavorIds || [],
          optionGroups: newProduct.optionGroups || []
      };
      try {
          const savedProduct = await saveProduct(productToSave);
          if (newProduct.id) setProducts(products.map(p => p.id === savedProduct.id ? savedProduct : p));
          else setProducts([savedProduct, ...products]);
          const nextCategory = (savedProduct.category || '').toString().trim();
          if (nextCategory) {
              const exists = menuCategories.some(
                  (value) => value.toLowerCase() === nextCategory.toLowerCase()
              );
              if (!exists) {
                  await persistMenuCategories([...menuCategories, nextCategory]);
              }
          }
          setShowProductModal(false);
      } catch (e) { alert("Erro ao salvar produto."); }
  };

  const handleDeleteProduct = async (id: string) => {
      if (confirm('Tem certeza que deseja excluir este produto?')) {
          try {
              const existing = products.find((product) => product.id === id);
              if (existing?.imageFileId) {
                  try { await deleteImageKit(existing.imageFileId); } catch {}
              }
              await deleteProduct(id);
              setProducts(products.filter(p => p.id !== id));
          } catch (e) {
              alert("Erro ao excluir produto.");
          }
      }
  };

  const generateId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const getZoneType = (zone: DeliveryZone | null | undefined) => (zone?.type === 'POLYGON' ? 'POLYGON' : 'RADIUS');

  const updateDeliveryZones = (next: DeliveryZone[] | ((prev: DeliveryZone[]) => DeliveryZone[])) => {
      setStoreProfile((prev) => {
          const current = Array.isArray(prev.deliveryZones) ? prev.deliveryZones : [];
          const resolved = typeof next === 'function' ? next(current) : next;
          return { ...prev, deliveryZones: resolved };
      });
  };

  const handleCreateDeliveryZone = () => {
      const center = storeProfile.coordinates || { lat: -23.561684, lng: -46.655981 };
      const nextZone: DeliveryZone = {
          id: generateId(),
          name: `Area ${deliveryZones.length + 1}`,
          centerLat: center.lat,
          centerLng: center.lng,
          radiusMeters: 2000,
          fee: 0,
          etaMinutes: 30,
          enabled: true,
          priority: (deliveryZones.length || 0) + 1,
          type: 'RADIUS'
      };
      const next = [...deliveryZones, nextZone];
      updateDeliveryZones(next);
      setSelectedDeliveryZoneId(nextZone.id);
      setDeliveryZoneNotice('Area criada. Ajuste o raio no mapa.');
  };

  const handleCreateDeliveryPolygon = () => {
      const map = deliveryZoneMapRef.current;
      if (!map || !window.google?.maps?.drawing) {
          setDeliveryZoneError('Mapa não pronto para desenhar polígonos.');
          return;
      }
      const existing = deliveryZoneDrawingManagerRef.current;
      if (existing) {
          existing.setMap(null);
          deliveryZoneDrawingManagerRef.current = null;
      }
      const drawingManager = new window.google.maps.drawing.DrawingManager({
          drawingMode: window.google.maps.drawing.OverlayType.POLYGON,
          drawingControl: false,
          polygonOptions: {
              editable: true,
              draggable: true,
              fillColor: '#ef4444',
              fillOpacity: 0.2,
              strokeColor: '#ef4444',
              strokeWeight: 2
          }
      });
      drawingManager.setMap(map);
      deliveryZoneDrawingManagerRef.current = drawingManager;
      setDeliveryZoneNotice('Desenhe o polígono no mapa.');

      const listener = window.google.maps.event.addListener(drawingManager, 'overlaycomplete', (event: any) => {
          if (event.type !== window.google.maps.drawing.OverlayType.POLYGON) return;
          const path = event.overlay.getPath().getArray().map((point: any) => ({
              lat: point.lat(),
              lng: point.lng()
          }));
          event.overlay.setMap(null);
          window.google.maps.event.removeListener(listener);
          drawingManager.setMap(null);
          deliveryZoneDrawingManagerRef.current = null;

          const nextZone: DeliveryZone = {
              id: generateId(),
              name: `Area ${deliveryZones.length + 1}`,
              centerLat: path[0]?.lat ?? (storeProfile.coordinates?.lat || -23.561684),
              centerLng: path[0]?.lng ?? (storeProfile.coordinates?.lng || -46.655981),
              radiusMeters: 0,
              fee: 0,
              etaMinutes: 30,
              enabled: true,
              priority: (deliveryZones.length || 0) + 1,
              type: 'POLYGON',
              polygonPath: path
          };
          updateDeliveryZones((current) => [...current, nextZone]);
          setSelectedDeliveryZoneId(nextZone.id);
          setDeliveryZoneNotice('Polígono criado. Ajuste os pontos no mapa.');
      });
  };

  const handleUpdateDeliveryZone = (zoneId: string, updates: Partial<DeliveryZone>) => {
      updateDeliveryZones((current) =>
          current.map((zone) => (zone.id === zoneId ? { ...zone, ...updates } : zone))
      );
  };

  const handleDeleteDeliveryZone = async (zoneId: string) => {
      if (!confirm('Deseja remover esta area de entrega?')) return;
      const next = deliveryZones.filter((zone) => zone.id !== zoneId);
      updateDeliveryZones(next);
      if (selectedDeliveryZoneId === zoneId) {
          setSelectedDeliveryZoneId(next[0]?.id || null);
      }
      if (!storeId) return;
      try {
          await updateStore(storeId, { deliveryZones: next });
          setDeliveryZoneNotice('Area removida e salva.');
      } catch (error) {
          setDeliveryZoneError('Não foi possível salvar a remoção da área.');
      }
  };

  const resetTemplateDraft = (template?: OptionGroupTemplate | null) => {
      if (template) {
          setTemplateDraft({
              ...template,
              options: (template.options || []).map((opt, idx) => ({
                  ...opt,
                  order: opt.order ?? idx + 1
              })),
              linkedCategoryIds: Array.isArray(template.linkedCategoryIds)
                  ? [...template.linkedCategoryIds]
                  : undefined
          });
      } else {
          setTemplateDraft({
              storeId: storeId || '',
              name: '',
              min: 0,
              max: 1,
              options: [],
              isRequired: false,
              selectionType: 'SINGLE',
              extraChargeAfter: 0,
              extraChargeAmount: 0,
              linkedCategoryIds: undefined
          });
      }
      setTemplateError(null);
      setTemplateNotice(null);
  };

  const handleAddTemplateOption = () => {
      setTemplateDraft((prev) => {
          const options = [...(prev.options || [])];
          options.push({
              id: generateId(),
              name: '',
              price: 0,
              isAvailable: true,
              order: options.length + 1
          });
          return { ...prev, options };
      });
  };

  const handleUpdateTemplateOption = (optionId: string, field: keyof ProductOption, value: any) => {
      setTemplateDraft((prev) => ({
          ...prev,
          options: (prev.options || []).map((opt) => (opt.id === optionId ? { ...opt, [field]: value } : opt))
      }));
  };

  const handleRemoveTemplateOption = (optionId: string) => {
      setTemplateDraft((prev) => ({
          ...prev,
          options: (prev.options || []).filter((opt) => opt.id !== optionId)
      }));
  };

  const handleSaveTemplate = async () => {
      if (!storeId) return;
      const name = (templateDraft.name || '').trim();
      if (!name) {
          setTemplateError('Informe o nome do grupo.');
          return;
      }
      const min = Number(templateDraft.min ?? 0);
      const max = Number(templateDraft.max ?? 0);
      if (Number.isNaN(min) || Number.isNaN(max) || min > max) {
          setTemplateError('Minimo nao pode ser maior que o maximo.');
          return;
      }
      const rawLinkedCategories = Array.isArray(templateDraft.linkedCategoryIds)
          ? templateDraft.linkedCategoryIds
                .map((value) => value.trim())
                .filter(Boolean)
          : [];
      const allowedCategories = new Set(menuCategories.map(normalizeCategoryValue));
      const linkedCategoryIds = rawLinkedCategories.filter((value, index, self) => {
          if (self.findIndex((item) => normalizeCategoryValue(item) === normalizeCategoryValue(value)) !== index) {
              return false;
          }
          if (allowedCategories.size > 0 && !allowedCategories.has(normalizeCategoryValue(value))) {
              return false;
          }
          return true;
      });
      const payloadBase = {
          storeId,
          name,
          min,
          max,
          options: (templateDraft.options || []).map((opt, idx) => ({
              ...opt,
              order: opt.order ?? idx + 1
          })),
          isRequired: templateDraft.isRequired ?? false,
          selectionType: templateDraft.selectionType || (max === 1 ? 'SINGLE' : 'MULTIPLE'),
          extraChargeAfter: Number(templateDraft.extraChargeAfter || 0),
          extraChargeAmount: Number(templateDraft.extraChargeAmount || 0),
          ...(linkedCategoryIds.length > 0 ? { linkedCategoryIds } : {})
      };
      const payload = templateDraft.id ? { ...payloadBase, id: templateDraft.id } : payloadBase;
      try {
          const saved = await saveOptionGroupTemplate(payload as OptionGroupTemplate & { id?: string });
          setOptionGroupTemplates((prev) => {
              const exists = prev.find((item) => item.id === saved.id);
              if (exists) {
                  return prev.map((item) => (item.id === saved.id ? saved : item));
              }
              return [...prev, saved];
          });
          setTemplateNotice('Template salvo');
          setTemplateDraft({});
      } catch (error) {
          console.error(error);
          setTemplateError('Falha ao salvar template.');
      }
  };

  const handleEditTemplate = (template: OptionGroupTemplate) => {
      resetTemplateDraft(template);
  };

  const handleDuplicateTemplate = async (template: OptionGroupTemplate) => {
      if (!storeId) return;
      const payload = {
          ...template,
          id: undefined,
          storeId,
          name: `${template.name} (copia)`
      };
      try {
          const saved = await saveOptionGroupTemplate(payload as OptionGroupTemplate & { id?: string });
          setOptionGroupTemplates((prev) => [...prev, saved]);
          setTemplateNotice('Template duplicado');
      } catch (error) {
          console.error(error);
          setTemplateError('Falha ao duplicar template.');
      }
  };

  const handleDeleteTemplate = async (templateId: string) => {
      if (!confirm('Deseja excluir este template?')) return;
      try {
          await deleteOptionGroupTemplate(templateId);
          setOptionGroupTemplates((prev) => prev.filter((item) => item.id !== templateId));
      } catch (error) {
          console.error(error);
          setTemplateError('Falha ao excluir template.');
      }
  };

  const handleApplySelectedTemplates = () => {
      const templates = optionGroupTemplates
          .filter((template) => selectedTemplateIds.includes(template.id))
          .filter((template) => !isTemplateApplied(template));
      if (templates.length === 0) {
          setSelectedTemplateIds([]);
          setTemplateNotice('Templates já aplicados');
          return;
      }
      const existingGroups = newProduct.optionGroups || [];
      const nextGroups = [...existingGroups];
      const baseOrder = nextGroups.length;
      templates.forEach((template, index) => {
          const baseName = template.name || 'Grupo';
          let finalName = baseName;
          let suffix = 1;
          while (nextGroups.some((group) => (group.name || '').toLowerCase() === finalName.toLowerCase())) {
              suffix += 1;
              finalName = `${baseName} (${suffix})`;
          }
          const options = (template.options || []).map((opt, optIndex) => ({
              ...opt,
              id: generateId(),
              order: opt.order ?? optIndex + 1
          }));
          nextGroups.push({
              id: generateId(),
              templateId: template.id,
              name: finalName,
              min: template.min ?? 0,
              max: template.max ?? 1,
              options,
              isRequired: template.isRequired,
              selectionType: template.selectionType || (template.max === 1 ? 'SINGLE' : 'MULTIPLE'),
              order: baseOrder + index + 1,
              extraChargeAfter: template.extraChargeAfter ?? 0,
              extraChargeAmount: template.extraChargeAmount ?? 0
          });
      });
      setNewProduct((prev) => ({ ...prev, optionGroups: nextGroups }));
      setSelectedTemplateIds([]);
      setTemplateNotice('Complementos adicionados ao produto');
  };

  const handleToggleTemplateSelection = (templateId: string, checked: boolean) => {
      setSelectedTemplateIds((prev) =>
          checked ? [...prev, templateId] : prev.filter((id) => id !== templateId)
      );
  };

  const handleAddBuildableGroup = () => {
      const newGroup: ProductOptionGroup = {
          id: generateId(),
          name: 'Novo Grupo (ex: Acompanhamentos)',
          min: 0,
          max: 1,
          options: [],
          isRequired: false,
          selectionType: 'SINGLE',
          order: (buildableProduct.optionGroups?.length || 0) + 1,
          extraChargeAfter: 0,
          extraChargeAmount: 0
      };
      setBuildableProduct(prev => ({ ...prev, optionGroups: [...(prev.optionGroups || []), newGroup] }));
  };

  const handleAddSizeGroup = () => {
      setBuildableProduct(prev => {
          const exists = (prev.optionGroups || []).some(group => (group.name || '').toLowerCase() === 'tamanho');
          if (exists) return prev;
          const sizeGroup: ProductOptionGroup = {
              id: generateId(),
              name: 'Tamanho',
              min: 1,
              max: 1,
              options: [
                  { id: generateId(), name: 'Pequeno', price: 0, isAvailable: true, order: 1, stockProductId: '' },
                  { id: generateId(), name: 'Medio', price: 4, isAvailable: true, order: 2, stockProductId: '' },
                  { id: generateId(), name: 'Grande', price: 8, isAvailable: true, order: 3, stockProductId: '' }
              ],
              isRequired: true,
              selectionType: 'SINGLE',
              order: (prev.optionGroups?.length || 0) + 1,
              extraChargeAfter: 0,
              extraChargeAmount: 0
          };
          return { ...prev, optionGroups: [...(prev.optionGroups || []), sizeGroup] };
      });
  };

  const handleUpdateBuildableGroup = (groupId: string, field: keyof ProductOptionGroup, value: any) => {
      setBuildableProduct(prev => ({
          ...prev,
          optionGroups: prev.optionGroups?.map(g => g.id === groupId ? { ...g, [field]: value } : g)
      }));
  };

  const handlePatchBuildableGroup = (groupId: string, updates: Partial<ProductOptionGroup>) => {
      setBuildableProduct(prev => ({
          ...prev,
          optionGroups: prev.optionGroups?.map(g => g.id === groupId ? { ...g, ...updates } : g)
      }));
  };

  const handleRemoveBuildableGroup = (groupId: string) => {
      setBuildableProduct(prev => ({
          ...prev,
          optionGroups: prev.optionGroups?.filter(g => g.id !== groupId)
      }));
  };

  const handleAddBuildableOption = (groupId: string) => {
      setBuildableProduct(prev => ({
          ...prev,
          optionGroups: prev.optionGroups?.map(g => {
              if (g.id !== groupId) return g;
              const newOption: ProductOption = {
                  id: generateId(),
                  name: 'Novo Item',
                  price: 0,
                  isAvailable: true,
                  order: (g.options?.length || 0) + 1,
                  stockProductId: ''
              };
              return { ...g, options: [...g.options, newOption] };
          })
      }));
  };

  const handleUpdateBuildableOption = (groupId: string, optionId: string, field: keyof ProductOption, value: any) => {
      setBuildableProduct(prev => ({
          ...prev,
          optionGroups: prev.optionGroups?.map(g => {
              if (g.id !== groupId) return g;
              return { ...g, options: g.options.map(o => o.id === optionId ? { ...o, [field]: value } : o) };
          })
      }));
  };

  const handleRemoveBuildableOption = (groupId: string, optionId: string) => {
      setBuildableProduct(prev => ({
          ...prev,
          optionGroups: prev.optionGroups?.map(g => {
              if (g.id !== groupId) return g;
              return { ...g, options: g.options.filter(o => o.id !== optionId) };
          })
      }));
  };

  const handleApplyBuildableTemplate = (template: 'MARMITA' | 'PIZZA' | 'LANCHE') => {
      const createOption = (name: string, price: number, order: number): ProductOption => ({
          id: generateId(),
          name,
          price,
          isAvailable: true,
          order,
          stockProductId: ''
      });
      const createGroup = (data: {
          name: string;
          min: number;
          max: number;
          selectionType: 'SINGLE' | 'MULTIPLE';
          order: number;
          isRequired: boolean;
          extraChargeAfter?: number;
          extraChargeAmount?: number;
          options: ProductOption[];
      }): ProductOptionGroup => ({
          id: generateId(),
          name: data.name,
          min: data.min,
          max: data.max,
          options: data.options,
          isRequired: data.isRequired,
          selectionType: data.selectionType,
          order: data.order,
          extraChargeAfter: data.extraChargeAfter || 0,
          extraChargeAmount: data.extraChargeAmount || 0
      });

      let templateProduct: Partial<Product> = {};
      if (template === 'MARMITA') {
          templateProduct = {
              name: 'Marmita Montável',
              category: 'Marmitas',
              price: 25,
              priceMode: 'BASE',
              description: 'Monte sua marmita do jeito que quiser.',
              isAvailable: true,
              isBuildable: true,
              isPizza: false,
              optionGroups: [
                  createGroup({
                      name: 'Tamanho',
                      min: 1,
                      max: 1,
                      selectionType: 'SINGLE',
                      order: 1,
                      isRequired: true,
                      options: [
                          createOption('Pequena', 0, 1),
                          createOption('Media', 3, 2),
                          createOption('Grande', 6, 3)
                      ]
                  }),
                  createGroup({
                      name: 'Proteina',
                      min: 1,
                      max: 2,
                      selectionType: 'MULTIPLE',
                      order: 2,
                      isRequired: true,
                      extraChargeAfter: 1,
                      extraChargeAmount: 4,
                      options: [
                          createOption('Frango', 0, 1),
                          createOption('Carne', 2, 2),
                          createOption('Peixe', 3, 3)
                      ]
                  }),
                  createGroup({
                      name: 'Acompanhamentos',
                      min: 2,
                      max: 3,
                      selectionType: 'MULTIPLE',
                      order: 3,
                      isRequired: true,
                      options: [
                          createOption('Arroz', 0, 1),
                          createOption('Feijao', 0, 2),
                          createOption('Salada', 0, 3),
                          createOption('Legumes', 0, 4)
                      ]
                  }),
                  createGroup({
                      name: 'Extras',
                      min: 0,
                      max: 5,
                      selectionType: 'MULTIPLE',
                      order: 4,
                      isRequired: false,
                      options: [
                          createOption('Ovo', 2, 1),
                          createOption('Bacon', 3, 2),
                          createOption('Queijo', 2, 3)
                      ]
                  })
              ]
          };
      }
      if (template === 'PIZZA') {
          templateProduct = {
              name: 'Pizza Montável',
              category: 'Pizzas',
              price: 0,
              priceMode: 'BY_SIZE',
              description: 'Escolha tamanho, sabores e extras.',
              isAvailable: true,
              isBuildable: true,
              isPizza: false,
              optionGroups: [
                  createGroup({
                      name: 'Tamanho',
                      min: 1,
                      max: 1,
                      selectionType: 'SINGLE',
                      order: 1,
                      isRequired: true,
                      options: [
                          createOption('Broto', 22, 1),
                          createOption('Media', 30, 2),
                          createOption('Grande', 38, 3)
                      ]
                  }),
                  createGroup({
                      name: 'Sabores',
                      min: 1,
                      max: 2,
                      selectionType: 'MULTIPLE',
                      order: 2,
                      isRequired: true,
                      extraChargeAfter: 1,
                      extraChargeAmount: 5,
                      options: [
                          createOption('Calabresa', 0, 1),
                          createOption('Mussarela', 0, 2),
                          createOption('Portuguesa', 0, 3),
                          createOption('Frango com catupiry', 2, 4)
                      ]
                  }),
                  createGroup({
                      name: 'Extras',
                      min: 0,
                      max: 4,
                      selectionType: 'MULTIPLE',
                      order: 3,
                      isRequired: false,
                      options: [
                          createOption('Borda recheada', 6, 1),
                          createOption('Molho especial', 2, 2),
                          createOption('Mais queijo', 4, 3)
                      ]
                  })
              ]
          };
      }
      if (template === 'LANCHE') {
          templateProduct = {
              name: 'Lanche Montável',
              category: 'Lanches',
              price: 18,
              priceMode: 'BASE',
              description: 'Escolha pao, proteina e extras.',
              isAvailable: true,
              isBuildable: true,
              isPizza: false,
              optionGroups: [
                  createGroup({
                      name: 'Pao',
                      min: 1,
                      max: 1,
                      selectionType: 'SINGLE',
                      order: 1,
                      isRequired: true,
                      options: [
                          createOption('Brioche', 0, 1),
                          createOption('Australiano', 2, 2),
                          createOption('Tradicional', 0, 3)
                      ]
                  }),
                  createGroup({
                      name: 'Proteina',
                      min: 1,
                      max: 1,
                      selectionType: 'SINGLE',
                      order: 2,
                      isRequired: true,
                      options: [
                          createOption('Hamburguer', 0, 1),
                          createOption('Frango crispy', 3, 2),
                          createOption('Veggie', 2, 3)
                      ]
                  }),
                  createGroup({
                      name: 'Adicionais',
                      min: 0,
                      max: 4,
                      selectionType: 'MULTIPLE',
                      order: 3,
                      isRequired: false,
                      options: [
                          createOption('Queijo', 2, 1),
                          createOption('Bacon', 3, 2),
                          createOption('Ovo', 2, 3),
                          createOption('Cebola caramelizada', 2, 4)
                      ]
                  })
              ]
          };
      }

      setBuildableProduct({
          ...templateProduct,
          imageUrl: '',
          promoPrice: undefined
      });
      setShowBuildableProductModal(true);
  };

  const handleEditBuildableProduct = (product: Product) => {
      setBuildableProduct({
          ...product,
          isBuildable: true,
          priceMode: product.priceMode || (product.price > 0 ? 'BASE' : 'BY_SIZE')
      });
      setBuildableError(null);
      setShowBuildableProductModal(true);
  };

  const handleSaveBuildableProduct = async () => {
      if (!storeId) return;
      if (!buildableProduct.name) { setBuildableError('Nome e obrigatorio.'); return; }

      const priceMode = buildableProduct.priceMode || 'BASE';
      const basePrice = Number(buildableProduct.price || 0);
      if (priceMode === 'BASE' && (!Number.isFinite(basePrice) || basePrice < 0)) {
          setBuildableError('Preço base deve ser zero ou maior.');
          return;
      }
      if (priceMode === 'BY_SIZE' && (buildableProduct.optionGroups || []).length === 0) {
          setBuildableError('Adicione pelo menos um grupo de tamanho para preços.');
          return;
      }

      const productToSave: Omit<Product, 'id'> & { id?: string } = {
          id: buildableProduct.id,
          storeId,
          name: buildableProduct.name,
          description: buildableProduct.description || '',
          price: basePrice,
          promoPrice: buildableProduct.promoPrice ? Number(buildableProduct.promoPrice) : undefined,
          category: buildableProduct.category || 'Montáveis',
          imageUrl: buildableProduct.imageUrl || '',
          imageFileId: buildableProduct.imageFileId,
          isAvailable: buildableProduct.isAvailable !== undefined ? buildableProduct.isAvailable : true,
          isBuildable: true,
          priceMode: priceMode,
          isPizza: false,
          allowHalfHalf: false,
          maxFlavors: 1,
          optionGroups: buildableProduct.optionGroups || []
      };

      try {
          const savedProduct = await saveProduct(productToSave);
          if (buildableProduct.id) setProducts(products.map(p => p.id === savedProduct.id ? savedProduct : p));
          else setProducts([savedProduct, ...products]);
          const nextCategory = (savedProduct.category || '').toString().trim();
          if (nextCategory) {
              const exists = menuCategories.some(
                  (value) => value.toLowerCase() === nextCategory.toLowerCase()
              );
              if (!exists) {
                  await persistMenuCategories([...menuCategories, nextCategory]);
              }
          }
          setShowBuildableProductModal(false);
          setBuildableProduct({});
          setBuildableError(null);
      } catch (e) { alert("Erro ao salvar produto montável."); }
  };

  // --- Pizza Flavor Handlers ---
      const handleSaveFlavor = async () => {
      if (!storeId || !newFlavor.name) return;
      const normalizedPrices = normalizeFlavorPrices(newFlavor.pricesBySize as Record<string, unknown>);
      const hasInvalid = Object.values(newFlavor.pricesBySize || {}).some((value) => {
          if (value === '' || value === null || value === undefined) return false;
          const parsed = Number(value);
          return !Number.isFinite(parsed) || parsed <= 0;
      });
      if (hasInvalid) {
          alert('Preços devem ser maiores que zero. Deixe vazio para remover.');
          return;
      }
      const flavorToSave: PizzaFlavor = {
          id: newFlavor.id || '',
          storeId,
          name: newFlavor.name,
          description: newFlavor.description || '',
          isAvailable: newFlavor.isAvailable ?? true,
          pricesBySize: normalizedPrices
      };
      try {
          const payload = newFlavor.id ? flavorToSave : { ...flavorToSave, id: undefined };
          const savedFlavor = await savePizzaFlavor(payload as PizzaFlavor);
          if(newFlavor.id) setPizzaFlavors(prev => prev.map(f => f.id === savedFlavor.id ? savedFlavor : f));
          else setPizzaFlavors(prev => [...prev, savedFlavor]);
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
          id: newTransaction.id || '',
          storeId: storeId,
          description: newTransaction.description,
          type: newTransaction.type || 'EXPENSE',
          amount: Number(newTransaction.amount), date: newTransaction.date || new Date().toISOString().split('T')[0], category: newTransaction.category || 'OUTROS_SAIDA', status: newTransaction.status || 'PAID'
      };
      try {
          const payload = newTransaction.id ? transactionToSave : { ...transactionToSave, id: undefined };
          const savedTransaction = await saveExpense(payload as FinancialTransaction & { storeId?: string });
          if (newTransaction.id) setTransactions(prev => prev.map(e => e.id === savedTransaction.id ? savedTransaction : e));
          else setTransactions(prev => [...prev, savedTransaction]);
          setShowTransactionModal(false);
      } catch (e) { alert("Erro ao salvar transação."); }
  };
  const handleSaveCourier = async () => {
      if (!storeId || !newCourier.name) return;
      const courierToSave: Courier & { storeId: string } = { id: newCourier.id || '', storeId, name: newCourier.name, phone: newCourier.phone || '', plate: newCourier.plate || '', commissionRate: Number(newCourier.commissionRate), isActive: newCourier.isActive ?? true };
      try {
          const payload = newCourier.id ? courierToSave : { ...courierToSave, id: undefined };
          const savedCourier = await saveCourier(payload as Courier & { storeId?: string });
          if (newCourier.id) setCouriers(prev => prev.map(c => c.id === savedCourier.id ? savedCourier : c));
          else setCouriers(prev => [...prev, savedCourier]);
          setShowCourierModal(false);
      } catch (e) { alert("Erro ao salvar entregador."); }
  };
  const handleDeleteCourier = async (id: string) => {
      if(confirm('Excluir entregador?')) { try { await deleteCourier(id); setCouriers(prev => prev.filter(c => c.id !== id)); } catch(e) { alert("Erro ao excluir"); } }
  };
  const handleSaveCoupon = async () => {
      if (!editingCoupon.code || !editingCoupon.discountValue) return;
      const couponToSave: Coupon = { id: editingCoupon.id || '', code: editingCoupon.code.toUpperCase(), discountType: editingCoupon.discountType || 'PERCENTAGE', discountValue: Number(editingCoupon.discountValue), minOrderValue: Number(editingCoupon.minOrderValue) || 0, isActive: editingCoupon.isActive ?? true, description: editingCoupon.description || '', usageCount: editingCoupon.usageCount || 0, usageLimit: editingCoupon.usageLimit ? Number(editingCoupon.usageLimit) : undefined, expiresAt: editingCoupon.expiresAt };
      try {
          const payload = editingCoupon.id ? couponToSave : { ...couponToSave, id: undefined };
          const savedCoupon = await saveCoupon(payload as Coupon & { storeId?: string });
          if (editingCoupon.id) setCoupons(prev => prev.map(c => c.id === savedCoupon.id ? savedCoupon : c));
          else setCoupons(prev => [...prev, savedCoupon]);
          setShowCouponModal(false);
      } catch(e) { alert("Erro ao salvar cupom."); }
  };
  const handleDeleteCoupon = async (id: string) => {
      if(confirm("Excluir cupom?")) { try { await deleteCoupon(id); setCoupons(prev => prev.filter(c => c.id !== id)); } catch(e) { alert("Erro ao excluir"); } }
  };
  const showToast = (message: string, tone: 'error' | 'success' = 'error') => {
      setToast({ message, tone });
      setTimeout(() => setToast(null), 4000);
  };
  const handleUpdateStatus = async (orderId: string, status: string, reason?: string) => {
      let snapshot: Order[] | null = null;
      setOrders((prev) => {
          snapshot = prev;
          return prev.map((order) =>
              order.id === orderId
                  ? {
                        ...order,
                        status: status as Order['status'],
                        cancelReason: status === 'CANCELLED' ? reason || order.cancelReason : order.cancelReason
                    }
                  : order
          );
      });
      setSelectedOrderDetails((prev) =>
          prev && prev.id === orderId
              ? {
                    ...prev,
                    status: status as Order['status'],
                    cancelReason: status === 'CANCELLED' ? reason || prev.cancelReason : prev.cancelReason
                }
              : prev
      );
      try {
          await updateOrderStatus(orderId, status as Order['status'], reason);
      } catch (e) {
          if (snapshot) {
              setOrders(snapshot);
          }
          const message = e instanceof Error ? e.message : 'Erro ao atualizar status.';
          showToast(message);
      }
  };

  const handlePrintOrder = async (orderId: string) => {
      try {
          await printOrder(orderId);
          showToast('Pedido enviado para impressão.', 'success');
      } catch (e) {
          showToast('Erro ao enviar para impressão.');
      }
  };

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
      if (!GEO_API_ENABLED) { alert("Busca de CEP desativada temporariamente."); return; }
      const cepData = await fetchCepData(addressForm.cep);
      if (cepData) {
          setAddressForm(prev => ({
              ...prev,
              street: cepData.street,
              district: cepData.district,
              city: cepData.city,
              state: cepData.state
          }));
      } else if (addressForm.cep.replace(/\D/g, '').length === 8) {
          alert("CEP não encontrado.");
      }
  };
  const handleGeocodeAddress = async () => {
      if (!GEO_API_ENABLED) { alert("Geolocalização desativada temporariamente."); return; }
      if (!addressForm.street || !addressForm.number || !addressForm.city) { alert("Preencha Rua, Número e Cidade para buscar."); return; }
      const query = `${addressForm.street}, ${addressForm.number} - ${addressForm.district}, ${addressForm.city}`;
      try { const results = await searchAddress(query); if (results && results.length > 0) { setStoreProfile(prev => ({ ...prev, coordinates: results[0].coordinates })); alert("Localização atualizada com sucesso no mapa!"); } else { alert("Endereço não encontrado."); } } catch (e) { alert("Erro ao buscar localização."); }
  };

  const updateDeliveryNeighborhoods = (next: DeliveryNeighborhood[]) => {
      setStoreProfile((prev) => ({ ...prev, deliveryNeighborhoods: next, neighborhoodFees: next }));
  };

  const handleToggleNeighborhood = (index: number, active: boolean) => {
      const next = deliveryNeighborhoods.map((item, idx) =>
          idx === index ? { ...item, active } : item
      );
      updateDeliveryNeighborhoods(next);
  };

  const handleNeighborhoodFeeChange = (index: number, value: string) => {
      const fee = value === '' ? 0 : Number(value);
      const next = deliveryNeighborhoods.map((item, idx) =>
          idx === index ? { ...item, fee: Number.isFinite(fee) ? fee : 0 } : item
      );
      updateDeliveryNeighborhoods(next);
  };

  const handleMarkAllNeighborhoods = (active: boolean) => {
      updateDeliveryNeighborhoods(deliveryNeighborhoods.map((item) => ({ ...item, active })));
  };

  const handleAddManualNeighborhood = () => {
      const name = manualNeighborhoodName.trim();
      if (!name) return;
      const fee = Number(manualNeighborhoodFee || 0);
      const normalized = name.toLowerCase();
      if (deliveryNeighborhoods.some((item) => (item.name || '').toLowerCase() === normalized)) {
          alert('Este bairro já existe.');
          return;
      }
      const next = [
          ...deliveryNeighborhoods,
          {
              name,
              active: true,
              fee: Number.isFinite(fee) ? fee : 0
          }
      ];
      updateDeliveryNeighborhoods(next);
      setManualNeighborhoodName('');
      setManualNeighborhoodFee('');
  };

  const importNeighborhoods = async (force = false) => {
      if (!storeId) return;
      if (!force && deliveryNeighborhoods.length > 0) return;
      if (!storeProfile.city) {
          setDeliveryNeighborhoodError('Informe a cidade da loja para buscar bairros.');
          return;
      }
      setDeliveryNeighborhoodLoading(true);
      setDeliveryNeighborhoodError(null);
      setDeliveryNeighborhoodInfo(null);
      try {
          const result = await importNeighborhoodsForStore(storeId, {
              city: storeProfile.city || '',
              state: storeProfile.state
          });
          const neighborhoods = Array.isArray(result.neighborhoods) ? result.neighborhoods : [];
          if (!neighborhoods || neighborhoods.length === 0) {
              setDeliveryNeighborhoodError('Nenhum bairro encontrado. Adicione manualmente.');
              return;
          }
          if (result.meta?.partial) {
              setDeliveryNeighborhoodError('Importação parcial por limite do Google. Você pode continuar manualmente.');
          }
          if (force) {
              if (result.addedCount > 0) {
                  setDeliveryNeighborhoodInfo(`+${result.addedCount} bairros adicionados (Total: ${result.totalCount}).`);
              } else {
                  setDeliveryNeighborhoodError('Nenhum bairro novo encontrado nesta rodada. Tente novamente ou adicione manualmente.');
              }
          }
          setStoreProfile((prev) => ({
              ...prev,
              deliveryNeighborhoods: neighborhoods,
              neighborhoodFees: neighborhoods,
              neighborhoodFeesImportedAt: result.neighborhoodFeesImportedAt || prev.neighborhoodFeesImportedAt,
              neighborhoodFeesSource: result.neighborhoodFeesSource || prev.neighborhoodFeesSource,
              neighborhoodImportState: result.neighborhoodImportState || prev.neighborhoodImportState
          }));
      } catch (error: any) {
          if (error?.code === 'google_api_error') {
              setDeliveryNeighborhoodError('Google API bloqueou a consulta (verifique billing/restrições).');
          } else {
              setDeliveryNeighborhoodError('Erro ao buscar bairros. Adicione manualmente.');
          }
      } finally {
          setDeliveryNeighborhoodLoading(false);
      }
  };
  const handleSaveStoreSettings = async () => {
      if (!storeId || !storeProfile) return;
      try {
          if (storeProfile.deliveryFeeMode === 'BY_NEIGHBORHOOD') {
              const list = Array.isArray(storeProfile.neighborhoodFees)
                  ? storeProfile.neighborhoodFees
                  : Array.isArray(storeProfile.deliveryNeighborhoods)
                  ? storeProfile.deliveryNeighborhoods
                  : [];
              if (list.length === 0) {
                  alert('Importe ou cadastre bairros antes de salvar.');
                  return;
              }
          }
          if (storeProfile.deliveryFeeMode === 'BY_RADIUS') {
              const zones = Array.isArray(storeProfile.deliveryZones) ? storeProfile.deliveryZones : [];
              const enabledZones = zones.filter((zone) => zone.enabled !== false);
              if (zones.length === 0) {
                  alert('Crie ao menos uma área de entrega.');
                  return;
              }
              if (enabledZones.length === 0) {
                  alert('Ative ao menos uma área de entrega.');
                  return;
              }
              const invalidZone = enabledZones.find(
                  (zone) =>
                      !zone.name ||
                      (getZoneType(zone) === 'POLYGON'
                          ? !Array.isArray(zone.polygonPath) || zone.polygonPath.length < 3
                          : Number(zone.radiusMeters || 0) <= 0 ||
                            !Number.isFinite(Number(zone.centerLat)) ||
                            !Number.isFinite(Number(zone.centerLng)))
              );
              if (invalidZone) {
                  alert('Verifique os dados das áreas (nome, raio e centro).');
                  return;
              }
          }
          if (
              storeProfile.delivery_min_order_value !== undefined &&
              Number(storeProfile.delivery_min_order_value) < 0
          ) {
              alert('O valor mínimo para entrega deve ser zero ou maior.');
              return;
          }
          const {
              schedule,
              autoOpenClose,
              autoAcceptOrders,
              ...rest
          } = storeProfile;
          const payload = { ...rest, ...addressForm, paymentMethods };
          await updateStore(storeId, payload);
          if (schedule && schedule.length > 0) {
              await updateStoreSchedule(storeId, schedule, autoOpenClose);
          }
          if (typeof autoAcceptOrders === 'boolean') {
              await updateStoreAutoAccept(storeId, autoAcceptOrders);
          }
          await refreshAvailability();
          alert("Configurações salvas com sucesso!");
      } catch (e) {
          alert("Erro ao salvar configurações.");
      }
  };

  const handleSavePixRepasse = async () => {
      if (!storeId) return;
      setPixRepasseError(null);
      setPixRepasseNotice(null);
      if (pixRepasseConfig.pix_enabled) {
          if (!pixRepasseConfig.pix_hash_recebedor_01.trim() || !pixRepasseConfig.pix_hash_recebedor_02.trim()) {
              setPixRepasseError('Informe os dois hashes para habilitar o PIX.');
              return;
          }
      }
      setPixRepasseLoading(true);
      try {
          const response = await updatePixRepasseConfig({
              storeId,
              pix_enabled: pixRepasseConfig.pix_enabled,
              pix_hash_recebedor_01: pixRepasseConfig.pix_hash_recebedor_01,
              pix_hash_recebedor_02: pixRepasseConfig.pix_hash_recebedor_02
          });
          setPixRepasseConfig({
              pix_enabled: !!response.pix_enabled,
              pix_hash_recebedor_01: response.pix_hash_recebedor_01 || '',
              pix_hash_recebedor_02: response.pix_hash_recebedor_02 || '',
              pix_identificacao_pdv: response.pix_identificacao_pdv || ''
          });
          setPixRepasseNotice('PIX Repasse atualizado.');
      } catch (error) {
          setPixRepasseError('Não foi possível salvar o PIX.');
      } finally {
          setPixRepasseLoading(false);
      }
  };

  const handleGenerateMerchantId = async () => {
      if (!storeId) return;
      setMerchantActionLoading(true);
      try {
          const result = await generateMerchantId(storeId);
          setStoreProfile((prev) => ({
              ...prev,
              merchantId: result.merchantId,
              merchantIdCreatedAt: result.createdAt || prev.merchantIdCreatedAt,
              merchantIdRevokedAt: null
          }));
          alert(result.status === 'existing' ? 'Merchant ID ja estava ativo.' : 'Merchant ID gerado com sucesso!');
      } catch (e) {
          alert('Erro ao gerar Merchant ID.');
      } finally {
          setMerchantActionLoading(false);
      }
  };

  const handleRevokeMerchantId = async () => {
      if (!storeId || !storeProfile.merchantId) return;
      const confirmed = window.confirm('Deseja revogar o Merchant ID desta loja?');
      if (!confirmed) return;
      setMerchantActionLoading(true);
      try {
          const result = await revokeMerchantId(storeId);
          setStoreProfile((prev) => ({
              ...prev,
              merchantId: '',
              merchantIdRevokedAt: result.revokedAt
          }));
          alert('Merchant ID revogado com sucesso.');
      } catch (e) {
          alert('Erro ao revogar Merchant ID.');
      } finally {
          setMerchantActionLoading(false);
      }
  };

  const handleCopyMerchantId = async () => {
      if (!storeProfile.merchantId) return;
      try {
          await navigator.clipboard.writeText(storeProfile.merchantId);
          alert('Merchant ID copiado.');
      } catch {
          alert('Nao foi possivel copiar o Merchant ID.');
      }
  };
  const handleTogglePaymentMethod = (id: string) => { setPaymentMethods(prev => prev.map(pm => pm.id === id ? { ...pm, active: !pm.active } : pm)); };
  const normalizeSlug = (value: string) =>
      (value || '')
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');
  const getStoreSlug = () => {
      const custom = storeProfile.customUrl ? normalizeSlug(storeProfile.customUrl) : '';
      if (custom) return custom;
      if (storeProfile.name) return normalizeSlug(storeProfile.name);
      return storeProfile.id || storeId || '';
  };
  const getTableQrUrl = (tableNumber: number) => {
      const slug = getStoreSlug();
      const base = window.location.origin;
      const path = slug ? `/${slug}` : '/';
      return `${base}${path}?mesa=${tableNumber}`;
  };
  const getMenuQrUrl = () => {
      const slug = getStoreSlug();
      const base = window.location.origin;
      return slug ? `${base}/${slug}` : base;
  };
  const downloadDataUrl = (dataUrl: string, filename: string) => {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      link.click();
  };
  const dataUrlToBase64 = (dataUrl: string) => {
      const split = dataUrl.split(',');
      return split.length > 1 ? split[1] : dataUrl;
  };
  const buildTableQrDataUrl = async (
      tableNumber: number,
      options?: { label?: string; url?: string }
  ) => {
      const qrCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrCanvas, options?.url || getTableQrUrl(tableNumber), { width: 512, margin: 2 });

      const label = options?.label || `Mesa ${tableNumber}`;
      const fontSize = 32;
      const labelPadding = 24;
      const labelOffset = 8;

      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = qrCanvas.width;
      finalCanvas.height = qrCanvas.height + fontSize + labelPadding;

      const ctx = finalCanvas.getContext('2d');
      if (!ctx) {
          throw new Error('Canvas não suportado.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
      ctx.drawImage(qrCanvas, 0, 0);
      ctx.fillStyle = '#111827';
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, finalCanvas.width / 2, qrCanvas.height + labelOffset);

      return finalCanvas.toDataURL('image/png');
  };

  const buildMenuQrDataUrl = async () => {
      const qrCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrCanvas, getMenuQrUrl(), { width: 512, margin: 2 });
      return qrCanvas.toDataURL('image/png');
  };

  const handleDownloadMenuQr = () => {
      if (!menuQrDataUrl) return;
      const safeName = (storeProfile.name || 'loja').toString().toLowerCase().replace(/\s+/g, '-');
      downloadDataUrl(menuQrDataUrl, `menufaz-cardapio-${safeName}.png`);
  };

  const handleCopyMenuUrl = async () => {
      try {
          await navigator.clipboard.writeText(getMenuQrUrl());
          alert('Link copiado.');
      } catch {
          alert('Nao foi possivel copiar o link.');
      }
  };

  useEffect(() => {
      let active = true;
      const loadQr = async () => {
          if (!storeProfile.name && !storeId) return;
          try {
              const dataUrl = await buildMenuQrDataUrl();
              if (active) setMenuQrDataUrl(dataUrl);
          } catch {}
      };
      loadQr();
      return () => {
          active = false;
      };
  }, [storeProfile.name, storeProfile.customUrl, storeProfile.id, storeId]);
  const handleDownloadTableQr = async (tableNumber: number) => {
      try {
          setDownloadingTable(tableNumber);
          const dataUrl = await buildTableQrDataUrl(tableNumber);
          downloadDataUrl(dataUrl, `mesa-${tableNumber}.png`);
      } catch (e) {
          alert('Erro ao gerar QR Code da mesa.');
      } finally {
          setDownloadingTable(null);
      }
  };
  const handleShowTabletQr = async (tableNumber: number) => {
      if (!storeId) return;
      try {
          setDownloadingTabletTable(tableNumber);
          const response = await createTabletQr(storeId, tableNumber.toString());
          const qrUrl = response?.qrUrl || '';
          const expiresAt = response?.expiresAt || null;
          const token = response?.token || '';
          if (!qrUrl) {
              throw new Error('qrUrl missing');
          }
          const dataUrl = await buildTableQrDataUrl(tableNumber, {
              url: qrUrl,
              label: `Mesa ${tableNumber} • QR TABLET`
          });
          setTabletQrTable(tableNumber);
          setTabletQrDataUrl(dataUrl);
          setTabletQrUrl(qrUrl);
          setTabletQrExpiresAt(expiresAt);
          setTabletQrToken(token || null);
          setTabletQrOpen(true);
          await loadTabletDevices();
      } catch (e) {
          alert('Erro ao gerar QR Code do tablet.');
      } finally {
          setDownloadingTabletTable(null);
      }
  };
  const handleDownloadAllTableQrs = async () => {
      if (!tableCountValue) {
          alert('Defina a quantidade de mesas primeiro.');
          return;
      }
      setIsDownloadingTables(true);
      try {
          const zip = new JSZip();
          for (let i = 1; i <= tableCountValue; i++) {
              const dataUrl = await buildTableQrDataUrl(i);
              zip.file(`mesa-${i}.png`, dataUrlToBase64(dataUrl), { base64: true });
          }
          const blob = await zip.generateAsync({ type: 'blob' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'qrcodes-mesas.zip';
          link.click();
          URL.revokeObjectURL(url);
      } catch (e) {
          alert('Erro ao gerar QR Codes das mesas.');
      } finally {
          setIsDownloadingTables(false);
      }
  };

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
                  {storeProfile.isFinancialBlock && (<div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/50 rounded-xl p-6 mb-8"><h3 className="text-red-700 dark:text-red-400 font-bold mb-4 flex items-center gap-2"><Banknote size={20} /> Pendência Financeira</h3><div className="grid grid-cols-2 gap-6"><div><p className="text-xs font-bold text-gray-500 uppercase">Valor</p><p className="text-3xl font-extrabold text-slate-900 dark:text-white">{formatCurrencyBRL(storeProfile.financialValue)}</p></div><div><p className="text-xs font-bold text-gray-500 uppercase">Parcelas</p><p className="text-3xl font-extrabold text-slate-900 dark:text-white">{storeProfile.financialInstallments}x</p></div></div></div>)}
                  <div className="flex gap-4"><button onClick={onBack} className="flex-1 py-4 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">Voltar</button><a href="https://wa.me/5538998074444" target="_blank" rel="noreferrer" className="flex-1 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 transition-colors"><MessageSquare size={20} /> Falar com Suporte</a></div>
              </div>
          </div>
      </div>
  );

  const renderOverview = () => {
      const today = new Date();
      const todayLabel = today.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      const ordersToday = orders.filter((o) => new Date(o.createdAt || '').toDateString() === today.toDateString());
      const revenueToday = ordersToday
          .filter((o) => o.status !== 'CANCELLED')
          .reduce((acc, o) => acc + o.total, 0);
      const pendingOrders = orders.filter((o) => o.status === 'PENDING').length;
      const avgTicket = ordersToday.length > 0 ? revenueToday / ordersToday.length : 0;
      const uniqueCustomersToday = new Set(
          ordersToday
              .map((order) => order.userId || order.customerName)
              .filter(Boolean)
      ).size;
      const weeklyMax = Math.max(1, ...weeklyRevenueData.map((item) => item.value));
      const peakDay = weeklyRevenueData.reduce((best, item) => (item.value > best.value ? item : best), weeklyRevenueData[0]);
      const deliveryCount = ordersToday.filter((o) => o.type === 'DELIVERY').length;
      const pickupCount = ordersToday.filter((o) => o.type === 'PICKUP').length;
      const tableCount = ordersToday.filter((o) => o.type === 'TABLE').length;
      const recentOrders = orders.slice(0, 5);

      return (
          <div className="animate-fade-in space-y-6 font-body">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-rose-50/60 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
                  <div className="pointer-events-none absolute -top-20 -left-24 h-48 w-48 rounded-full bg-red-200/40 blur-3xl dark:bg-red-900/20" />
                  <div className="pointer-events-none absolute -bottom-28 right-6 h-56 w-56 rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-900/20" />
                  <div className="relative space-y-6">
                      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                          <div>
                              <span className="text-xs font-bold tracking-[0.2em] text-red-500 uppercase">Visao geral</span>
                              <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white mt-2 font-display">
                                  Central de comando da loja
                              </h2>
                              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-2xl">
                                  Um painel vivo do que esta acontecendo agora, com sinais claros do que exige atencao.
                              </p>
                      </div>
                      <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 rounded-full text-xs font-bold text-slate-600 dark:text-slate-300">
                          <Calendar size={14} className="text-red-500" />
                          {todayLabel}
                      </div>
                  </div>

                  <div className="grid lg:grid-cols-[1.2fr,0.8fr] gap-6">
                      <div className="space-y-6">
                          <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-6 md:p-7 shadow-xl shadow-red-100/30 dark:shadow-none">
                              <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full border border-dashed border-red-200/60 dark:border-red-900/40" />
                              <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full border border-dashed border-orange-200/60 dark:border-orange-900/40" />
                              <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                                  <div>
                                      <p className="text-xs font-bold uppercase text-slate-400">Hoje</p>
                                      <div className="flex items-center gap-3 mt-2">
                                          <div className="w-12 h-12 rounded-2xl bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-600/20">
                                              <TrendingUp size={20} />
                                          </div>
                                          <div>
                                              <p className="text-sm text-slate-500 dark:text-slate-400">Faturamento</p>
                                              <p className="text-3xl font-extrabold text-slate-900 dark:text-white">{formatCurrencyBRL(revenueToday)}</p>
                                          </div>
                                      </div>
                                      <div className="mt-4 flex flex-wrap gap-3">
                                          <div className="px-3 py-2 rounded-xl bg-slate-100/80 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                              {ordersToday.length} pedidos hoje
                                          </div>
                                          <div className="px-3 py-2 rounded-xl bg-slate-100/80 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                              Ticket medio {formatCurrencyBRL(avgTicket)}
                                          </div>
                                          <div className={`px-3 py-2 rounded-xl text-xs font-semibold ${pendingOrders > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                              {pendingOrders > 0 ? `${pendingOrders} pendentes` : 'Fluxo limpo'}
                                          </div>
                                      </div>
                                  </div>
                                  <div className="flex-1 grid grid-cols-2 gap-3">
                                      {[
                                          { label: 'Entrega', value: deliveryCount, color: 'bg-sky-500' },
                                          { label: 'Retirada', value: pickupCount, color: 'bg-indigo-500' },
                                          { label: 'Mesa', value: tableCount, color: 'bg-emerald-500' },
                                          { label: 'Total', value: ordersToday.length, color: 'bg-red-500' }
                                      ].map((item) => (
                                          <div key={item.label} className="rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex items-center gap-3">
                                              <div className={`w-9 h-9 rounded-xl ${item.color} text-white flex items-center justify-center text-xs font-bold`}>
                                                  {item.value}
                                              </div>
                                              <div>
                                                  <p className="text-[11px] uppercase font-bold text-slate-400">{item.label}</p>
                                                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Pedidos</p>
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          </div>

                          <div className="grid md:grid-cols-3 gap-4">
                              {[
                                  {
                                      label: 'Receita semanal',
                                      value: formatCurrencyBRL(weeklyRevenueData.reduce((acc, item) => acc + item.value, 0)),
                                      hint: `Pico em ${peakDay?.name || ''}`
                                  },
                                  {
                                      label: 'Pedidos pendentes',
                                      value: pendingOrders.toString(),
                                      hint: pendingOrders > 0 ? 'Exige prioridade' : 'Tudo ok'
                                  },
                                  {
                                      label: 'Clientes novos',
                                      value: uniqueCustomersToday.toString(),
                                      hint: 'Hoje'
                                  }
                              ].map((item) => (
                                  <div key={item.label} className="rounded-3xl border border-slate-200/70 dark:border-slate-800 bg-white/95 dark:bg-slate-900/80 p-4 shadow-sm">
                                      <p className="text-xs font-bold uppercase text-slate-400">{item.label}</p>
                                      <p className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2">{item.value}</p>
                                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.hint}</p>
                                  </div>
                              ))}
                          </div>

                          <div className="rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 p-5">
                              <div className="flex items-center justify-between mb-4">
                                  <div>
                                      <p className="text-xs font-bold uppercase text-slate-400">Pulso semanal</p>
                                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Volume por dia</p>
                                  </div>
                                  <span className="text-xs font-bold text-slate-500">Max {formatCurrencyBRL(weeklyMax)}</span>
                              </div>
                              <div className="grid grid-cols-7 gap-2">
                                  {weeklyRevenueData.map((item) => (
                                      <div key={item.name} className="flex flex-col items-center gap-2">
                                          <div className="w-full h-24 bg-slate-100 dark:bg-slate-800 rounded-full flex items-end overflow-hidden">
                                              <div
                                                  className="w-full bg-gradient-to-t from-red-500 via-red-400 to-orange-300 rounded-full"
                                                  style={{ height: `${Math.max(12, (item.value / weeklyMax) * 100)}%` }}
                                              />
                                          </div>
                                          <span className="text-[10px] font-bold text-slate-400 uppercase">{item.name}</span>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      </div>

                      <div className="space-y-6">
                          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                              <div className="flex items-center justify-between mb-4">
                                  <h3 className="font-bold text-slate-800 dark:text-white">Receita em tempo real</h3>
                                  <span className="text-xs font-bold text-emerald-600">Atualizando</span>
                              </div>
                              <ChartContainer className="h-64">
                                  {({ width, height }) => (
                                      <AreaChart width={width} height={height} data={weeklyRevenueData}>
                                          <defs>
                                              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                                  <stop offset="5%" stopColor="#EF4444" stopOpacity={0.35} />
                                                  <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                                              </linearGradient>
                                          </defs>
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
                                  )}
                              </ChartContainer>
                          </div>

                          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                              <div className="flex items-center justify-between mb-4">
                                  <h3 className="font-bold text-slate-800 dark:text-white">Pedidos recentes</h3>
                                  <span className="text-xs font-bold text-slate-400">Ultimos 5</span>
                              </div>
                              <div className="space-y-4">
                                  {recentOrders.length === 0 ? (
                                      <p className="text-gray-400 text-center text-sm py-8">Nenhum pedido recente.</p>
                                  ) : (
                                      recentOrders.map((order) => (
                                          <div key={order.id} className="flex items-center gap-3 pb-3 border-b border-gray-50 last:border-0">
                                              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center font-bold text-slate-500 text-xs">
                                                  #{formatOrderNumber(order)}
                                              </div>
                                              <div className="flex-1">
                                                  <p className="font-bold text-sm text-slate-800 dark:text-white">{order.customerName}</p>
                                                  <p className="text-xs text-gray-400">{order.items.length} itens • {order.time}</p>
                                                  {order.type && (
                                                      <p className="text-[11px] text-gray-400">
                                                          {order.type === 'TABLE'
                                                              ? `Mesa${order.tableNumber ? ` ${order.tableNumber}` : ''}`
                                                              : order.type === 'PICKUP'
                                                              ? 'Retirada'
                                                              : 'Entrega'}
                                                      </p>
                                                  )}
                                              </div>
                                              <span className={`text-xs font-bold px-2 py-1 rounded-full ${order.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' : order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : order.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                                                  {ORDER_STATUS_LABELS[order.status] || order.status}
                                              </span>
                                          </div>
                                      ))
                                  )}
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      </div>
      );
  };

  const renderOrders = () => {
      const resolveOrderType = (order: Order) => {
          if (order.type) return order.type;
          if (order.pickup || order.isPickup) return 'PICKUP';
          if (order.tableNumber || order.tableSessionId) return 'TABLE';
          return 'DELIVERY';
      };
      const getStatusFlow = (order: Order) =>
          ORDER_STATUS_FLOW_BY_TYPE[resolveOrderType(order)] || ORDER_STATUS_FLOW_BY_TYPE.DEFAULT;
      const getStatusIndex = (order: Order, status?: string) => {
          if (!status) return -1;
          return getStatusFlow(order).indexOf(status as Order['status']);
      };
      const isBackwardStatus = (order: Order, next: Order['status']) => {
          const current = order.status;
          if (!current || !next || current === next) return false;
          if (current === 'COMPLETED' || current === 'CANCELLED') return true;
          if (next === 'CANCELLED') return false;
          const currentIndex = getStatusIndex(order, current);
          const nextIndex = getStatusIndex(order, next);
          if (currentIndex === -1 || nextIndex === -1) return false;
          return nextIndex < currentIndex;
      };
      const isStatusAllowed = (order: Order, status: Order['status']) =>
          getStatusFlow(order).includes(status);
      const getNextStatus = (order: Order) => {
          const flow = getStatusFlow(order);
          const currentIndex = flow.indexOf(order.status);
          if (currentIndex === -1) return null;
          const nextIndex = currentIndex + 1;
          const next = flow[nextIndex];
          if (!next || next === 'CANCELLED') return null;
          return next;
      };
      const columns = [
          { id: 'PENDING', label: 'Novos', color: 'bg-yellow-500' },
          { id: 'CONFIRMED', label: 'Confirmados', color: 'bg-slate-500' },
          { id: 'PREPARING', label: 'Em Preparo', color: 'bg-blue-500' },
          { id: 'READY_FOR_PICKUP', label: 'Pronto p/ Retirada', color: 'bg-indigo-500' },
          { id: 'READY', label: 'Pronto', color: 'bg-teal-500' },
          { id: 'WAITING_COURIER', label: 'Aguardando Motoboy', color: 'bg-purple-500' },
          { id: 'DELIVERING', label: 'Saiu para Entrega', color: 'bg-orange-500' },
          { id: 'SERVED', label: 'Entregue na Mesa', color: 'bg-emerald-600' },
          { id: 'COMPLETED', label: 'Concluídos', color: 'bg-green-500' },
          { id: 'CANCELLED', label: 'Cancelados', color: 'bg-red-500' }
      ];
      const storeAddressLine = [
          storeProfile.street,
          storeProfile.number,
          storeProfile.district,
          storeProfile.city,
          storeProfile.state
      ]
          .filter(Boolean)
          .join(', ');
      const formatOrderAddress = (order: Order) => {
          if (order.type === 'DELIVERY') {
              const address = order.deliveryAddress;
              if (!address) return 'Endereço não informado';
              const complement = (address as any)?.complement ? `, ${(address as any).complement}` : '';
              return [
                  [address.street, address.number].filter(Boolean).join(', '),
                  address.district,
                  address.city,
                  address.state
              ]
                  .filter(Boolean)
                  .join(' - ') + complement;
          }
          return storeAddressLine || 'Endereço da loja não informado';
      };
      const formatAddress = (address?: Address, fallback?: string) => {
          if (!address) return fallback || 'Não informado';
          const complement = (address as any)?.complement ? `, ${(address as any).complement}` : '';
          return [
              [address.street, address.number].filter(Boolean).join(', '),
              address.district,
              address.city,
              address.state
          ]
              .filter(Boolean)
              .join(' - ') + complement;
      };
      const handleDropOnColumn = async (columnId: string, orderId?: string) => {
          const id = orderId || draggingOrderId;
          if (!id) return;
          const current = orders.find((order) => order.id === id);
          if (!current || current.status === columnId) return;
          if (!isStatusAllowed(current, columnId as Order['status'])) {
              showToast('Status inválido para este tipo de pedido.');
              return;
          }
          if (isBackwardStatus(current, columnId as Order['status'])) {
              showToast('Não é possível voltar o status do pedido. Para manter histórico e consistência, o status só pode avançar.');
              return;
          }
          if (columnId === 'CANCELLED') {
              const reason = prompt('Motivo do cancelamento?');
              if (!reason?.trim()) return;
              await handleUpdateStatus(id, columnId, reason.trim());
              return;
          }
          await handleUpdateStatus(id, columnId);
      };

      return (
          <div className="h-[calc(100vh-140px)] flex flex-col gap-6">
              {paymentOrderTarget && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800">
                          <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-800">
                              <div>
                                  <h3 className="text-lg font-bold text-slate-800 dark:text-white">Finalizar mesa</h3>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">Pedido #{formatOrderNumber(paymentOrderTarget)}</p>
                              </div>
                              <button
                                  onClick={() => { setPaymentOrderTarget(null); setPaymentOrderMethod(''); }}
                                  className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800"
                              >
                                  <X size={18} className="text-slate-500" />
                              </button>
                          </div>
                          <div className="p-5 space-y-4">
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Forma de pagamento</label>
                                  <select
                                      value={paymentOrderMethod}
                                      onChange={(e) => setPaymentOrderMethod(e.target.value)}
                                      className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-white"
                                  >
                                      <option value="">Selecione</option>
                                      {paymentMethods.filter(pm => pm.active).length > 0 ? (
                                          paymentMethods.filter(pm => pm.active).map((pm) => (
                                              <option key={pm.id} value={pm.name}>{pm.name}</option>
                                          ))
                                      ) : (
                                          <>
                                              <option value="Dinheiro">Dinheiro</option>
                                              <option value="Pix">Pix</option>
                                              <option value="Cartão">Cartão</option>
                                          </>
                                      )}
                                  </select>
                              </div>
                          </div>
                          <div className="p-5 border-t border-gray-100 dark:border-slate-800 flex items-center justify-end gap-2">
                              <button
                                  onClick={() => { setPaymentOrderTarget(null); setPaymentOrderMethod(''); }}
                                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold hover:border-red-300"
                              >
                                  Cancelar
                              </button>
                              <button
                                  onClick={async () => {
                                      if (!paymentOrderTarget) return;
                                      if (!paymentOrderMethod) {
                                          alert('Selecione a forma de pagamento.');
                                          return;
                                      }
                                      try {
                                          await updateOrderPayment(paymentOrderTarget.id, paymentOrderMethod);
                                          await updateOrderStatus(paymentOrderTarget.id, 'COMPLETED');
                                          setPaymentOrderTarget(null);
                                          setPaymentOrderMethod('');
                                      } catch (e) {
                                          alert('Erro ao finalizar mesa.');
                                      }
                                  }}
                                  className="px-4 py-2 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700"
                              >
                                  Finalizar pedido
                              </button>
                          </div>
                      </div>
                  </div>
              )}
              <div className="px-2">
                  <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-amber-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-5 md:p-6 shadow-sm">
                      <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-900/20" />
                      <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-red-200/30 blur-3xl dark:bg-red-900/20" />
                      <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                          <div>
                              <span className="text-xs font-bold tracking-[0.2em] text-amber-600 uppercase">Pedidos</span>
                              <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-2">Quadro em tempo real</h3>
                              <p className="text-sm text-slate-500 dark:text-slate-400">Arraste o foco para o que exige acao imediata.</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                              <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                                  {orders.filter(o => o.status === 'PENDING').length} novos
                              </div>
                              <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                                  {orders.filter(o => o.status === 'PREPARING').length} em preparo
                              </div>
                              <button 
                                onClick={handleToggleAutoAccept}
                                disabled={isAutoAcceptUpdating}
                                className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs transition-all shadow-sm ${
                                  isAutoAcceptEnabled ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-slate-800 text-gray-500'
                                } ${isAutoAcceptUpdating ? 'opacity-70 cursor-not-allowed' : ''}`}
                              >
                                  {isAutoAcceptEnabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                                  {isAutoAcceptEnabled ? 'Auto-Aceitar Ativado' : 'Auto-Aceitar Desativado'}
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-6 h-full px-2">
                  {columns.map(col => {
                      const colOrders = orders.filter(o => o.status === col.id);
                      return (
                          <div
                              key={col.id}
                              onDragOver={(event) => {
                                  event.preventDefault();
                                  setDragOverColumn(col.id);
                              }}
                              onDragLeave={() => {
                                  if (dragOverColumn === col.id) setDragOverColumn(null);
                              }}
                              onDrop={(event) => {
                                  event.preventDefault();
                                  const payloadId = event.dataTransfer.getData('text/plain');
                                  handleDropOnColumn(col.id, payloadId || undefined);
                                  setDragOverColumn(null);
                                  setDraggingOrderId(null);
                              }}
                              className={`min-w-[250px] w-full max-w-[280px] flex flex-col bg-white/70 dark:bg-slate-900/80 rounded-3xl p-4 h-full border border-slate-200/80 dark:border-slate-800 shadow-sm transition-shadow ${dragOverColumn === col.id ? 'ring-2 ring-red-400 shadow-lg' : ''}`}
                          >
                              <div className="flex items-center justify-between mb-4">
                                  <div className="flex items-center gap-2">
                                      <div className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                                      <h3 className="font-extrabold text-sm text-slate-800 dark:text-white">{col.label}</h3>
                                  </div>
                                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-100">
                                      {colOrders.length}
                                  </span>
                              </div>
                              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                                  {colOrders.map(order => (
                                      <div
                                          key={order.id}
                                          draggable
                                          onDragStart={(event) => {
                                              setDraggingOrderId(order.id);
                                              event.dataTransfer.setData('text/plain', order.id);
                                              event.dataTransfer.effectAllowed = 'move';
                                          }}
                                          onDragEnd={() => setDraggingOrderId(null)}
                                          onClick={() => setSelectedOrderDetails(order)}
                                          className={`bg-white dark:bg-slate-950 p-4 rounded-2xl shadow-sm border border-slate-200/70 dark:border-slate-800 hover:shadow-md transition-shadow group relative cursor-pointer ${draggingOrderId === order.id ? 'opacity-60' : ''}`}
                                      >
                                          <div className="flex items-center justify-between mb-3">
                                              <div className="flex items-center gap-2">
                                                  <span className="font-mono text-xs text-slate-400">#{formatOrderNumber(order)}</span>
                                                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                                      {order.type === 'TABLE'
                                                          ? `Mesa${order.tableNumber ? ` ${order.tableNumber}` : ''}`
                                                          : order.type === 'PICKUP'
                                                          ? 'Retirada'
                                                          : 'Entrega'}
                                                  </span>
                                              </div>
                                              <span className="text-xs font-bold text-slate-500 dark:text-slate-300">{order.time}</span>
                                          </div>
                                          <h4 className="font-bold text-slate-800 dark:text-white mb-1 text-sm">{order.customerName}</h4>
                                          <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-2 mb-2">
                                              {order.customerPhone && (
                                                  <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
                                                      {order.customerPhone}
                                                  </span>
                                              )}
                                              {order.paymentMethod && (
                                                  <span className="px-2 py-0.5 rounded-full bg-amber-100/70 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200 font-semibold">
                                                      {order.paymentMethod}
                                                  </span>
                                              )}
                                              {order.paymentStatus === 'PAID' && (
                                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100/70 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-200 font-semibold">
                                                      PAGO
                                                  </span>
                                              )}
                                              {order.type === 'DELIVERY' && (
                                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100/70 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-200 font-semibold">
                                                      Entrega {formatCurrencyBRL(order.deliveryFee || 0)}
                                                  </span>
                                              )}
                                          </div>
                                          <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                              {formatOrderAddress(order)}
                                          </div>
                                          {order.notes && (
                                              <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 rounded-lg px-2 py-1 mb-3">
                                                  Obs: {order.notes}
                                              </div>
                                          )}
                                          
                                          {/* Updated Items List to Show Full Details (Pizzas) */}
                                          <div className="space-y-2 mb-3 bg-gray-50 dark:bg-slate-900/50 p-2 rounded-lg border border-gray-100 dark:border-slate-700">
                                              {order.items.map((item, idx) => (
                                                  <div key={idx} className="flex items-start gap-2">
                                                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full mt-1.5 shrink-0"></div>
                                                      <p className="text-xs text-gray-600 dark:text-gray-300 leading-snug">{item}</p>
                                                  </div>
                                              ))}
                                          </div>
                                          
                                          {order.status === 'CANCELLED' && order.cancelReason && (
                                              <div className="mb-3 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 rounded-lg px-2 py-1">
                                                  Motivo: {order.cancelReason}
                                              </div>
                                          )}

                                          <div className="flex justify-between items-center border-t border-gray-100 dark:border-slate-700 pt-3">
                                              <div className="flex flex-col">
                                                  <span className="font-bold text-slate-800 dark:text-white text-sm">{formatCurrencyBRL(order.total)}</span>
                                                  {order.type && (
                                                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                                          {order.type === 'TABLE'
                                                              ? `Mesa${order.tableNumber ? ` ${order.tableNumber}` : ''}`
                                                              : order.type === 'PICKUP'
                                                              ? 'Retirada'
                                                              : 'Entrega'}
                                                      </span>
                                                  )}
                                              </div>
                                              <div className="flex flex-col items-end gap-2">
                                                  {(() => {
                                                      const orderType = resolveOrderType(order);
                                                      const nextStatus = getNextStatus(order);
                                                      const advanceLabel = (() => {
                                                          if (!nextStatus) return '';
                                                          if (nextStatus === 'CONFIRMED') return 'Confirmar';
                                                          if (nextStatus === 'PREPARING') return 'Iniciar preparo';
                                                          if (nextStatus === 'READY_FOR_PICKUP') return 'Pronto p/ Retirada';
                                                          if (nextStatus === 'READY') return 'Pronto';
                                                          if (nextStatus === 'SERVED') return 'Entregue na Mesa';
                                                          if (nextStatus === 'WAITING_COURIER') return 'Chamar Motoboy';
                                                          if (nextStatus === 'DELIVERING') return 'Saiu para Entrega';
                                                          if (nextStatus === 'COMPLETED') {
                                                              return orderType === 'PICKUP' ? 'Confirmar Retirada' : 'Concluir';
                                                          }
                                                          return 'Avançar';
                                                      })();

                                                      if (!nextStatus || !advanceLabel) return null;
                                                      return (
                                                          <button
                                                              onClick={(event) => {
                                                                  event.stopPropagation();
                                                                  if (orderType === 'TABLE' && nextStatus === 'COMPLETED') {
                                                                      setPaymentOrderTarget(order);
                                                                      setPaymentOrderMethod('');
                                                                      return;
                                                                  }
                                                                  handleUpdateStatus(order.id, nextStatus);
                                                              }}
                                                              className="px-3 py-1.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
                                                          >
                                                              {advanceLabel}
                                                          </button>
                                                      );
                                                  })()}
                                                  {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                                                      <button
                                                          onClick={(event) => {
                                                              event.stopPropagation();
                                                              const reason = prompt('Motivo do cancelamento?');
                                                              if (!reason?.trim()) return;
                                                              handleUpdateStatus(order.id, 'CANCELLED', reason.trim());
                                                          }}
                                                          className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
                                                      >
                                                          Cancelar
                                                      </button>
                                                  )}
                                                  {col.id === 'WAITING_COURIER' && (
                                                      <span className="text-xs font-bold text-purple-600 animate-pulse">Aguardando...</span>
                                                  )}
                                              </div>
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          </div>
                      );
                  })}
              </div>
              {selectedOrderDetails && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
                      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-800 overflow-hidden">
                          <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-800">
                              <div>
                                  <h3 className="text-lg font-bold text-slate-800 dark:text-white">Detalhes do pedido</h3>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">#{formatOrderNumber(selectedOrderDetails)}</p>
                              </div>
                              <button
                                  onClick={() => setSelectedOrderDetails(null)}
                                  className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800"
                              >
                                  <X size={18} className="text-slate-500" />
                              </button>
                          </div>
                          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase">Status</p>
                                      <p className="font-semibold text-slate-800 dark:text-white">
                                          {ORDER_STATUS_LABELS[selectedOrderDetails.status] || selectedOrderDetails.status}
                                      </p>
                                  </div>
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase">Horario</p>
                                      <p className="font-semibold text-slate-800 dark:text-white">{selectedOrderDetails.time || '-'}</p>
                                  </div>
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase">Cliente</p>
                                      <p className="font-semibold text-slate-800 dark:text-white">{selectedOrderDetails.customerName}</p>
                                      {selectedOrderDetails.customerPhone && <p className="text-xs text-slate-500">{selectedOrderDetails.customerPhone}</p>}
                                  </div>
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase">Pagamento</p>
                                      <p className="font-semibold text-slate-800 dark:text-white">{selectedOrderDetails.paymentMethod || 'Nao informado'}</p>
                                      {selectedOrderDetails.paymentStatus === 'PAID' && (
                                          <p className="text-xs font-bold text-emerald-600 mt-1">
                                              {selectedOrderDetails.paymentProvider === 'PIX_REPASSE' ? 'Pago via PIX' : 'PAGO'}
                                          </p>
                                      )}
                                  </div>
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase">Tipo</p>
                                      <p className="font-semibold text-slate-800 dark:text-white">
                                          {selectedOrderDetails.type === 'TABLE'
                                              ? `Mesa ${selectedOrderDetails.tableNumber || ''}`
                                              : selectedOrderDetails.type === 'PICKUP'
                                              ? 'Retirada'
                                              : 'Entrega'}
                                      </p>
                                  </div>
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase">Total</p>
                                      <p className="font-semibold text-slate-800 dark:text-white">{formatCurrencyBRL(selectedOrderDetails.total)}</p>
                                  </div>
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase">Taxa entrega</p>
                                      <p className="font-semibold text-slate-800 dark:text-white">{formatCurrencyBRL(selectedOrderDetails.deliveryFee || 0)}</p>
                                  </div>
                                  {selectedOrderDetails.cpf && (
                                      <div>
                                          <p className="text-xs font-bold text-slate-400 uppercase">CPF</p>
                                          <p className="font-semibold text-slate-800 dark:text-white">{selectedOrderDetails.cpf}</p>
                                      </div>
                                  )}
                              </div>
                              <div>
                                  <p className="text-xs font-bold text-slate-400 uppercase mb-2">Endereco</p>
                                  <p className="text-sm text-slate-700 dark:text-slate-200">
                                      {selectedOrderDetails.type === 'DELIVERY'
                                          ? formatAddress(selectedOrderDetails.deliveryAddress, 'Nao informado')
                                          : storeAddressLine || 'Nao informado'}
                                  </p>
                              </div>
                              {selectedOrderDetails.notes && (
                                  <div>
                                      <p className="text-xs font-bold text-slate-400 uppercase mb-2">Observacoes</p>
                                      <p className="text-sm text-slate-700 dark:text-slate-200">{selectedOrderDetails.notes}</p>
                                  </div>
                              )}
                              {selectedOrderDetails.cancelReason && (
                                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 rounded-xl p-3 text-sm text-red-600">
                                      Motivo do cancelamento: {selectedOrderDetails.cancelReason}
                                  </div>
                              )}
                              <div>
                                  <p className="text-xs font-bold text-slate-400 uppercase mb-2">Itens</p>
                                  <div className="space-y-2">
                                      {selectedOrderDetails.items.map((item, idx) => (
                                          <div key={idx} className="text-sm text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-800 pb-2">
                                              {item}
                                          </div>
                                      ))}
                                  </div>
                              </div>
                          </div>
                          <div className="p-5 border-t border-gray-100 dark:border-slate-800 flex flex-wrap items-center justify-end gap-3">
                              <button
                                  onClick={() => handlePrintOrder(selectedOrderDetails.id)}
                                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50"
                              >
                                  Imprimir pedido
                              </button>
                              {selectedOrderDetails.type === 'DELIVERY' && (
                                  <button
                                      onClick={() => printDeliveryCourier(selectedOrderDetails.id)}
                                      className="px-4 py-2 rounded-xl border border-emerald-200 text-emerald-700 font-bold hover:bg-emerald-50"
                                  >
                                      Imprimir delivery
                                  </button>
                              )}
                              {selectedOrderDetails.status !== 'COMPLETED' && selectedOrderDetails.status !== 'CANCELLED' && (
                                  <button
                                      onClick={() => {
                                          const reason = prompt('Motivo do cancelamento?');
                                          if (!reason?.trim()) return;
                                          handleUpdateStatus(selectedOrderDetails.id, 'CANCELLED', reason.trim());
                                          setSelectedOrderDetails(null);
                                      }}
                                      className="px-4 py-2 rounded-xl border border-red-200 text-red-600 font-bold hover:bg-red-50"
                                  >
                                      Cancelar
                                  </button>
                              )}
                              {(() => {
                                  const nextStatus = getNextStatus(selectedOrderDetails);
                                  const orderType = resolveOrderType(selectedOrderDetails);
                                  if (!nextStatus || ['COMPLETED', 'CANCELLED'].includes(selectedOrderDetails.status)) {
                                      return null;
                                  }
                                  const label =
                                      nextStatus === 'CONFIRMED'
                                          ? 'Confirmar'
                                          : nextStatus === 'PREPARING'
                                          ? 'Iniciar preparo'
                                          : nextStatus === 'READY_FOR_PICKUP'
                                          ? 'Pronto p/ Retirada'
                                          : nextStatus === 'READY'
                                          ? 'Pronto'
                                          : nextStatus === 'SERVED'
                                          ? 'Entregue na mesa'
                                          : nextStatus === 'WAITING_COURIER'
                                          ? 'Chamar Motoboy'
                                          : nextStatus === 'DELIVERING'
                                          ? 'Saiu para Entrega'
                                          : nextStatus === 'COMPLETED'
                                          ? orderType === 'PICKUP'
                                              ? 'Confirmar Retirada'
                                              : 'Concluir'
                                          : 'Avançar';
                                  return (
                                      <button
                                          onClick={() => {
                                              if (orderType === 'TABLE' && nextStatus === 'COMPLETED') {
                                                  setPaymentOrderTarget(selectedOrderDetails);
                                                  setPaymentOrderMethod('');
                                                  return;
                                              }
                                              handleUpdateStatus(selectedOrderDetails.id, nextStatus);
                                              setSelectedOrderDetails(null);
                                          }}
                                          className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold hover:opacity-90"
                                      >
                                          {label}
                                      </button>
                                  );
                              })()}
                          </div>
                      </div>
                  </div>
              )}
          </div>
      );
  };

  const renderTables = () => {
      const tableOrders = orders.filter((order) => order.type === 'TABLE');
      const grouped = tableOrders.reduce<Record<string, Order[]>>((acc, order) => {
          const key = order.tableNumber || 'Sem mesa';
          if (!acc[key]) acc[key] = [];
          acc[key].push(order);
          return acc;
      }, {});
      const groupKeys = Object.keys(grouped);
      const selectedTableOrders = selectedTableKey ? grouped[selectedTableKey] || [] : [];
      const activePaymentOptions = paymentMethods.filter((pm) => pm.active);
      const totalTableRevenue = tableOrders.reduce((sum, order) => sum + (order.total || 0), 0);
      const pendingTableOrders = tableOrders.filter(
          (order) => !['COMPLETED', 'CANCELLED'].includes(order.status)
      ).length;

      const handleFinalizeTable = async () => {
          if (!selectedTableKey) return;
          if (!selectedTablePayment) {
              alert('Selecione a forma de pagamento.');
              return;
          }
          const pendingOrders = selectedTableOrders.filter(
              (order) => !['COMPLETED', 'CANCELLED'].includes(order.status)
          );
          if (pendingOrders.length === 0) {
              setSelectedTableKey(null);
              return;
          }
          if (!confirm(`Finalizar mesa ${selectedTableKey} com ${pendingOrders.length} pedido(s)?`)) return;
          try {
              await Promise.all(
                  pendingOrders.map(async (order) => {
                      await updateOrderPayment(order.id, selectedTablePayment);
                      await updateOrderStatus(order.id, 'COMPLETED');
                  })
              );
              setSelectedTableKey(null);
              setSelectedTablePayment('');
          } catch (e) {
              alert('Erro ao finalizar mesa.');
          }
      };

      const handlePrintTableBill = () => {
          if (!selectedTableKey) return;
          const total = selectedTableOrders.reduce((sum, order) => sum + (order.total || 0), 0);
          const rows = selectedTableOrders
              .map((order) => {
                  const items = order.items
                      .map((item) => {
                          const match = item.match(/^(\d+)x\s(.+)/i);
                          const quantity = match ? match[1] : '';
                          const description = match ? match[2] : item;
                          return `
                            <div class="item-row">
                              <div class="item-left">
                                ${quantity ? `<span class="item-qty">${quantity}x</span>` : ''}
                                <span class="item-desc">${description}</span>
                              </div>
                            </div>
                          `;
                      })
                      .join('');
                  const payment = order.paymentMethod || 'Pagamento na mesa';
                  return `
                    <div class="order">
                      <div class="order-header">
                        <span>Pedido #${formatOrderNumber(order)}</span>
                        <span>${order.time}</span>
                      </div>
                      <div class="order-name">${order.customerName || ''}</div>
                      <div class="order-items">${items}</div>
                      <div class="order-footer">
                        <span>Pagamento: ${payment}</span>
                        <span class="order-total">${formatCurrencyBRL(order.total)}</span>
                      </div>
                    </div>
                  `;
              })
              .join('');
          const now = new Date();
          const printedAt = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
          const storePhone = storeProfile.phone || storeProfile.whatsapp || '';
          const storeAddress = [
              storeProfile.street,
              storeProfile.number,
              storeProfile.district,
              storeProfile.city,
              storeProfile.state
          ]
              .filter(Boolean)
              .join(', ');
          const html = `
            <html>
              <head>
                <title>Conta Mesa ${selectedTableKey}</title>
                <style>
                  @page { size: 80mm 297mm; margin: 2mm; }
                  * { box-sizing: border-box; }
                  body { font-family: "Courier New", monospace; color: #111; margin: 0; }
                  .ticket { width: 80mm; margin: 0; padding: 0 2mm; min-height: 293mm; display: flex; flex-direction: column; }
                  .content { flex: 1; display: flex; flex-direction: column; }
                  .center { text-align: center; }
                  .title { font-size: 14px; font-weight: bold; letter-spacing: 1px; }
                  .subtitle { font-size: 10px; margin-top: 2px; }
                  .meta { font-size: 10px; margin-top: 6px; }
                  .divider { border-top: 1px dashed #111; margin: 8px 0; }
                  .order { border: 1px dashed #111; padding: 6px; margin-bottom: 8px; }
                  .order-header { display: flex; justify-content: space-between; font-size: 10px; }
                  .order-name { font-weight: bold; margin: 4px 0; font-size: 11px; }
                  .order-items { display: grid; gap: 4px; font-size: 10px; }
                  .item-row { display: flex; justify-content: space-between; }
                  .item-left { display: flex; gap: 4px; }
                  .item-qty { font-weight: bold; }
                  .order-footer { display: flex; justify-content: space-between; font-size: 10px; margin-top: 6px; }
                  .order-total { font-weight: bold; }
                  .total { display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; margin-top: 8px; }
                  .note { font-size: 9px; margin-top: 8px; text-align: center; }
                  @media print {
                    body { margin: 0; }
                    .ticket { width: 80mm; padding: 0 2mm; }
                  }
                </style>
              </head>
              <body>
                <div class="ticket">
                  <div class="center">
                    <div class="title">${storeProfile.name || 'MenuFaz'}</div>
                    ${storeAddress ? `<div class="subtitle">${storeAddress}</div>` : ''}
                    ${storePhone ? `<div class="subtitle">Tel: ${storePhone}</div>` : ''}
                    <div class="meta">Mesa ${selectedTableKey} • ${printedAt}</div>
                  </div>
                  <div class="divider"></div>
                  <div class="content">
                    ${rows || '<div class="center subtitle">Sem pedidos.</div>'}
                  </div>
                  <div class="divider"></div>
                  <div class="total">
                    <span>TOTAL</span>
                    <span>${formatCurrencyBRL(total)}</span>
                  </div>
                  <div class="note">Comprovante nao fiscal</div>
                </div>
              </body>
            </html>
          `;
          const printWindow = window.open('', '_blank', 'width=480,height=640');
          if (!printWindow) {
              alert('Não foi possível abrir a impressão.');
              return;
          }
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
      };

      return (
          <div className="animate-fade-in space-y-6">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-sky-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
                  <div className="pointer-events-none absolute -top-16 -left-10 h-44 w-44 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-900/20" />
                  <div className="pointer-events-none absolute -bottom-20 right-6 h-52 w-52 rounded-full bg-emerald-200/30 blur-3xl dark:bg-emerald-900/20" />
                  <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-6">
                      <div>
                          <span className="text-xs font-bold tracking-[0.2em] text-sky-600 uppercase">Mesas</span>
                          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Sala em tempo real</h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                              Acompanhe mesas ativas, pedidos em aberto e finalize com rapidez.
                          </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                          <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {groupKeys.length} mesas ativas
                          </div>
                          <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {pendingTableOrders} pedidos pendentes
                          </div>
                          <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {formatCurrencyBRL(totalTableRevenue)} em mesa
                          </div>
                          <button
                              onClick={() => { setActiveSection('SETTINGS'); setSettingsTab('DELIVERY'); }}
                              className="px-4 py-2 rounded-xl font-bold text-sm border border-slate-200/80 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800"
                          >
                              Configurar mesas
                          </button>
                      </div>
                  </div>

                  {groupKeys.length === 0 ? (
                      <div className="bg-white/80 dark:bg-slate-900/70 border border-dashed border-slate-200/80 dark:border-slate-700 rounded-2xl p-8 text-sm text-slate-500">
                          Nenhum pedido de mesa no momento.
                      </div>
                  ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          {groupKeys.map((key) => {
                              const tablePending = grouped[key].filter(
                                  (order) => !['COMPLETED', 'CANCELLED'].includes(order.status)
                              ).length;
                              const tableTotal = grouped[key].reduce((sum, order) => sum + (order.total || 0), 0);

                              return (
                                  <button
                                      key={key}
                                      onClick={() => setSelectedTableKey(key)}
                                      className="rounded-3xl border border-slate-200/80 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 p-4 text-left hover:border-sky-300 dark:hover:border-sky-600 transition-colors shadow-sm"
                                  >
                                      <div className="flex items-center justify-between mb-4">
                                          <div className="flex items-center gap-3">
                                              <div className="w-10 h-10 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-200">
                                                  <Table size={18} />
                                              </div>
                                              <div>
                                                  <p className="text-sm font-extrabold text-slate-800 dark:text-white">Mesa {key}</p>
                                                  <p className="text-xs text-slate-500 dark:text-slate-400">{grouped[key].length} pedidos</p>
                                              </div>
                                          </div>
                                          <div className="text-right">
                                              <p className="text-xs font-bold text-slate-400 uppercase">Pendentes</p>
                                              <p className="text-sm font-extrabold text-slate-800 dark:text-white">{tablePending}</p>
                                          </div>
                                      </div>
                                      <div className="flex items-center justify-between mb-4">
                                          <span className="text-xs font-bold text-slate-400 uppercase">Total mesa</span>
                                          <span className="text-sm font-extrabold text-slate-800 dark:text-white">{formatCurrencyBRL(tableTotal)}</span>
                                      </div>
                                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                          {grouped[key].map((order) => (
                                              <div key={order.id} className="bg-white dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800 rounded-2xl p-3">
                                                  <div className="flex items-center justify-between text-xs text-slate-400">
                                                      <span>#{formatOrderNumber(order)}</span>
                                                      <span>{order.time}</span>
                                                  </div>
                                                  <p className="text-sm font-bold text-slate-800 dark:text-white mt-2">{order.customerName}</p>
                                                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{order.items.length} itens • {formatCurrencyBRL(order.total)}</p>
                                              </div>
                                          ))}
                                      </div>
                                  </button>
                              );
                          })}
                      </div>
                  )}
              </div>
              {selectedTableKey && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                      <div className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                          <div className="p-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                              <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                      <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-200">
                                          <Table size={20} />
                                      </div>
                                      <div>
                                          <h3 className="text-lg font-extrabold text-slate-800 dark:text-white">Mesa {selectedTableKey}</h3>
                                          <p className="text-xs text-slate-500 dark:text-slate-400">{selectedTableOrders.length} pedidos</p>
                                      </div>
                                  </div>
                                  <button onClick={() => { setSelectedTableKey(null); setSelectedTablePayment(''); }} className="p-2 rounded-full hover:bg-slate-200/60 dark:hover:bg-slate-800">
                                      <X size={18} className="text-slate-500" />
                                  </button>
                              </div>
                          </div>
                          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto bg-white dark:bg-slate-900">
                              {selectedTableOrders.map((order) => (
                                  <div key={order.id} className="border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 bg-slate-50/70 dark:bg-slate-800/40">
                                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                          <span>#{formatOrderNumber(order)}</span>
                                          <span>{order.time}</span>
                                      </div>
                                      <div className="flex items-center justify-between mt-2">
                                          <p className="text-sm font-bold text-slate-800 dark:text-white">{order.customerName}</p>
                                          <span className="text-xs font-bold text-slate-400 uppercase">
                                              {ORDER_STATUS_LABELS[order.status] || order.status}
                                          </span>
                                      </div>
                                      <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                          {order.items.map((item, idx) => (
                                              <div key={`${order.id}-${idx}`}>• {item}</div>
                                          ))}
                                      </div>
                                      <div className="text-right font-extrabold text-slate-800 dark:text-white mt-3">{formatCurrencyBRL(order.total)}</div>
                                  </div>
                              ))}
                          </div>
                          <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3 bg-slate-50 dark:bg-slate-900">
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Forma de pagamento</label>
                                  <select
                                      value={selectedTablePayment}
                                      onChange={(e) => setSelectedTablePayment(e.target.value)}
                                      className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-white"
                                  >
                                      <option value="">Selecione</option>
                                      {activePaymentOptions.length > 0 ? (
                                          activePaymentOptions.map((pm) => (
                                              <option key={pm.id} value={pm.name}>{pm.name}</option>
                                          ))
                                      ) : (
                                          <>
                                              <option value="Dinheiro">Dinheiro</option>
                                              <option value="Pix">Pix</option>
                                              <option value="Cartão">Cartão</option>
                                          </>
                                      )}
                                  </select>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                  <button
                                      onClick={handlePrintTableBill}
                                      className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold hover:border-red-300"
                                  >
                                      Imprimir conta
                                  </button>
                                  <button
                                      onClick={handleFinalizeTable}
                                      className="px-4 py-2 rounded-xl bg-green-600 text-white font-bold hover:bg-green-700"
                                  >
                                      Finalizar mesa
                                  </button>
                              </div>
                          </div>
                      </div>
                  </div>
              )}
          </div>
      );
  };

  const normalizeCategoryName = (value: string) => value.trim();

  const normalizeFlavorPrices = (value?: Record<string, unknown>) => {
      const output: Record<string, number> = {};
      if (!value) return output;
      PIZZA_SIZE_OPTIONS.forEach((size) => {
          if (!Object.prototype.hasOwnProperty.call(value, size.key)) return;
          const raw = (value as Record<string, unknown>)[size.key];
          if (raw === '' || raw === null || raw === undefined) return;
          const parsed = Number(raw);
          if (Number.isFinite(parsed) && parsed > 0) {
              output[size.key] = parsed;
          }
      });
      return output;
  };

  const normalizePizzaProduct = (product: Partial<Product>) => {
      if (!product.isPizza) return product;
      const allowed = product.pricingStrategiesAllowed || ['NORMAL', 'PROPORCIONAL', 'MAX'];
      return {
          ...product,
          optionGroups: ensurePizzaSizeGroup(product.optionGroups),
          maxFlavorsBySize: product.maxFlavorsBySize || {
              brotinho: 2,
              pequena: 2,
              media: 3,
              grande: 4,
              familia: 5
          },
          pricingStrategiesAllowed: allowed,
          defaultPricingStrategy: product.defaultPricingStrategy || allowed[0] || 'NORMAL',
          customerCanChoosePricingStrategy: product.customerCanChoosePricingStrategy ?? true
      };
  };

  const pizzaSizeGroupForForm = newProduct.isPizza
      ? (newProduct.optionGroups || []).find((group) => isPizzaSizeGroup(group))
      : null;
  const pizzaAvailableSizeKeys = new Set(
      (pizzaSizeGroupForForm?.options || [])
          .filter((opt) => opt.isAvailable !== false)
          .map((opt) => getSizeKeyFromOption(opt))
          .filter(Boolean)
  );

  const categorySensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const persistMenuCategories = async (next: string[]) => {
      if (!storeId) return;
      setIsSavingCategories(true);
      try {
          setMenuCategories(next);
          setStoreProfile((prev) => ({ ...prev, menuCategories: next }));
          await updateStore(storeId, { menuCategories: next });
      } catch (error) {
          console.error('Erro ao salvar categorias', error);
          alert('Erro ao salvar categorias.');
      } finally {
          setIsSavingCategories(false);
      }
  };

  useEffect(() => {
      if (!categoryOrderDirty) return;
      const timer = setTimeout(async () => {
          await persistMenuCategories(menuCategories);
          setCategoryOrderDirty(false);
          setCategoryOrderNotice('Ordem atualizada');
          setTimeout(() => setCategoryOrderNotice(null), 2000);
      }, 500);
      return () => clearTimeout(timer);
  }, [categoryOrderDirty, menuCategories]);

  const handleAddMenuCategory = async () => {
      const normalized = normalizeCategoryName(newCategoryName);
      if (!normalized) return;
      const exists = menuCategories.some(
          (value) => value.toLowerCase() === normalized.toLowerCase()
      );
      if (exists) {
          setNewCategoryName('');
          return;
      }
      await persistMenuCategories([...menuCategories, normalized]);
      setNewCategoryName('');
  };

  const handleStartEditCategory = (category: string) => {
      setEditingCategory(category);
      setEditingCategoryName(category);
  };

  const handleCancelEditCategory = () => {
      setEditingCategory(null);
      setEditingCategoryName('');
  };

  const handleRenameMenuCategory = async (previousName: string, nextName: string) => {
      if (!storeId) return;
      const normalized = normalizeCategoryName(nextName);
      if (!normalized) {
          showToast('Informe um nome de categoria válido.');
          return;
      }
      const duplicate = menuCategories.some(
          (value) =>
              normalizeCategoryValue(value) === normalizeCategoryValue(normalized) &&
              normalizeCategoryValue(value) !== normalizeCategoryValue(previousName)
      );
      if (duplicate) {
          showToast('Já existe uma categoria com esse nome.');
          return;
      }

      const nextCategories = menuCategories.map((value) =>
          value === previousName ? normalized : value
      );
      setMenuCategories(nextCategories);
      setStoreProfile((prev) => ({ ...prev, menuCategories: nextCategories }));
      setEditingCategory(null);
      setEditingCategoryName('');

      const affectedProducts = products.filter(
          (product) => normalizeCategoryValue(product.category || '') === normalizeCategoryValue(previousName)
      );
      if (affectedProducts.length > 0) {
          setProducts((prev) =>
              prev.map((product) =>
                  normalizeCategoryValue(product.category || '') === normalizeCategoryValue(previousName)
                      ? { ...product, category: normalized }
                      : product
              )
          );
      }
      if (normalizeCategoryValue(newProduct.category || '') === normalizeCategoryValue(previousName)) {
          setNewProduct((prev) => ({ ...prev, category: normalized }));
      }
      if (normalizeCategoryValue(buildableProduct.category || '') === normalizeCategoryValue(previousName)) {
          setBuildableProduct((prev) => ({ ...prev, category: normalized }));
      }

      const updatedTemplates = optionGroupTemplates.map((template) => {
          if (!Array.isArray(template.linkedCategoryIds) || template.linkedCategoryIds.length === 0) {
              return template;
          }
          const nextLinked = template.linkedCategoryIds.map((value) =>
              normalizeCategoryValue(value) === normalizeCategoryValue(previousName) ? normalized : value
          );
          if (nextLinked.join('|') === template.linkedCategoryIds.join('|')) return template;
          return { ...template, linkedCategoryIds: nextLinked };
      });
      setOptionGroupTemplates(updatedTemplates);
      const changedTemplates = updatedTemplates.filter(
          (template, index) => template !== optionGroupTemplates[index]
      );

      try {
          await updateStore(storeId, { menuCategories: nextCategories });
          if (affectedProducts.length > 0) {
              await Promise.all(
                  affectedProducts.map((product) =>
                      saveProduct({ ...product, category: normalized })
                  )
              );
          }
          if (changedTemplates.length > 0) {
              await Promise.all(changedTemplates.map((template) => saveOptionGroupTemplate(template)));
          }
          showToast('Categoria atualizada com sucesso.', 'success');
      } catch (error) {
          showToast('Erro ao atualizar categoria.');
      }
  };

  const handleRemoveMenuCategory = async (category: string) => {
      const next = menuCategories.filter((value) => value !== category);
      if (editingCategory === category) {
          setEditingCategory(null);
          setEditingCategoryName('');
      }
      await persistMenuCategories(next);
  };

  const handleToggleProductAvailability = async (product: Product) => {
      const nextAvailable = !(product.isAvailable ?? true);
      setProducts((prev) =>
          prev.map((item) =>
              item.id === product.id ? { ...item, isAvailable: nextAvailable } : item
          )
      );
      try {
          const savedProduct = await saveProduct({ ...product, isAvailable: nextAvailable });
          setProducts((prev) =>
              prev.map((item) => (item.id === savedProduct.id ? savedProduct : item))
          );
      } catch (error) {
          setProducts((prev) =>
              prev.map((item) =>
                  item.id === product.id ? { ...item, isAvailable: product.isAvailable } : item
              )
          );
          showToast('Erro ao atualizar disponibilidade do produto.');
      }
  };

  const handleCategoryDragEnd = (event: any) => {
      const { active, over } = event || {};
      if (!active || !over || active.id === over.id) return;
      setMenuCategories((prev) => {
          const oldIndex = prev.findIndex((item) => item === active.id);
          const newIndex = prev.findIndex((item) => item === over.id);
          if (oldIndex < 0 || newIndex < 0) return prev;
          return arrayMove(prev, oldIndex, newIndex);
      });
      setCategoryOrderNotice(null);
      setCategoryOrderDirty(true);
  };

  const renderMenu = () => {
      const derivedCategories = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
      const categories = Array.from(new Set([...menuCategories, ...derivedCategories]));
      const filteredProducts = products.filter(p => 
          (selectedCategoryTab === 'Todos' || p.category === selectedCategoryTab) &&
          (p.name || '').toLowerCase().includes(menuSearch.toLowerCase())
      );

      return (
          <div className="animate-fade-in space-y-6">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-rose-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
                  <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-rose-200/40 blur-3xl dark:bg-rose-900/20" />
                  <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-orange-200/30 blur-3xl dark:bg-orange-900/20" />
                  <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                      <div>
                          <span className="text-xs font-bold tracking-[0.2em] text-rose-600 uppercase">Cardapio</span>
                          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Colecao de produtos</h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                              Organize categorias, destaque pizzas e deixe o cardapio impecavel.
                          </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                          <button onClick={() => { setNewProduct({ isAvailable: true }); setSelectedTemplateIds([]); setTemplateNotice(null); setShowProductModal(true); }} className="bg-white dark:bg-slate-800 text-slate-600 dark:text-white border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                              <Plus size={18} /> Novo item
                          </button>
                          <button
                              onClick={() => setShowCategoryModal(true)}
                              className="bg-white dark:bg-slate-800 text-slate-600 dark:text-white border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                              <Tag size={18} /> Categorias
                          </button>
                          <button
                              onClick={() => {
                                  resetTemplateDraft(null);
                                  setShowOptionGroupTemplateModal(true);
                              }}
                              className="bg-white dark:bg-slate-800 text-slate-600 dark:text-white border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                              <Layers size={18} /> Complementos prontos
                          </button>
                          <button onClick={() => { setNewFlavor({ pricesBySize: normalizeFlavorPrices() }); setShowFlavorModal(true); }} className="bg-orange-500 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-600 transition-colors shadow-lg shadow-orange-500/20">
                              <Database size={18} /> Sabores de pizza
                          </button>
                      </div>
                  </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-2 overflow-x-auto pb-2">
                      <button onClick={() => setSelectedCategoryTab('Todos')} className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${selectedCategoryTab === 'Todos' ? 'bg-red-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Todos</button>
                      {categories.map(cat => (
                          <button key={cat} onClick={() => setSelectedCategoryTab(cat)} className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-colors ${selectedCategoryTab === cat ? 'bg-red-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>{cat}</button>
                      ))}
                  </div>
                  <div className="ml-auto relative w-full lg:w-80">
                      <input 
                        type="text" 
                        placeholder="Buscar item no cardapio..." 
                        value={menuSearch} 
                        onChange={(e) => setMenuSearch(e.target.value)} 
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-white focus:ring-2 focus:ring-red-500 outline-none" 
                      />
                      <Search className="absolute left-3 top-3.5 text-slate-400" size={20} />
                  </div>
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
                                  <button onClick={() => { setNewProduct(normalizePizzaProduct(product)); setSelectedTemplateIds([]); setTemplateNotice(null); setShowProductModal(true); }} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"><Edit size={16} /></button>
                                      <button onClick={() => handleDeleteProduct(product.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash size={16} /></button>
                                  </div>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1 mb-auto">{product.description}</p>
                              <div className="flex justify-between items-end mt-3 pt-3 border-t border-gray-50 dark:border-slate-800">
                                  <div className="flex flex-col">
                                      {product.promoPrice ? (
                                          <>
                                              <span className="text-xs text-gray-400 line-through">{formatCurrencyBRL(product.price)}</span>
                                              <span className="font-bold text-green-600">{formatCurrencyBRL(product.promoPrice)}</span>
                                          </>
                                      ) : (
                                          <span className="font-bold text-slate-800 dark:text-white">{formatCurrencyBRL(product.price)}</span>
                                      )}
                                  </div>
                                  <label className="flex items-center cursor-pointer" title={product.isAvailable ? 'Disponível' : 'Indisponível'}>
                                      <input
                                          type="checkbox"
                                          checked={product.isAvailable}
                                          onChange={() => handleToggleProductAvailability(product)}
                                          className="sr-only peer"
                                      />
                                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 dark:peer-checked:bg-emerald-500"></div>
                                  </label>
                              </div>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      );
  };

  const renderStock = () => {
      const filtered = stockProducts.filter((product) =>
          (product.name || '').toLowerCase().includes(stockSearch.trim().toLowerCase())
      );
      return (
          <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                      <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">Estoque</h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                          Controle as quantidades disponíveis por produto.
                      </p>
                  </div>
                  <div className="flex items-center gap-2">
                      <div className="relative">
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                              type="text"
                              value={stockSearch}
                              onChange={(e) => setStockSearch(e.target.value)}
                              placeholder="Buscar produto"
                              className="pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
                          />
                      </div>
                  </div>
              </div>
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                  {stockLoading ? (
                      <div className="p-6 text-sm text-gray-500">Carregando estoque...</div>
                  ) : filtered.length === 0 ? (
                      <div className="p-6 text-sm text-gray-500">Nenhum produto encontrado.</div>
                  ) : (
                      <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                              <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                                  <tr>
                                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Produto</th>
                                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Preço</th>
                                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Estoque atual</th>
                                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Editar</th>
                                      <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Ação</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                  {filtered.map((product) => {
                                      const saving = Boolean(stockSavingIds[product.id]);
                                      return (
                                          <tr key={product.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                                              <td className="px-6 py-4 font-semibold text-slate-800 dark:text-slate-100">
                                                  {product.name}
                                              </td>
                                              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                                  {formatCurrencyBRL(product.price)}
                                              </td>
                                              <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                                                  {typeof product.stock_qty === 'number' ? product.stock_qty : 0}
                                              </td>
                                              <td className="px-6 py-4">
                                                  <input
                                                      type="number"
                                                      value={stockEdits[product.id] ?? ''}
                                                      onChange={(e) => handleStockInputChange(product.id, e.target.value)}
                                                      className="w-28 p-2 border rounded-lg text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                                  />
                                              </td>
                                              <td className="px-6 py-4 text-right">
                                                  <button
                                                      onClick={() => handleSaveStock(product)}
                                                      disabled={saving}
                                                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                                                  >
                                                      {saving && <Loader2 size={14} className="animate-spin" />}
                                                      {saving ? 'Salvando…' : 'Salvar'}
                                                  </button>
                                              </td>
                                          </tr>
                                      );
                                  })}
                              </tbody>
                          </table>
                      </div>
                  )}
              </div>
          </div>
      );
  };

  const renderBuildableProducts = () => {
      const buildableProducts = products.filter(p => p.isBuildable || (p.optionGroups?.length || 0) > 0);
      const buildableCount = buildableProducts.length;

      return (
          <div className="animate-fade-in space-y-6">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-emerald-50/60 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
                  <div className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-900/20" />
                  <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-lime-200/30 blur-3xl dark:bg-lime-900/20" />
                  <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                      <div>
                          <span className="text-xs font-bold tracking-[0.2em] text-emerald-600 uppercase">Cadastro guiado</span>
                          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Produtos Montáveis</h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                              Monte grupos e regras de forma rapida. Perfeito para marmitas, pizzas e lanches personalizados.
                          </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                          <button
                              onClick={() => {
                                  setBuildableProduct({ isAvailable: true, isBuildable: true, priceMode: 'BASE', category: 'Montáveis', optionGroups: [] });
                                  setBuildableError(null);
                                  setShowBuildableProductModal(true);
                              }}
                              className="bg-white dark:bg-slate-800 text-slate-700 dark:text-white border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                          >
                              <Plus size={18} /> Novo produto montável
                          </button>
                          <button onClick={() => handleApplyBuildableTemplate('MARMITA')} className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-emerald-700">
                              Criar modelo Marmita
                          </button>
                          <button onClick={() => handleApplyBuildableTemplate('PIZZA')} className="bg-slate-900 text-white px-4 py-2 rounded-xl font-bold hover:opacity-90">
                              Criar modelo Pizza
                          </button>
                          <button onClick={() => handleApplyBuildableTemplate('LANCHE')} className="bg-white dark:bg-slate-800 text-slate-700 dark:text-white border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-700">
                              Criar modelo Lanche
                          </button>
                      </div>
                  </div>
              </div>

              <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white">Produtos montáveis cadastrados</h3>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{buildableCount} itens</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {buildableProducts.length === 0 && (
                      <div className="col-span-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center text-slate-500 dark:text-slate-400">
                          Nenhum produto montável ainda. Use um modelo pronto para acelerar.
                      </div>
                  )}
                  {buildableProducts.map(product => {
                      const groupsCount = product.optionGroups?.length || 0;
                      const itemsCount = product.optionGroups?.reduce((acc, group) => acc + (group.options?.length || 0), 0) || 0;
                      return (
                          <div key={product.id} className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col">
                              <div className="flex items-start justify-between gap-4">
                                  <div>
                                      <h4 className="font-bold text-slate-800 dark:text-white text-base">{product.name}</h4>
                                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{product.description || 'Sem descricao'}</p>
                                  </div>
                                  <div className="flex gap-1">
                                      <button onClick={() => handleEditBuildableProduct(product)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded">
                                          <Edit size={16} />
                                      </button>
                                      <button onClick={() => handleDeleteProduct(product.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                                          <Trash size={16} />
                                      </button>
                                  </div>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                                  <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Grupos: {groupsCount}</span>
                                  <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600">Itens: {itemsCount}</span>
                                  <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                                      {product.priceMode === 'BY_SIZE' ? 'Preço por tamanho' : `Preço base: ${formatCurrencyBRL(product.price || 0)}`}
                                  </span>
                              </div>
                              <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                  <span>{product.category || 'Sem categoria'}</span>
                                  <span className={`font-bold ${product.isAvailable ? 'text-emerald-600' : 'text-slate-400'}`}>
                                      {product.isAvailable ? 'Ativo' : 'Inativo'}
                                  </span>
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };

  // ... (renderCoupons, renderCouriers, renderFinance, renderExpenses, renderSales, renderSettings remain same) ...
  const renderCoupons = () => (
      <div className="animate-fade-in font-body">
           <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-rose-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm mb-6">
               <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-rose-200/40 blur-3xl dark:bg-rose-900/20" />
               <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-orange-200/30 blur-3xl dark:bg-orange-900/20" />
               <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                   <div>
                       <span className="text-xs font-bold tracking-[0.2em] text-rose-600 uppercase">Cupons</span>
                       <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Ofertas que aceleram pedidos</h2>
                       <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                           Crie campanhas com desconto, controle uso e mantenha visibilidade do estoque promocional.
                       </p>
                   </div>
                   <button onClick={() => { setEditingCoupon({}); setShowCouponModal(true); }} className="bg-red-600 text-white px-5 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-red-700 shadow-lg shadow-red-600/30">
                       <Plus size={18} /> Criar cupom
                   </button>
               </div>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {coupons.map(coupon => (
                   <div key={coupon.id} className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-700 relative overflow-hidden group shadow-sm">
                       <div className="absolute -right-8 -top-8 bg-red-50 dark:bg-red-900/20 w-28 h-28 rounded-full flex items-end justify-start p-4"><Ticket className="text-red-200 dark:text-red-800" size={42} /></div>
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
      <div className="animate-fade-in space-y-6">
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-sky-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
              <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-900/20" />
              <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-indigo-200/30 blur-3xl dark:bg-indigo-900/20" />
              <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                  <div>
                      <span className="text-xs font-bold tracking-[0.2em] text-sky-600 uppercase">Entregadores</span>
                      <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Frota sob controle</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                          Acompanhe status, comissao e performance da equipe.
                      </p>
                  </div>
                  <button onClick={() => { setNewCourier({ commissionRate: 10, isActive: true }); setShowCourierModal(true); }} className="bg-slate-900 text-white px-5 py-3 rounded-xl font-bold flex items-center gap-2 hover:opacity-90 shadow-sm">
                      <Plus size={18} /> Novo entregador
                  </button>
              </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {couriers.map(courier => (
                  <div key={courier.id} className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col relative group">
                      <button onClick={() => handleDeleteCourier(courier.id)} className="absolute top-4 right-4 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={18}/></button>
                      <div className="flex items-center gap-4 mb-4">
                          <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-slate-500">
                              <Bike size={26} />
                          </div>
                          <div className="flex-1">
                              <h3 className="font-bold text-lg text-slate-800 dark:text-white">{courier.name}</h3>
                              <p className="text-sm text-slate-500">{courier.phone}</p>
                              <p className="text-xs text-slate-400 uppercase tracking-wider font-bold">{courier.plate || 'Sem placa'}</p>
                          </div>
                          <span className={`text-xs font-bold px-3 py-1 rounded-full ${courier.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {courier.isActive ? 'Ativo' : 'Inativo'}
                          </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-auto pt-4 border-t border-slate-100 dark:border-slate-800">
                          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3">
                              <p className="text-xs text-slate-400 uppercase font-bold">Comissao</p>
                              <p className="text-base font-extrabold text-slate-800 dark:text-white mt-1">{courier.commissionRate}%</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3">
                              <p className="text-xs text-slate-400 uppercase font-bold">Status</p>
                              <p className="text-base font-extrabold text-slate-800 dark:text-white mt-1">{courier.isActive ? 'Operando' : 'Pausado'}</p>
                          </div>
                      </div>
                  </div>
              ))}
          </div>
      </div>
  );

  const renderCustomers = () => {
      const totalCustomers = customers.length;
      const totalOrders = customers.reduce((acc, item) => acc + (Number(item.order_count) || 0), 0);
      const totalSpent = customers.reduce((acc, item) => acc + (Number(item.total_spent) || 0), 0);
      const avgTicket = totalOrders > 0 ? totalSpent / totalOrders : 0;
      const term = customerSearch.trim().toLowerCase();
      const filteredCustomers = term
          ? customers.filter((customer) => {
              const name = (customer.name || '').toLowerCase();
              const phone = (customer.phone || '').toLowerCase();
              const city = (customer.city || '').toLowerCase();
              const district = (customer.district || '').toLowerCase();
              const street = (customer.street || '').toLowerCase();
              return [name, phone, city, district, street].some((value) => value.includes(term));
          })
          : customers;
      const formatAddress = (customer: Customer) => {
          const parts = [
              customer.street,
              customer.number,
              customer.district,
              customer.city,
              customer.state
          ]
              .map((value) => (value || '').toString().trim())
              .filter(Boolean);
          return parts.join(', ');
      };
      return (
          <div className="animate-fade-in space-y-6">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-emerald-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
                  <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-900/20" />
                  <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-teal-200/30 blur-3xl dark:bg-teal-900/20" />
                  <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                      <div>
                          <span className="text-xs font-bold tracking-[0.2em] text-emerald-600 uppercase">Clientes</span>
                          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Sua base de clientes em um lugar</h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                              Veja quem compra mais, últimos pedidos e principais endereços para fidelização.
                          </p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3">
                          <div className="bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-4 py-3">
                              <p className="text-xs text-slate-500 uppercase font-bold">Clientes</p>
                              <p className="text-2xl font-extrabold text-slate-800 dark:text-white">{totalCustomers}</p>
                          </div>
                          <div className="bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-4 py-3">
                              <p className="text-xs text-slate-500 uppercase font-bold">Pedidos</p>
                              <p className="text-2xl font-extrabold text-slate-800 dark:text-white">{totalOrders}</p>
                          </div>
                          <div className="bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 rounded-2xl px-4 py-3">
                              <p className="text-xs text-slate-500 uppercase font-bold">Ticket Médio</p>
                              <p className="text-2xl font-extrabold text-slate-800 dark:text-white">{formatCurrencyBRL(avgTicket)}</p>
                          </div>
                      </div>
                  </div>
                  <div className="mt-6 flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 relative">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                          <input
                              type="text"
                              value={customerSearch}
                              onChange={(e) => setCustomerSearch(e.target.value)}
                              placeholder="Buscar por nome, telefone ou bairro"
                              className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 dark:text-white"
                          />
                      </div>
                      <button
                          onClick={loadCustomers}
                          className="px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-200 font-bold hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                          Atualizar
                      </button>
                  </div>
              </div>

              {customersLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 size={16} className="animate-spin" />
                      Carregando clientes...
                  </div>
              )}
              {customersError && <p className="text-sm text-red-600">{customersError}</p>}
              {!customersLoading && filteredCustomers.length === 0 && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 text-center text-slate-500 dark:text-slate-400">
                      Nenhum cliente encontrado para esta loja ainda.
                  </div>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredCustomers.map((customer) => {
                      const address = formatAddress(customer);
                      return (
                          <div key={customer.id} className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                              <div className="flex items-start justify-between gap-4">
                                  <div>
                                      <h3 className="text-lg font-extrabold text-slate-800 dark:text-white">{customer.name || 'Cliente'}</h3>
                                      <p className="text-sm text-slate-500">{customer.phone || 'Telefone não informado'}</p>
                                      {address && <p className="text-xs text-slate-400 mt-1">{address}</p>}
                                  </div>
                                  <div className="text-right">
                                      <p className="text-xs text-slate-400 uppercase font-bold">Total gasto</p>
                                      <p className="text-lg font-extrabold text-emerald-600">{formatCurrencyBRL(Number(customer.total_spent) || 0)}</p>
                                      <p className="text-xs text-slate-500 mt-1">{Number(customer.order_count) || 0} pedidos</p>
                                  </div>
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-3">
                                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3">
                                      <p className="text-[10px] text-slate-400 uppercase font-bold">Último pedido</p>
                                      <p className="text-sm font-bold text-slate-800 dark:text-white">
                                          #{customer.order_number || '--'}
                                      </p>
                                      <p className="text-xs text-slate-500">
                                          {customer.last_order_created_at ? new Date(customer.last_order_created_at).toLocaleString('pt-BR') : '--'}
                                      </p>
                                  </div>
                                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3">
                                      <p className="text-[10px] text-slate-400 uppercase font-bold">Status</p>
                                      <p className="text-sm font-bold text-slate-800 dark:text-white">
                                          {customer.last_order_status || '--'}
                                      </p>
                                      <p className="text-xs text-slate-500">
                                          Último valor {formatCurrencyBRL(Number(customer.last_order_total) || 0)}
                                      </p>
                                  </div>
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      );
  };

  const renderFinance = () => {
      // Dados calculados no hook useMemo (financialSummary)
      const { totalRevenue, totalExpenses, netProfit, orderSales, manualIncome } = financialSummary;

      const barData = [
          { name: 'Entradas', value: totalRevenue },
          { name: 'Saídas', value: totalExpenses },
      ];

      return (
          <div className="animate-fade-in space-y-6">
               <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-emerald-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
                    <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-900/20" />
                    <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-blue-200/30 blur-3xl dark:bg-blue-900/20" />
                    <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                        <div>
                            <span className="text-xs font-bold tracking-[0.2em] text-emerald-600 uppercase">Financeiro</span>
                            <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Pulso financeiro da loja</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                                Entradas, saidas e saldo liquido com leitura rapida.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                                Vendas {formatCurrencyBRL(orderSales)}
                            </div>
                            <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                                Outros {formatCurrencyBRL(manualIncome)}
                            </div>
                        </div>
                    </div>
               </div>
               
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   <div className="bg-white/90 dark:bg-slate-900/80 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                       <p className="text-xs font-bold text-slate-400 uppercase mb-2">Receita total</p>
                       <h3 className="text-3xl font-extrabold text-emerald-600">{formatCurrencyBRL(totalRevenue)}</h3>
                       <div className="mt-3 text-xs text-slate-400">
                           Vendas: {formatCurrencyBRL(orderSales)} | Outros: {formatCurrencyBRL(manualIncome)}
                       </div>
                   </div>
                   <div className="bg-white/90 dark:bg-slate-900/80 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                       <p className="text-xs font-bold text-slate-400 uppercase mb-2">Despesas</p>
                       <h3 className="text-3xl font-extrabold text-red-600">{formatCurrencyBRL(totalExpenses)}</h3>
                       <p className="text-xs text-slate-400 mt-3">Total de saidas registradas</p>
                   </div>
                   <div className="bg-white/90 dark:bg-slate-900/80 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                       <p className="text-xs font-bold text-slate-400 uppercase mb-2">Lucro liquido</p>
                       <h3 className={`text-3xl font-extrabold ${netProfit >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>{formatCurrencyBRL(netProfit)}</h3>
                       <p className="text-xs text-slate-400 mt-3">Saldo final</p>
                   </div>
               </div>

               <div className="bg-white/90 dark:bg-slate-900/80 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                   <div className="flex items-center justify-between mb-6">
                       <h3 className="font-bold text-slate-800 dark:text-white">Balanco geral</h3>
                       <span className="text-xs font-bold text-slate-400 uppercase">Resumo</span>
                   </div>
                   <ChartContainer className="h-80">
                       {({ width, height }) => (
                           <BarChart width={width} height={height} data={barData}>
                               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                               <XAxis dataKey="name" axisLine={false} tickLine={false} />
                               <YAxis axisLine={false} tickLine={false} />
                               <Tooltip 
                                    cursor={{fill: 'transparent'}}
                                    contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#fff', border: isDarkMode ? '1px solid #1e293b' : 'none', borderRadius: '8px' }} 
                               />
                               <Bar dataKey="value" fill="#3B82F6" radius={[8, 8, 0, 0]}>
                                   {barData.map((entry, index) => (
                                       <Cell key={`cell-${index}`} fill={entry.name === 'Entradas' ? '#10B981' : '#EF4444'} />
                                   ))}
                               </Bar>
                           </BarChart>
                       )}
                   </ChartContainer>
               </div>
          </div>
      );
  };

  const renderExpenses = () => (
      <div className="animate-fade-in space-y-6">
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-amber-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
              <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-900/20" />
              <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-orange-200/30 blur-3xl dark:bg-orange-900/20" />
              <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                  <div>
                      <span className="text-xs font-bold tracking-[0.2em] text-amber-600 uppercase">Retirada / Entrada</span>
                      <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Fluxo de caixa</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                          Registre entradas e saidas manuais com visao clara por categoria.
                      </p>
                  </div>
                  <button
                      onClick={() => { setNewTransaction({ type: 'EXPENSE', date: new Date().toISOString().split('T')[0], status: 'PAID', category: 'OUTROS_SAIDA' }); setShowTransactionModal(true); }}
                      className="bg-slate-900 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:opacity-90 shadow-sm"
                  >
                      <Plus size={18} /> Nova movimentacao
                  </button>
              </div>
          </div>
          <div className="bg-white/90 dark:bg-slate-900/80 rounded-3xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
              <table className="w-full">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                      <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Data</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Descricao</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Categoria</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Valor</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Acoes</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {transactions.map(t => (
                          <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{new Date(t.date).toLocaleDateString()}</td>
                              <td className="px-6 py-4 font-bold text-slate-800 dark:text-white">{t.description}</td>
                              <td className="px-6 py-4 text-sm text-slate-500">{TRANSACTION_CATEGORIES.find(c => c.id === t.category)?.label || t.category}</td>
                              <td className={`px-6 py-4 font-bold ${t.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'}`}>{t.type === 'INCOME' ? '+' : '-'} {formatCurrencyBRL(t.amount)}</td>
                              <td className="px-6 py-4">
                                  <button onClick={() => { if(confirm('Excluir?')) deleteExpense(t.id); }} className="text-slate-400 hover:text-red-600">
                                      <Trash2 size={16}/>
                                  </button>
                              </td>
                          </tr>
                      ))}
                      {transactions.length === 0 && (
                          <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">Nenhuma movimentacao registrada.</td></tr>
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

      const salesTotal = filteredOrders.reduce((sum, order) => sum + (order.total || 0), 0);
      const completedCount = filteredOrders.filter((order) => order.status === 'COMPLETED').length;
      const cancelledCount = filteredOrders.filter((order) => order.status === 'CANCELLED').length;

      return (
          <div className="animate-fade-in space-y-6">
              <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-purple-50/60 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-6 md:p-8 shadow-sm">
                  <div className="pointer-events-none absolute -top-16 -right-16 h-44 w-44 rounded-full bg-purple-200/40 blur-3xl dark:bg-purple-900/20" />
                  <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-indigo-200/30 blur-3xl dark:bg-indigo-900/20" />
                  <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                      <div>
                          <span className="text-xs font-bold tracking-[0.2em] text-purple-600 uppercase">Vendas</span>
                          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">Historico e controle</h2>
                          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                              Veja o que foi vendido, filtre por data e status e acompanhe o total.
                          </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                          <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {completedCount} concluidos
                          </div>
                          <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                              {cancelledCount} cancelados
                          </div>
                          <div className="px-4 py-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                              Total {formatCurrencyBRL(salesTotal)}
                          </div>
                      </div>
                  </div>
              </div>

              <div className="bg-white/90 dark:bg-slate-900/80 p-4 md:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 flex flex-wrap gap-4 items-center">
                  <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-500">Filtrar por:</span>
                      <select 
                        value={salesFilterStatus} 
                        onChange={(e) => setSalesFilterStatus(e.target.value)}
                        className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold outline-none dark:text-white"
                      >
                          <option value="ALL">Todos os Status</option>
                          <option value="COMPLETED">Concluidos</option>
                          <option value="CANCELLED">Cancelados</option>
                      </select>
                  </div>
                  <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-500">Data:</span>
                      <input 
                        type="date" 
                        value={salesFilterDate}
                        onChange={(e) => setSalesFilterDate(e.target.value)}
                        className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm outline-none dark:text-white"
                        style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                      />
                      {salesFilterDate && (
                          <button onClick={() => setSalesFilterDate('')} className="text-red-500 hover:text-red-700"><X size={16}/></button>
                      )}
                  </div>
              </div>

              <div className="bg-white/90 dark:bg-slate-900/80 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                      <table className="w-full">
                          <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                              <tr>
                                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Pedido</th>
                                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</th>
                                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Pagamento</th>
                                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Total</th>
                                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Acoes</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {filteredOrders.map(order => (
                                  <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                      <td className="px-6 py-4 font-mono text-sm text-slate-500">#{formatOrderNumber(order)}</td>
                                      <td className="px-6 py-4 font-bold text-slate-800 dark:text-white text-sm">{order.customerName}</td>
                                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                                          {new Date(order.createdAt || '').toLocaleString()}
                                      </td>
                                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">{order.paymentMethod}</td>
                                      <td className="px-6 py-4 font-bold text-slate-800 dark:text-white text-sm">{formatCurrencyBRL(order.total)}</td>
                                      <td className="px-6 py-4">
                                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                                              order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 
                                              order.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                                          }`}>
                                              {ORDER_STATUS_LABELS[order.status] || order.status}
                                          </span>
                                      </td>
                                      <td className="px-6 py-4 text-right">
                                          <button 
                                            onClick={() => setDeleteSaleId(order.id)}
                                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="Excluir Venda"
                                          >
                                              <Trash2 size={18} />
                                          </button>
                                      </td>
                                  </tr>
                              ))}
                              {filteredOrders.length === 0 && (
                                  <tr>
                                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400">Nenhuma venda encontrada com os filtros atuais.</td>
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

  const renderSettings = () => {
      const tabs = [
          { id: 'STORE', label: 'Dados da Loja', icon: Store, desc: 'Identidade, categoria e imagens.' },
          { id: 'ADDRESS', label: 'Endereco & Contato', icon: MapPin, desc: 'Localizacao e canais oficiais.' },
          { id: 'DELIVERY', label: 'Entrega', icon: Bike, desc: 'Tempos, taxas e mesas.' },
          { id: 'SCHEDULE', label: 'Horarios', icon: Clock, desc: 'Expediente e janelas.' },
          { id: 'PAYMENTS', label: 'Pagamento', icon: Wallet, desc: 'Metodos aceitos e taxas.' },
          { id: 'SECURITY', label: 'Seguranca', icon: ShieldCheck, desc: 'Protecao e confirmacoes.' },
          { id: 'HOMOLOGATION', label: 'Homologacao', icon: ShieldCheck, desc: 'Merchant ID para integracoes.' },
          { id: 'EXTRA', label: 'Configuracoes Adicionais', icon: ShieldCheck, desc: 'Ajustes extras da operacao.' }
      ];
      const canConfigurePrinter = userRole === 'BUSINESS' || userRole === 'ADMIN';
      const printDownloadUrl = storeProfile.merchantId
          ? `/downloads/menufaz-print.exe?merchantId=${encodeURIComponent(storeProfile.merchantId)}`
          : '/downloads/menufaz-print.exe';
      const tabletDownloadUrl = '/downloads/menufaz-tablet-pdv-latest.apk';
      const activeTab = tabs.find((tab) => tab.id === settingsTab) || tabs[0];
      const ActiveIcon = activeTab.icon;

      return (
      <div className="animate-fade-in">
           <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800 bg-gradient-to-br from-white via-white to-rose-50/70 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 p-5 md:p-6 shadow-sm">
                <div className="pointer-events-none absolute -top-24 -right-20 h-56 w-56 rounded-full bg-red-200/50 blur-3xl dark:bg-red-900/20" />
                <div className="pointer-events-none absolute -bottom-24 -left-16 h-48 w-48 rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-900/20" />
                <div className="relative">
                    <div className="flex flex-col gap-1.5 mb-4">
                        <span className="text-xs font-bold tracking-[0.2em] text-red-500 uppercase">Configuracoes</span>
                        <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white font-display">
                            Central da loja
                        </h2>
                        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                            Ajuste o que aparece para seus clientes e o que governa suas operacoes.
                        </p>
                    </div>

                    <div className="grid lg:grid-cols-[220px,1fr] gap-4">
                        <div className="lg:sticky lg:top-24 h-fit">
                            <div className="hidden lg:flex flex-col gap-2 bg-white/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-3 shadow-sm">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setSettingsTab(tab.id as any)}
                                        className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all ${
                                            settingsTab === tab.id
                                                ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100/70 dark:hover:bg-slate-800/70'
                                        }`}
                                    >
                                        <tab.icon size={16} />
                                        <div className="text-left">
                                            <div>{tab.label}</div>
                                            <div className={`text-[11px] ${settingsTab === tab.id ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}`}>
                                                {tab.desc}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="lg:hidden flex gap-2 overflow-x-auto pb-1">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setSettingsTab(tab.id as any)}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                                            settingsTab === tab.id
                                                ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                                                : 'bg-white/80 dark:bg-slate-900/70 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-800'
                                        }`}
                                    >
                                        <tab.icon size={14} /> {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-red-600">
                                        <ActiveIcon size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">{activeTab.label}</h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{activeTab.desc}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleSaveStoreSettings}
                                    className="bg-red-600 text-white px-4 py-2 rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-600/20 flex items-center gap-2 text-sm moving-border"
                                    style={{ '--moving-border-bg': '#dc2626' } as React.CSSProperties}
                                >
                                    <Save size={18} /> Salvar agora
                                </button>
                            </div>

                            {/* ... (Settings content remains same) ... */}
                            <div className="bg-white/95 dark:bg-slate-900/80 p-6 md:p-7 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl shadow-red-100/20 dark:shadow-none">
               {settingsTab === 'STORE' && (
                   <div className="grid md:grid-cols-2 gap-6">
                       <div className="space-y-4">
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Estabelecimento</label>
                               <p className="text-xs text-gray-400 mb-1">Esse nome aparece para os clientes no app.</p>
                               <input type="text" value={storeProfile.name} onChange={(e) => setStoreProfile({...storeProfile, name: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descrição / Bio</label>
                               <p className="text-xs text-gray-400 mb-1">Fale sobre o estilo da loja e diferenciais.</p>
                               <textarea value={storeProfile.description} onChange={(e) => setStoreProfile({...storeProfile, description: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" rows={3} />
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoria Principal</label>
                               <p className="text-xs text-gray-400 mb-1">Ajuda a loja aparecer nos filtros certos.</p>
                               <input type="text" value={storeProfile.category} onChange={(e) => setStoreProfile({...storeProfile, category: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" />
                           </div>
                           <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-3">
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase mb-2">QR Code do cardápio</label>
                                   <p className="text-xs text-gray-400 mb-3">Compartilhe o cardápio online com clientes.</p>
                               </div>
                               <div className="flex flex-col items-center gap-3">
                                   {menuQrDataUrl ? (
                                       <img
                                           src={menuQrDataUrl}
                                           alt="QR Code do cardápio"
                                           className="w-40 h-40 rounded-xl border border-slate-200 bg-white p-2"
                                       />
                                   ) : (
                                       <div className="w-40 h-40 rounded-xl border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400">
                                           Gerando QR...
                                       </div>
                                   )}
                                   <div className="text-[11px] text-slate-500 break-all text-center">
                                       {getMenuQrUrl()}
                                   </div>
                               </div>
                               <div className="flex flex-wrap gap-2">
                                   <button
                                       type="button"
                                       onClick={handleCopyMenuUrl}
                                       className="px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200"
                                   >
                                       Copiar link
                                   </button>
                                   <button
                                       type="button"
                                       onClick={handleDownloadMenuQr}
                                       disabled={!menuQrDataUrl}
                                       className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                                   >
                                       Baixar PNG do QR Code
                                   </button>
                               </div>
                           </div>
                       </div>
                       <div className="space-y-4">
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Logo da Loja</label>
                               <p className="text-xs text-gray-400 mb-2">Mostrada para o cliente durante o pedido. Recomendado: 512x512 px (quadrado).</p>
                               <div 
                                   onClick={() => storeLogoInputRef.current?.click()}
                                   className="w-40 h-40 rounded-2xl border-2 border-dashed border-gray-300 dark:border-slate-700 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:border-red-500 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-all relative overflow-hidden"
                               >
                                   {storeProfile.logoUrl ? <img src={storeProfile.logoUrl} alt="Logo" className="w-24 h-24 object-contain rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-2" /> : <><UploadCloud size={28} className="mb-2" /><span>Enviar logo</span></>}
                               </div>
                               <input type="file" ref={storeLogoInputRef} className="hidden" onChange={(e) => handleFileUpload(e, 'STORE_LOGO')} accept="image/*" />
                               {storeProfile.logoUrl ? (
                                   <button
                                       type="button"
                                       onClick={handleRemoveStoreLogo}
                                       className="mt-2 text-xs font-bold text-red-600 hover:text-red-700"
                                   >
                                       Remover logo
                                   </button>
                               ) : null}
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Capa da Loja</label>
                               <p className="text-xs text-gray-400 mb-2">Imagem de destaque no topo da loja. Recomendado: 1600x900 px (16:9).</p>
                               <div 
                                   onClick={() => storeCoverInputRef.current?.click()}
                                   className="w-full h-48 rounded-xl border-2 border-dashed border-gray-300 dark:border-slate-700 flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:border-red-500 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-all relative overflow-hidden"
                               >
                                   {storeProfile.imageUrl ? <img src={storeProfile.imageUrl} alt="Capa" className="w-full h-full object-cover absolute" /> : <><UploadCloud size={32} className="mb-2" /><span>Enviar capa</span></>}
                               </div>
                               <input type="file" ref={storeCoverInputRef} className="hidden" onChange={(e) => handleFileUpload(e, 'STORE_COVER')} accept="image/*" />
                               {storeProfile.imageUrl ? (
                                   <button
                                       type="button"
                                       onClick={handleRemoveStoreCover}
                                       className="mt-2 text-xs font-bold text-red-600 hover:text-red-700"
                                   >
                                       Remover capa
                                   </button>
                               ) : null}
                           </div>
                       </div>
                   </div>
               )}

               {settingsTab === 'ADDRESS' && (
                   <div className="grid md:grid-cols-2 gap-4">
                       <div className="md:col-span-2 flex items-end gap-2">
                           <div className="flex-1">
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                               <input type="text" value={addressForm.cep} onChange={(e) => setAddressForm({...addressForm, cep: e.target.value})} onBlur={handleCepBlur} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" maxLength={9} placeholder="00000-000" />
                           </div>
                           <div className="flex-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cidade</label><input type="text" value={addressForm.city} onChange={(e) => setAddressForm({...addressForm, city: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                           <button onClick={handleGeocodeAddress} className="bg-red-100 text-red-600 p-3 rounded-xl font-bold hover:bg-red-200" title="Atualizar Local no Mapa"><MapPin size={20} /></button>
                       </div>
                       <div className="md:col-span-2"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rua / Logradouro</label><input type="text" value={addressForm.street} onChange={(e) => setAddressForm({...addressForm, street: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                       <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Número</label><input type="text" value={addressForm.number} onChange={(e) => setAddressForm({...addressForm, number: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                       <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Bairro</label><input type="text" value={addressForm.district} onChange={(e) => setAddressForm({...addressForm, district: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                       <div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone / WhatsApp</label><input type="text" value={addressForm.phone} onChange={(e) => setAddressForm({...addressForm, phone: e.target.value})} className="w-full p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white" /></div>
                   </div>
               )}

               {settingsTab === 'DELIVERY' && (
                   <div className="space-y-4">
                       <div className="grid grid-cols-2 gap-4">
                   <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tempo de Entrega</label>
                       <p className="text-xs text-gray-400 mb-1">Mostrado para o cliente no checkout.</p>
                       <input type="text" value={storeProfile.deliveryTime} onChange={(e) => setStoreProfile({...storeProfile, deliveryTime: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Ex: 30-40 min" />
                   </div>
                   <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tempo de Retirada</label>
                       <p className="text-xs text-gray-400 mb-1">Visível quando o cliente escolhe retirada.</p>
                       <input type="text" value={storeProfile.pickupTime || ''} onChange={(e) => setStoreProfile({...storeProfile, pickupTime: e.target.value})} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Ex: 20-30 min" />
                   </div>
                           <div className="col-span-2">
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Tipo de Frete</label>
                               <div className="flex flex-wrap gap-3">
                                   <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700">
                                       <input
                                           type="radio"
                                           name="deliveryFeeMode"
                                           checked={deliveryFeeMode === 'FIXED'}
                                           onChange={() => setStoreProfile({ ...storeProfile, deliveryFeeMode: 'FIXED' })}
                                           className="w-4 h-4 accent-red-600"
                                       />
                                       <span className="font-bold text-slate-700 dark:text-white">Taxa fixa</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700">
                                       <input
                                           type="radio"
                                           name="deliveryFeeMode"
                                           checked={deliveryFeeMode === 'BY_NEIGHBORHOOD'}
                                           onChange={() => {
                                               setStoreProfile({ ...storeProfile, deliveryFeeMode: 'BY_NEIGHBORHOOD' });
                                               if (deliveryNeighborhoods.length === 0) {
                                                   importNeighborhoods(false);
                                               }
                                           }}
                                           className="w-4 h-4 accent-red-600"
                                       />
                                       <span className="font-bold text-slate-700 dark:text-white">Taxa por bairro</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700">
                                       <input
                                           type="radio"
                                           name="deliveryFeeMode"
                                           checked={deliveryFeeMode === 'BY_RADIUS'}
                                           onChange={() => {
                                               setStoreProfile({ ...storeProfile, deliveryFeeMode: 'BY_RADIUS' });
                                           }}
                                           className="w-4 h-4 accent-red-600"
                                       />
                                       <span className="font-bold text-slate-700 dark:text-white">Frete por raio (mapa)</span>
                                   </label>
                               </div>
                           </div>
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Valor mínimo para entrega (opcional)</label>
                               <p className="text-xs text-gray-400 mb-1">Pedidos para entrega só serão aceitos a partir desse valor.</p>
                               <input
                                   type="text"
                                   value={storeProfile.delivery_min_order_value ?? ''}
                                   onChange={(e) => {
                                       const raw = e.target.value.replace(',', '.').trim();
                                       if (!raw) {
                                           setStoreProfile({ ...storeProfile, delivery_min_order_value: undefined });
                                           return;
                                       }
                                       const parsed = Number(raw);
                                       setStoreProfile({ ...storeProfile, delivery_min_order_value: Number.isFinite(parsed) ? parsed : undefined });
                                   }}
                                   placeholder="Ex.: 30,00"
                                   className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                               />
                           </div>
                           {deliveryFeeMode === 'FIXED' && (
                               <div>
                                   <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Taxa de Entrega (R$)</label>
                                   <p className="text-xs text-gray-400 mb-1">Deixe 0 para entrega grátis.</p>
                                   <input
                                       type="number"
                                       value={Number.isFinite(Number(storeProfile.deliveryFee)) ? storeProfile.deliveryFee : 0}
                                       onChange={(e) => setStoreProfile({ ...storeProfile, deliveryFee: parseFloat(e.target.value) })}
                                       className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                   />
                               </div>
                           )}
                       </div>
                       {deliveryFeeMode === 'BY_NEIGHBORHOOD' && (
                           <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-4">
                               <div className="flex flex-wrap items-center justify-between gap-3">
                                   <div>
                                       <p className="font-bold text-slate-700 dark:text-white">Bairros atendidos</p>
                                       <p className="text-xs text-gray-500 dark:text-gray-400">
                                           Buscamos bairros de {storeProfile.city || 'sua cidade'} via Google.
                                       </p>
                                       <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                           Bairros importados: {deliveryNeighborhoods.length}
                                       </p>
                                   </div>
                                   <div className="flex items-center gap-2">
                                       <button
                                           type="button"
                                           onClick={() => handleMarkAllNeighborhoods(true)}
                                           className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
                                       >
                                           Marcar todos
                                       </button>
                                       <button
                                           type="button"
                                           onClick={() => handleMarkAllNeighborhoods(false)}
                                           className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800"
                                       >
                                           Desmarcar
                                       </button>
                                   </div>
                               </div>
                               <input
                                   type="text"
                                   value={deliveryNeighborhoodSearch}
                                   onChange={(e) => setDeliveryNeighborhoodSearch(e.target.value)}
                                   placeholder="Buscar bairro"
                                   className="w-full p-3 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                               />
                               <div className="flex flex-wrap items-center gap-2 text-xs">
                                   {deliveryNeighborhoodLoading && (
                                       <span className="text-gray-500">Buscando mais bairros...</span>
                                   )}
                                   {deliveryNeighborhoodError && (
                                       <span className="text-amber-600">{deliveryNeighborhoodError}</span>
                                   )}
                                   {deliveryNeighborhoodInfo && (
                                       <span className="text-emerald-600">{deliveryNeighborhoodInfo}</span>
                                   )}
                                   <button
                                       type="button"
                                       onClick={() => importNeighborhoods(true)}
                                       className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 font-bold hover:bg-white dark:hover:bg-slate-800"
                                   >
                                       {deliveryNeighborhoodLoading ? 'Buscando mais bairros...' : 'Reimportar bairros'}
                                   </button>
                               </div>
                               <div className="max-h-60 overflow-y-auto space-y-2">
                                   {filteredDeliveryNeighborhoods.length === 0 && !deliveryNeighborhoodLoading && (
                                       <p className="text-xs text-gray-500">Nenhum bairro para exibir.</p>
                                   )}
                                   {filteredDeliveryNeighborhoods.map(({ item, index }) => (
                                       <div
                                           key={`${item.name}-${index}`}
                                           className="flex flex-wrap items-center justify-between gap-3 border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl px-3 py-2"
                                       >
                                           <label className="flex items-center gap-2">
                                               <input
                                                   type="checkbox"
                                                   checked={item.active}
                                                   onChange={(e) => handleToggleNeighborhood(index, e.target.checked)}
                                                   className="w-4 h-4 accent-red-600"
                                               />
                                               <span className="text-sm font-semibold text-slate-700 dark:text-white">{item.name}</span>
                                           </label>
                                           <div className="flex items-center gap-2">
                                               <span className="text-xs text-gray-500">R$</span>
                                               <input
                                                   type="number"
                                                   min="0"
                                                   disabled={!item.active}
                                                   value={item.fee ?? 0}
                                                   onChange={(e) => handleNeighborhoodFeeChange(index, e.target.value)}
                                                   className="w-24 p-2 text-sm border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white disabled:opacity-60"
                                               />
                                           </div>
                                       </div>
                                   ))}
                               </div>
                               <div className="border-t border-gray-200 dark:border-slate-800 pt-3 space-y-2">
                                   <p className="text-xs font-bold text-gray-500 uppercase">Adicionar bairro manualmente</p>
                                   <div className="flex flex-wrap gap-2">
                                       <input
                                           type="text"
                                           value={manualNeighborhoodName}
                                           onChange={(e) => setManualNeighborhoodName(e.target.value)}
                                           placeholder="Nome do bairro"
                                           className="flex-1 min-w-[200px] p-3 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                       />
                                       <input
                                           type="number"
                                           min="0"
                                           value={manualNeighborhoodFee}
                                           onChange={(e) => setManualNeighborhoodFee(e.target.value)}
                                           placeholder="Taxa"
                                           className="w-28 p-3 border rounded-xl bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                       />
                                       <button
                                           type="button"
                                           onClick={handleAddManualNeighborhood}
                                           className="px-4 py-3 bg-slate-900 text-white rounded-xl font-bold hover:opacity-90"
                                       >
                                           Adicionar
                                       </button>
                                   </div>
                               </div>
                           </div>
                       )}
                       {deliveryFeeMode === 'BY_RADIUS' && (
                           <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-4">
                               <div className="flex flex-wrap items-center justify-between gap-3">
                                   <div>
                                       <p className="font-bold text-slate-700 dark:text-white">Areas de entrega (raio e poligono)</p>
                                       <p className="text-xs text-gray-500 dark:text-gray-400">
                                           Crie circulos ou poligonos no mapa para definir taxa e tempo de entrega.
                                       </p>
                                   </div>
                                   <div className="flex items-center gap-2">
                                       <button
                                           type="button"
                                           onClick={handleCreateDeliveryZone}
                                           className="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-bold"
                                       >
                                           Criar area (raio)
                                       </button>
                                       <button
                                           type="button"
                                           onClick={handleCreateDeliveryPolygon}
                                           className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold"
                                       >
                                           Criar poligono
                                       </button>
                                   </div>
                               </div>
                               {deliveryZoneError && (
                                   <div className="text-xs text-amber-600">{deliveryZoneError}</div>
                               )}
                               {deliveryZoneNotice && (
                                   <div className="text-xs text-emerald-600">{deliveryZoneNotice}</div>
                               )}
                               <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
                                   <div className="space-y-2">
                                       <div
                                           ref={deliveryZoneMapContainerRef}
                                           className="h-72 rounded-xl border border-gray-200 dark:border-slate-800 bg-white"
                                       />
                                       <p className="text-[11px] text-gray-400">
                                           Clique em uma area para editar. Arraste no mapa para mover/ajustar.
                                       </p>
                                   </div>
                                   <div className="space-y-4">
                                       {selectedDeliveryZone ? (
                                           <div className="space-y-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                                               <div>
                                                   <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descricao</label>
                                                   <input
                                                       type="text"
                                                       value={selectedDeliveryZone.name}
                                                       onChange={(e) => handleUpdateDeliveryZone(selectedDeliveryZone.id, { name: e.target.value })}
                                                       className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white text-sm"
                                                   />
                                               </div>
                                               <div className="text-xs text-gray-500">
                                                   Tipo: {getZoneType(selectedDeliveryZone) === 'POLYGON' ? 'Poligono' : 'Raio'}
                                               </div>
                                               <div className="grid grid-cols-2 gap-2">
                                                   <div>
                                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Taxa (R$)</label>
                                                       <input
                                                           type="number"
                                                           min="0"
                                                           value={selectedDeliveryZone.fee ?? 0}
                                                           onChange={(e) =>
                                                               handleUpdateDeliveryZone(selectedDeliveryZone.id, {
                                                                   fee: Number(e.target.value || 0)
                                                               })
                                                           }
                                                           className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white text-sm"
                                                       />
                                                   </div>
                                                   <div>
                                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tempo (min)</label>
                                                       <input
                                                           type="number"
                                                           min="0"
                                                           value={selectedDeliveryZone.etaMinutes ?? 0}
                                                           onChange={(e) =>
                                                               handleUpdateDeliveryZone(selectedDeliveryZone.id, {
                                                                   etaMinutes: Number(e.target.value || 0)
                                                               })
                                                           }
                                                           className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white text-sm"
                                                       />
                                                   </div>
                                               </div>
                                               {getZoneType(selectedDeliveryZone) === 'RADIUS' ? (
                                                   <div>
                                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                                           Raio (m)
                                                       </label>
                                                       <input
                                                           type="range"
                                                           min="500"
                                                           max="20000"
                                                           step="100"
                                                           value={selectedDeliveryZone.radiusMeters}
                                                           onChange={(e) => {
                                                               const nextRadius = Number(e.target.value || 0);
                                                               handleUpdateDeliveryZone(selectedDeliveryZone.id, {
                                                                   radiusMeters: nextRadius
                                                               });
                                                               const circle = deliveryZoneCircleRefs.current.get(selectedDeliveryZone.id);
                                                               if (circle) circle.setRadius(nextRadius);
                                                           }}
                                                           className="w-full"
                                                       />
                                                       <input
                                                           type="number"
                                                           min="0"
                                                           value={selectedDeliveryZone.radiusMeters}
                                                           onChange={(e) => {
                                                               const nextRadius = Number(e.target.value || 0);
                                                               handleUpdateDeliveryZone(selectedDeliveryZone.id, {
                                                                   radiusMeters: nextRadius
                                                               });
                                                               const circle = deliveryZoneCircleRefs.current.get(selectedDeliveryZone.id);
                                                               if (circle) circle.setRadius(nextRadius);
                                                           }}
                                                           className="w-full mt-2 p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white text-sm"
                                                       />
                                                   </div>
                                               ) : (
                                                   <div className="text-xs text-gray-500">
                                                       Ajuste os pontos do poligono direto no mapa.
                                                   </div>
                                               )}
                                               <div className="grid grid-cols-2 gap-2">
                                                   <div>
                                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Prioridade</label>
                                                       <input
                                                           type="number"
                                                           min="0"
                                                           value={selectedDeliveryZone.priority ?? 0}
                                                           onChange={(e) =>
                                                               handleUpdateDeliveryZone(selectedDeliveryZone.id, {
                                                                   priority: Number(e.target.value || 0)
                                                               })
                                                           }
                                                           className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white text-sm"
                                                       />
                                                   </div>
                                                   <label className="flex items-center gap-2 text-xs text-slate-500 mt-6">
                                                       <input
                                                           type="checkbox"
                                                           checked={selectedDeliveryZone.enabled !== false}
                                                           onChange={(e) =>
                                                               handleUpdateDeliveryZone(selectedDeliveryZone.id, {
                                                                   enabled: e.target.checked
                                                               })
                                                           }
                                                           className="w-4 h-4 accent-red-600 rounded"
                                                       />
                                                       Area ativa
                                                   </label>
                                               </div>
                                           </div>
                                       ) : (
                                           <div className="text-xs text-gray-500">Selecione ou crie uma area.</div>
                                       )}

                                       <div className="space-y-2">
                                           {deliveryZones.length === 0 ? (
                                               <p className="text-xs text-gray-400">Nenhuma area criada.</p>
                                           ) : (
                                               deliveryZones.map((zone) => (
                                                   <div
                                                       key={zone.id}
                                                       onClick={() => setSelectedDeliveryZoneId(zone.id)}
                                                       className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border ${
                                                           selectedDeliveryZoneId === zone.id
                                                               ? 'border-red-400 bg-red-50/60 dark:bg-red-900/20'
                                                               : 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                                                       }`}
                                                   >
                                                       <div>
                                                           <p className="text-sm font-semibold text-slate-700 dark:text-white">{zone.name}</p>
                                                           <p className="text-[11px] text-slate-400">
                                                               {getZoneType(zone) === 'POLYGON' ? 'Poligono' : `${Math.round(zone.radiusMeters)} m`} · R$ {Number(zone.fee || 0).toFixed(2)}
                                                           </p>
                                                       </div>
                                                       <div className="flex items-center gap-2">
                                                           <button
                                                               type="button"
                                                               onClick={() => setSelectedDeliveryZoneId(zone.id)}
                                                               className="text-xs font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-2 py-1 rounded-lg"
                                                           >
                                                               Editar
                                                           </button>
                                                           <button
                                                               type="button"
                                                               onClick={() => handleDeleteDeliveryZone(zone.id)}
                                                               className="text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded-lg"
                                                           >
                                                               Apagar
                                                           </button>
                                                       </div>
                                                   </div>
                                               ))
                                           )}
                                       </div>
                                   </div>
                               </div>
                           </div>
                       )}
                       <div className="flex flex-wrap items-center gap-3">
                           <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700"><input type="checkbox" checked={storeProfile.acceptsDelivery} onChange={(e) => setStoreProfile({...storeProfile, acceptsDelivery: e.target.checked})} className="w-5 h-5 accent-red-600" /><span className="font-bold text-slate-700 dark:text-white">Aceita Delivery</span></label>
                           <label className="flex items-center gap-2 cursor-pointer bg-gray-50 dark:bg-slate-800 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700"><input type="checkbox" checked={storeProfile.acceptsPickup} onChange={(e) => setStoreProfile({...storeProfile, acceptsPickup: e.target.checked})} className="w-5 h-5 accent-red-600" /><span className="font-bold text-slate-700 dark:text-white">Aceita Retirada</span></label>
                       </div>
                       <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50 p-4 space-y-3">
                           <div className="flex flex-wrap items-center justify-between gap-3">
                               <div className="flex items-center gap-3">
                                   <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-200">
                                       <Table size={18} />
                                   </div>
                                   <div>
                                       <p className="font-bold text-slate-700 dark:text-white">Pedidos Mesa</p>
                                       <p className="text-xs text-gray-500 dark:text-gray-400">Ative para aceitar pedidos feitos diretamente na mesa.</p>
                                   </div>
                               </div>
                               <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-slate-800 px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700">
                                   <input
                                       type="checkbox"
                                       checked={!!storeProfile.acceptsTableOrders}
                                       onChange={(e) => setStoreProfile({ ...storeProfile, acceptsTableOrders: e.target.checked })}
                                       className="w-5 h-5 accent-red-600"
                                   />
                                   <span className="font-bold text-slate-700 dark:text-white">Aceita Mesa</span>
                               </label>
                           </div>
                           {storeProfile.acceptsTableOrders && (
                               <div className="space-y-3">
                                   <div className="flex flex-wrap items-end gap-2">
                                       <div className="flex-1 min-w-[200px]">
                                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mesas</label>
                                           <input
                                               type="number"
                                               min="0"
                                               value={tableCountValue}
                                               onChange={(e) => setStoreProfile({ ...storeProfile, tableCount: Math.max(0, Number(e.target.value) || 0) })}
                                               className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                           />
                                       </div>
                                       <button onClick={handleSaveStoreSettings} className="bg-slate-900 text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 shadow-sm">
                                           Salvar mesas
                                       </button>
                                       <button
                                           onClick={handleDownloadAllTableQrs}
                                           disabled={isDownloadingTables || tableCountValue === 0}
                                           className="bg-white dark:bg-slate-800 text-slate-700 dark:text-white px-5 py-3 rounded-xl font-bold border border-gray-200 dark:border-slate-700 hover:border-red-300 disabled:opacity-60 flex items-center gap-2"
                                       >
                                           <Download size={16} />
                                           {isDownloadingTables ? 'Gerando...' : 'Baixar QRCODE'}
                                       </button>
                                   </div>
                                   <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                                       {Array.from({ length: Math.min(tableCountValue, 40) }, (_, index) => {
                                           const tableLabel = index + 1;
                                           const isDownloading = downloadingTable === tableLabel;
                                           const isDownloadingTablet = downloadingTabletTable === tableLabel;
                                           return (
                                               <div
                                                   key={tableLabel}
                                                   className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-sm"
                                               >
                                                   <button
                                                       onClick={() => handleDownloadTableQr(tableLabel)}
                                                       disabled={isDownloading}
                                                       type="button"
                                                       className="flex flex-col items-center justify-center gap-1 w-full hover:border-red-400 transition-colors"
                                                   >
                                                       <Table size={18} className="text-slate-600 dark:text-slate-200" />
                                                       <span className="text-[10px] font-bold text-gray-500">Mesa {tableLabel}</span>
                                                   </button>
                                                   <button
                                                       onClick={() => handleShowTabletQr(tableLabel)}
                                                       disabled={isDownloadingTablet}
                                                       type="button"
                                                       className="px-2 py-1 rounded-full text-[9px] font-bold tracking-wide uppercase bg-sky-100 text-sky-700 border border-sky-200 hover:bg-sky-200 disabled:opacity-60"
                                                   >
                                                       {isDownloadingTablet ? 'Gerando...' : 'QR TABLET'}
                                                   </button>
                                               </div>
                                           );
                                       })}
                                   </div>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                      QR TABLET expira em 5 minutos e registra o tablet conectado.
                                  </p>
                                  {tabletQrSuccess && (
                                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white">✓</span>
                                          <span>{tabletQrSuccess}</span>
                                      </div>
                                  )}
                                   {tableCountValue > 40 && (
                                       <p className="text-xs text-gray-400">Exibindo as 40 primeiras mesas.</p>
                                   )}
                                   <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4 space-y-3">
                                       <div className="flex flex-wrap items-center justify-between gap-2">
                                           <div>
                                               <p className="font-bold text-slate-700 dark:text-white">Tablets conectados</p>
                                               <p className="text-xs text-gray-500 dark:text-gray-400">Atualiza automaticamente a cada 30s.</p>
                                           </div>
                                           <button
                                               onClick={loadTabletDevices}
                                               type="button"
                                               className="text-xs font-bold px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 hover:border-red-300"
                                           >
                                               Atualizar
                                           </button>
                                       </div>
                                       {tabletLoading && (
                                           <div className="flex items-center gap-2 text-sm text-gray-500">
                                               <Loader2 className="animate-spin" size={16} />
                                               Carregando tablets...
                                           </div>
                                       )}
                                       {tabletError && <p className="text-xs text-red-600">{tabletError}</p>}
                                       {!tabletLoading && !tabletError && tabletDevices.length === 0 && (
                                           <p className="text-xs text-gray-500">Nenhum tablet conectado ainda.</p>
                                       )}
                                      {!tabletLoading && tabletDevices.length > 0 && (
                                          <div className="space-y-3">
                                               {Object.entries(
                                                   tabletDevices.reduce<Record<string, TabletDevice[]>>((acc, tablet) => {
                                                       const tableKey = tablet.table_number || 'Sem mesa';
                                                       if (!acc[tableKey]) acc[tableKey] = [];
                                                       acc[tableKey].push(tablet);
                                                       return acc;
                                                   }, {})
                                               ).map(([tableKey, devices]) => (
                                                   <div key={tableKey} className="rounded-lg border border-gray-100 dark:border-slate-800 p-3 space-y-2">
                                                       <div className="text-xs font-bold text-gray-500 uppercase">Mesa {tableKey}</div>
                                                       <div className="space-y-2">
                                                           {devices
                                                               .filter((device) => {
                                                                   if (device.revoked_at) return false;
                                                                   if (!device.device_id) return false;
                                                                   if (device.expires_at && new Date(device.expires_at).getTime() <= Date.now()) return false;
                                                                   return true;
                                                               })
                                                               .map((device) => {
                                                                   return (
                                                                       <div
                                                                           key={device.id}
                                                                           className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                                                       >
                                                                           <div className="space-y-1">
                                                                               <div className="font-semibold text-slate-700 dark:text-slate-200">
                                                                                   {device.device_label || device.device_id || 'Tablet'}
                                                                               </div>
                                                                               <div className="text-[11px] text-gray-500">
                                                                                   Status: Ativo • Criado: {formatTabletDate(device.created_at)} • Ultimo ping:{' '}
                                                                                   {formatTabletDate(device.last_seen)}
                                                                               </div>
                                                                               <div className="text-[11px] text-gray-500">
                                                                                   Android ID: {device.device_id || '--'}
                                                                               </div>
                                                                               <div className="text-[11px] text-gray-500">
                                                                                   Expira em: {formatTabletDate(device.expires_at)}
                                                                               </div>
                                                                           </div>
                                                                           <button
                                                                               onClick={() => storeId && revokeTablet(storeId, device.id).then(loadTabletDevices)}
                                                                               disabled={!storeId}
                                                                               type="button"
                                                                               className="px-3 py-1 rounded-full border border-gray-200 dark:border-slate-700 text-[10px] font-bold uppercase text-red-600 hover:border-red-300 disabled:opacity-60"
                                                                           >
                                                                               Revogar
                                                                           </button>
                                                                       </div>
                                                                   );
                                                               })}
                                                           {devices.filter((device) => !device.device_id && !device.revoked_at).length > 0 && (
                                                               <div className="text-[11px] text-gray-500">
                                                                   Tokens pendentes: {devices.filter((device) => !device.device_id && !device.revoked_at).length}
                                                               </div>
                                                           )}
                                                       </div>
                                                   </div>
                                               ))}
                                          </div>
                                      )}
                                   </div>
                                   {/* Logs do QR Tablet removidos */}
                               </div>
                           )}
                       </div>
                   </div>
               )}

               {tabletQrOpen && (
                   <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                       <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 shadow-xl p-5 space-y-4">
                           <div className="flex items-center justify-between">
                               <div>
                                   <p className="text-sm font-bold text-slate-700 dark:text-white">QR TABLET</p>
                                   <p className="text-xs text-gray-500">Mesa {tabletQrTable}</p>
                               </div>
                               <button
                                   type="button"
                                   onClick={() => setTabletQrOpen(false)}
                                   className="w-9 h-9 rounded-full border border-gray-200 dark:border-slate-700 flex items-center justify-center"
                               >
                                   <X size={16} />
                               </button>
                           </div>
                           <div className="flex flex-col items-center gap-2">
                               {tabletQrDataUrl ? (
                                   <img
                                       src={tabletQrDataUrl}
                                       alt={`QR Tablet Mesa ${tabletQrTable}`}
                                       className="w-64 h-64 rounded-xl border border-gray-200 dark:border-slate-700 bg-white"
                                   />
                               ) : (
                                   <div className="w-64 h-64 rounded-xl border border-gray-200 dark:border-slate-700 flex items-center justify-center text-gray-400">
                                       Sem QR
                                   </div>
                               )}
                               {tabletQrUrl && (
                                   <div className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-[10px] text-gray-600 break-all">
                                       {tabletQrUrl}
                                   </div>
                               )}
                               {tabletQrUrl && (
                                   <button
                                       type="button"
                                       onClick={() => {
                                           navigator.clipboard.writeText(tabletQrUrl).catch(() => {});
                                       }}
                                       className="text-[10px] font-bold uppercase text-sky-600"
                                   >
                                       Copiar link do QR
                                   </button>
                               )}
                               <div className="text-sm font-bold text-slate-700 dark:text-white">
                                   Expira em: {tabletQrCountdown}
                               </div>
                               <div className="text-xs text-gray-500">
                                   O tablet deve escanear antes de expirar.
                               </div>
                           </div>
                           <div className="flex items-center justify-between gap-2">
                               <button
                                   type="button"
                                   onClick={() => tabletQrTable && handleShowTabletQr(tabletQrTable)}
                                   className="flex-1 px-4 py-2 rounded-lg text-xs font-bold uppercase bg-sky-600 text-white hover:opacity-90"
                               >
                                   Gerar novo QR
                               </button>
                               <button
                                   type="button"
                                   onClick={() => setTabletQrOpen(false)}
                                   className="px-4 py-2 rounded-lg text-xs font-bold uppercase border border-gray-200 dark:border-slate-700"
                               >
                                   Fechar
                               </button>
                           </div>
                       </div>
                   </div>
               )}

               {settingsTab === 'SCHEDULE' && (
                   <div className="space-y-4">
                       <div className="grid md:grid-cols-2 gap-4">
                           <div className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/60 p-4 space-y-3">
                               <div className="border-b border-gray-200 dark:border-slate-700 pb-3">
                                   <p className="text-xs font-bold text-gray-500 uppercase">Status atual</p>
                                   <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-gray-500 mt-2">
                                       <span className={`px-3 py-1 rounded-full ${availability?.isOpen ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                                           {availability?.isOpen ? 'Loja aberta' : 'Loja fechada'}
                                       </span>
                                       <span className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                                           {availability?.reason || (availabilityLoading ? 'Carregando...' : 'Sem status')}
                                       </span>
                                       <span className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                                           Proxima mudanca: {availability?.nextChangeAt ? new Date(availability.nextChangeAt).toLocaleString('pt-BR') : '--'}
                                       </span>
                                   </div>
                               </div>
                               <div className="space-y-2">
                                   <p className="text-xs font-bold text-gray-500 uppercase">Pausa/Fechar agora</p>
                                   <div className="grid grid-cols-2 gap-2">
                                       <input
                                           type="number"
                                           min="1"
                                           value={pauseMinutes}
                                           onChange={(e) => setPauseMinutes(e.target.value)}
                                           placeholder="Minutos"
                                           className="p-2 border rounded-lg text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                       />
                                       <input
                                           type="text"
                                           value={pauseReason}
                                           onChange={(e) => setPauseReason(e.target.value)}
                                           placeholder="Motivo"
                                           className="p-2 border rounded-lg text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                       />
                                   </div>
                                   <div className="flex flex-wrap gap-2">
                                       <button
                                           onClick={handlePauseStore}
                                           disabled={pauseUpdating}
                                           className="bg-red-600 text-white px-4 py-2 rounded-xl font-bold text-xs hover:bg-red-700 disabled:opacity-60"
                                       >
                                           Pausar
                                       </button>
                                       <button
                                           onClick={handleResumePause}
                                           disabled={pauseUpdating || !availability?.pause?.active}
                                           className="bg-white dark:bg-slate-800 text-slate-700 dark:text-white px-4 py-2 rounded-xl font-bold text-xs border border-gray-200 dark:border-slate-700 hover:border-red-300 disabled:opacity-60"
                                       >
                                           Retomar
                                       </button>
                                       {availability?.pause?.active && (
                                           <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                                               Pausado ate {availability.pause.endsAt ? new Date(availability.pause.endsAt).toLocaleString('pt-BR') : '--'}
                                           </span>
                                       )}
                                   </div>
                               </div>
                           </div>
                       </div>

                       <div className="space-y-2">
                           {storeProfile.schedule?.map((day, idx) => (
                               <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                                   <div className="w-24 font-bold text-slate-700 dark:text-white">{day.day}</div>
                                   <div className="flex flex-col gap-3">
                                       <div className="flex items-center gap-2">
                                           <label className="relative inline-flex items-center cursor-pointer">
                                               <input
                                                   type="checkbox"
                                                   checked={day.isMorningOpen}
                                                   onChange={(e) => {
                                                       const newSched = [...(storeProfile.schedule || [])];
                                                       newSched[idx].isMorningOpen = e.target.checked;
                                                       setStoreProfile({ ...storeProfile, schedule: newSched });
                                                   }}
                                                   className="sr-only peer"
                                               />
                                               <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                                           </label>
                                           <span className="text-xs font-bold text-gray-500 w-12">Manha</span>
                                           <input
                                               type="time"
                                               value={day.morningOpenTime}
                                               onChange={(e) => {
                                                   const newSched = [...(storeProfile.schedule || [])];
                                                   newSched[idx].morningOpenTime = e.target.value;
                                                   setStoreProfile({ ...storeProfile, schedule: newSched });
                                               }}
                                               className="p-1 border rounded text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                               style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                                               disabled={!day.isMorningOpen}
                                           />
                                           <span className="text-gray-400">-</span>
                                           <input
                                               type="time"
                                               value={day.morningCloseTime}
                                               onChange={(e) => {
                                                   const newSched = [...(storeProfile.schedule || [])];
                                                   newSched[idx].morningCloseTime = e.target.value;
                                                   setStoreProfile({ ...storeProfile, schedule: newSched });
                                               }}
                                               className="p-1 border rounded text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                               style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                                               disabled={!day.isMorningOpen}
                                           />
                                       </div>
                                       <div className="flex items-center gap-2">
                                           <label className="relative inline-flex items-center cursor-pointer">
                                               <input
                                                   type="checkbox"
                                                   checked={day.isAfternoonOpen}
                                                   onChange={(e) => {
                                                       const newSched = [...(storeProfile.schedule || [])];
                                                       newSched[idx].isAfternoonOpen = e.target.checked;
                                                       setStoreProfile({ ...storeProfile, schedule: newSched });
                                                   }}
                                                   className="sr-only peer"
                                               />
                                               <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                                           </label>
                                           <span className="text-xs font-bold text-gray-500 w-12">Tarde</span>
                                           <input
                                               type="time"
                                               value={day.afternoonOpenTime}
                                               onChange={(e) => {
                                                   const newSched = [...(storeProfile.schedule || [])];
                                                   newSched[idx].afternoonOpenTime = e.target.value;
                                                   setStoreProfile({ ...storeProfile, schedule: newSched });
                                               }}
                                               className="p-1 border rounded text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                               style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                                               disabled={!day.isAfternoonOpen}
                                           />
                                           <span className="text-gray-400">-</span>
                                           <input
                                               type="time"
                                               value={day.afternoonCloseTime}
                                               onChange={(e) => {
                                                   const newSched = [...(storeProfile.schedule || [])];
                                                   newSched[idx].afternoonCloseTime = e.target.value;
                                                   setStoreProfile({ ...storeProfile, schedule: newSched });
                                               }}
                                               className="p-1 border rounded text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                               style={{ colorScheme: isDarkMode ? 'dark' : 'light' }}
                                               disabled={!day.isAfternoonOpen}
                                           />
                                       </div>
                                   </div>
                               </div>
                           ))}
                       </div>
                   </div>
               )}

               {settingsTab === 'PAYMENTS' && (
                   <div className="space-y-3">
                       <p className="text-sm text-gray-500 mb-4">Selecione os métodos de pagamento aceitos na entrega ou retirada.</p>
                       <div className="grid md:grid-cols-2 gap-3">
                           {paymentMethods.map(pm => (
                               <div key={pm.id} onClick={() => handleTogglePaymentMethod(pm.id)} className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${pm.active ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 hover:border-gray-300 dark:bg-slate-800 dark:border-slate-700'}`}>
                                   <span className={`font-bold ${pm.active ? 'text-green-700' : 'text-gray-500 dark:text-gray-400'}`}>{pm.name}</span>
                                   <div className={`w-6 h-6 rounded-full border flex items-center justify-center ${pm.active ? 'bg-green-600 border-green-600' : 'bg-white border-gray-300'}`}>{pm.active && <Check size={14} className="text-white" />}</div>
                               </div>
                           ))}
                       </div>
                       <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
                          <label className="flex items-center gap-3 p-4 border border-gray-200 dark:border-slate-700 rounded-xl cursor-pointer bg-blue-50 dark:bg-blue-900/20">
                              <input type="checkbox" checked={storeProfile.acceptsCardOnDelivery} onChange={(e) => setStoreProfile({...storeProfile, acceptsCardOnDelivery: e.target.checked})} className="w-5 h-5 accent-blue-600" />
                              <div>
                                  <span className="font-bold text-blue-800 dark:text-blue-300 block">Aceitar Cartão na Entrega (Maquininha)</span>
                                  <span className="text-xs text-blue-600 dark:text-blue-400">Permite que o cliente escolha pagar com cartão físico ao receber o pedido.</span>
                              </div>
                          </label>
                       </div>
                       <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800 space-y-4">
                           <div className="flex items-center justify-between">
                               <div>
                                   <p className="font-bold text-slate-800 dark:text-white">PIX Repasse (Online)</p>
                                   <p className="text-xs text-gray-500">Gera QR Code automático e confirma pagamento.</p>
                               </div>
                               <label className="relative inline-flex items-center cursor-pointer">
                                   <input
                                       type="checkbox"
                                       checked={pixRepasseConfig.pix_enabled}
                                       onChange={(e) =>
                                           setPixRepasseConfig((prev) => ({
                                               ...prev,
                                               pix_enabled: e.target.checked
                                           }))
                                       }
                                       className="sr-only peer"
                                   />
                                   <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                               </label>
                           </div>
                           {pixRepasseConfig.pix_enabled && (
                               <div className="grid md:grid-cols-2 gap-4">
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Hash Recebedor 01</label>
                                       <input
                                           type="text"
                                           value={pixRepasseConfig.pix_hash_recebedor_01}
                                           onChange={(e) =>
                                               setPixRepasseConfig((prev) => ({
                                                   ...prev,
                                                   pix_hash_recebedor_01: e.target.value
                                               }))
                                           }
                                           className="w-full p-3 border rounded-xl bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                           placeholder="Informe o hash"
                                       />
                                   </div>
                                   <div>
                                       <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Hash Recebedor 02</label>
                                       <input
                                           type="text"
                                           value={pixRepasseConfig.pix_hash_recebedor_02}
                                           onChange={(e) =>
                                               setPixRepasseConfig((prev) => ({
                                                   ...prev,
                                                   pix_hash_recebedor_02: e.target.value
                                               }))
                                           }
                                           className="w-full p-3 border rounded-xl bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                                           placeholder="Informe o hash"
                                       />
                                   </div>
                               </div>
                           )}
                           {pixRepasseConfig.pix_identificacao_pdv && (
                               <div className="text-xs text-gray-500">
                                   Identificação PDV: <span className="font-mono">{pixRepasseConfig.pix_identificacao_pdv}</span>
                               </div>
                           )}
                           {pixRepasseError && (
                               <div className="text-xs text-red-600">{pixRepasseError}</div>
                           )}
                           {pixRepasseNotice && (
                               <div className="text-xs text-green-600">{pixRepasseNotice}</div>
                           )}
                           <button
                               type="button"
                               onClick={handleSavePixRepasse}
                               disabled={pixRepasseLoading}
                               className="w-full md:w-auto bg-slate-900 text-white px-5 py-2 rounded-xl font-bold hover:opacity-90 disabled:opacity-60"
                           >
                               {pixRepasseLoading ? 'Salvando...' : 'Salvar PIX Repasse'}
                           </button>
                       </div>
                   </div>
               )}

               {settingsTab === 'SECURITY' && (
                   <div className="max-w-2xl animate-fade-in">
                       <h3 className="font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                           <Lock size={20} className="text-red-600" /> Senha Administrativa
                       </h3>
                        <div className="bg-gray-50 dark:bg-slate-800 p-5 rounded-xl border border-gray-200 dark:border-slate-700">
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

               {settingsTab === 'HOMOLOGATION' && (
                   <div className="space-y-4 max-w-3xl animate-fade-in">
                       <div className="bg-amber-50/80 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5">
                           <h3 className="font-bold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-2">
                               <ShieldCheck size={18} /> Homologacao com Qualifaz Entregas
                           </h3>
                           <p className="text-sm text-amber-800 dark:text-amber-300">
                               Gere um Merchant ID unico para esta loja. Essa chave sera usada para sincronizar pedidos com a plataforma Qualifaz Entregas.
                           </p>
                       </div>

                       <div className="bg-white/90 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
                           <div>
                               <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Merchant ID</label>
                               <div className="flex flex-wrap gap-2 items-center">
                                   <input
                                       type="text"
                                       value={storeProfile.merchantId || ''}
                                       readOnly
                                       className="flex-1 min-w-[220px] p-3 border rounded-xl bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-white font-mono text-sm"
                                       placeholder="Ainda nao gerado"
                                   />
                                   <button
                                       type="button"
                                       onClick={handleCopyMerchantId}
                                       disabled={!storeProfile.merchantId}
                                       className="px-4 py-3 rounded-xl font-bold text-sm border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                   >
                                       <Copy size={16} /> Copiar
                                   </button>
                               </div>
                               {storeProfile.merchantIdCreatedAt && (
                                   <p className="text-xs text-slate-500 mt-2">
                                       Gerado em {new Date(storeProfile.merchantIdCreatedAt).toLocaleString()}
                                   </p>
                               )}
                           {storeProfile.merchantIdRevokedAt && !storeProfile.merchantId && (
                               <p className="text-xs text-slate-500 mt-2">
                                   Revogado em {new Date(storeProfile.merchantIdRevokedAt).toLocaleString()}
                               </p>
                           )}
                       </div>

                       {canConfigurePrinter && (
                           <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-2">
                               <h4 className="text-sm font-bold text-slate-800 dark:text-white">Impressao de pedidos</h4>
                               <p className="text-xs text-slate-500 dark:text-slate-400">
                                   Para imprimir pedidos automaticamente, instale o aplicativo Menufaz Print no computador da loja (Windows).
                               </p>
                               <button
                                   type="button"
                                   onClick={() => window.location.assign(printDownloadUrl)}
                                   className="inline-flex items-center justify-center px-4 py-2 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/20"
                               >
                                   Configurar impressora
                               </button>
                           </div>
                       )}
                       {canConfigurePrinter && (
                           <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-2">
                               <h4 className="text-sm font-bold text-slate-800 dark:text-white">Tablet PDV</h4>
                               <p className="text-xs text-slate-500 dark:text-slate-400">
                                   Baixe o APK do tablet PDV para travar a mesa e usar o layout tablet.
                               </p>
                               <button
                                   type="button"
                                   onClick={() => window.location.assign(tabletDownloadUrl)}
                                   className="inline-flex items-center justify-center px-4 py-2 rounded-xl font-bold text-sm bg-slate-900 text-white hover:bg-slate-800 shadow-sm"
                               >
                                   Baixar APK Tablet PDV
                               </button>
                           </div>
                       )}

                       <div className="flex flex-wrap gap-3">
                           <button
                               type="button"
                               onClick={handleGenerateMerchantId}
                                   disabled={merchantActionLoading || !!storeProfile.merchantId}
                                   className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                               >
                                   {merchantActionLoading ? 'Processando...' : 'Gerar Merchant ID'}
                               </button>
                               <button
                                   type="button"
                                   onClick={handleRevokeMerchantId}
                                   disabled={merchantActionLoading || !storeProfile.merchantId}
                                   className="bg-red-600 text-white px-5 py-3 rounded-xl font-bold text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                               >
                                   Revogar
                               </button>
                           </div>
                       </div>
                   </div>
               )}
               {settingsTab === 'EXTRA' && (
                   <div className="space-y-6">
                       <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-5">
                           <div className="flex items-start justify-between gap-4">
                               <div>
                                   <h4 className="text-sm font-extrabold text-slate-800 dark:text-white">Impressao adicional</h4>
                                   <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                       Imprime automaticamente a via do entregador quando o pedido entra em entrega.
                                   </p>
                               </div>
                               <label className="relative inline-flex items-center cursor-pointer">
                                   <input
                                       type="checkbox"
                                       className="sr-only peer"
                                       checked={storeProfile.printDeliveryCourier === true}
                                       onChange={(e) => setStoreProfile({ ...storeProfile, printDeliveryCourier: e.target.checked })}
                                   />
                                   <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-red-500/30 rounded-full peer dark:bg-slate-700 peer-checked:bg-red-600 transition-colors"></div>
                                   <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform"></div>
                               </label>
                           </div>
                       </div>
                       <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-5 space-y-4">
                           <div className="flex items-center justify-between gap-3">
                               <div>
                                   <p className="text-xs font-bold text-gray-500 uppercase">Auto abertura</p>
                                   <p className="text-sm text-gray-500 dark:text-gray-400">Abrir/fechar automaticamente conforme os horarios.</p>
                               </div>
                               <button
                                   onClick={handleToggleAutoOpen}
                                   className={`flex items-center gap-2 px-3 py-2 rounded-full font-bold text-xs transition-all ${
                                       storeProfile.autoOpenClose ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-slate-800 text-gray-500'
                                   }`}
                               >
                                   {storeProfile.autoOpenClose ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                                   {storeProfile.autoOpenClose ? 'Ativo' : 'Inativo'}
                               </button>
                           </div>
                           <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-gray-500">
                               <span className={`px-3 py-1 rounded-full ${availability?.isOpen ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                                   {availability?.isOpen ? 'Loja aberta' : 'Loja fechada'}
                               </span>
                               <span className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                                   {availability?.reason || (availabilityLoading ? 'Carregando...' : 'Sem status')}
                               </span>
                               <span className="px-3 py-1 rounded-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
                                   Proxima mudanca: {availability?.nextChangeAt ? new Date(availability.nextChangeAt).toLocaleString('pt-BR') : '--'}
                               </span>
                           </div>
                       </div>

                       <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-5 space-y-4">
                           <div className="flex items-center justify-between gap-3">
                               <div>
                                   <p className="text-xs font-bold text-gray-500 uppercase">Auto-aceite</p>
                                   <p className="text-sm text-gray-500 dark:text-gray-400">Aceitar pedidos automaticamente ao receber.</p>
                               </div>
                               <button
                                   onClick={handleToggleAutoAccept}
                                   disabled={isAutoAcceptUpdating}
                                   className={`flex items-center gap-2 px-3 py-2 rounded-full font-bold text-xs transition-all ${
                                       isAutoAcceptEnabled ? 'bg-green-600 text-white' : 'bg-gray-200 dark:bg-slate-800 text-gray-500'
                                   } ${isAutoAcceptUpdating ? 'opacity-70 cursor-not-allowed' : ''}`}
                               >
                                   {isAutoAcceptEnabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                                   {isAutoAcceptEnabled ? 'Ativo' : 'Inativo'}
                               </button>
                           </div>
                       </div>

                       <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-5">
                           <label className="flex items-start gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                               <input
                                   type="checkbox"
                                   checked={addressForm.whatsappOrderRequired}
                                   onChange={(e) => setAddressForm({ ...addressForm, whatsappOrderRequired: e.target.checked })}
                                   className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 mt-1"
                               />
                               <span>
                                   Obrigar envio do pedido via WhatsApp
                                   <span className="block text-xs text-gray-500 mt-1 font-normal">
                                       Ao finalizar o pedido, o WhatsApp da loja será aberto automaticamente com os dados completos do pedido.
                                   </span>
                               </span>
                           </label>
                       </div>
                   </div>
               )}

               <div className="mt-8 pt-6 border-t border-gray-100 dark:border-slate-800 flex justify-end">
                   <button onClick={handleSaveStoreSettings} className="bg-red-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-red-700 shadow-lg shadow-red-600/20 flex items-center gap-2"><Save size={20}/> Salvar Alterações</button>
               </div>
                            </div>
                        </div>

                    </div>
                </div>
           </div>
      </div>
  );
  };

  // --- MAIN RENDER LOGIC ---

  // Only block if there's a reason, NOT just because it's closed (isActive=false)
  if (!loading && storeProfile.blockReason && userRole !== 'ADMIN') {
      return renderBlockedScreen();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex font-sans transition-colors duration-300">
      {toast && (
        <div className="fixed top-4 right-4 z-[120] animate-fade-in">
          <div
            className={`flex items-start gap-3 rounded-2xl px-4 py-3 shadow-xl border ${
              toast.tone === 'success'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}
          >
            <AlertCircle size={18} className="mt-0.5" />
            <span className="text-sm font-semibold leading-snug">{toast.message}</span>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <aside className={`fixed md:sticky top-0 left-0 h-screen ${isSidebarCollapsed ? 'w-16' : 'w-56'} bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 z-50 flex flex-col transition-all duration-300 overflow-hidden ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
            <div className={`p-6 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-red-500/30">
                    <LayoutDashboard size={18} />
                </div>
                {!isSidebarCollapsed && (
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">MenuFaz</h2>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Gestor</p>
                </div>
                )}
            </div>
            <div className="flex-1 py-6 px-3 overflow-y-auto">
                {!isSidebarCollapsed && <p className="px-4 text-xs font-bold text-gray-400 mb-4 uppercase">Painel</p>}
                {[
                    { id: 'OVERVIEW', icon: Activity, label: 'Visão Geral' },
                    { id: 'ORDERS', icon: ClipboardList, label: 'Pedidos', count: orders.filter(o => o.status === 'PENDING').length },
                    { id: 'TABLES', icon: Table, label: 'Mesas' },
                    { id: 'SALES', icon: Receipt, label: 'Vendas' }, 
                    { id: 'FINANCE', icon: DollarSign, label: 'Financeiro' }, 
                    { id: 'EXPENSES', icon: Wallet, label: 'Retirada / Entrada' }, 
                    { id: 'MENU', icon: UtensilsCrossed, label: 'Cardápio' },
                    { id: 'STOCK', icon: Database, label: 'Estoque' },
                    { id: 'BUILDABLE_PRODUCTS', icon: Layers, label: 'Cadastro Produto Montável' },
                    { id: 'COUPONS', icon: Ticket, label: 'Cupons' },
                    { id: 'COURIERS', icon: Bike, label: 'Entregadores' },
                    { id: 'CUSTOMERS', icon: Users, label: 'Clientes' },
                    { id: 'SETTINGS', icon: Settings, label: 'Configurações' }
                ].map((item) => (
                    <button 
                        key={item.id}
                        onClick={() => { setActiveSection(item.id as DashboardSection); setIsMobileMenuOpen(false); }}
                        className={`w-full flex items-center justify-between px-4 py-3 mb-1 rounded-xl transition-all font-medium ${activeSection === item.id ? 'bg-red-600 text-white shadow-lg shadow-red-200 dark:shadow-none' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800'} ${isSidebarCollapsed ? 'justify-center' : ''}`}
                    >
                        <div className={`flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center' : ''}`}>
                            <item.icon size={20} />
                            {!isSidebarCollapsed && <span>{item.label}</span>}
                        </div>
                        {!isSidebarCollapsed && item.count ? <span className="bg-white text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">{item.count}</span> : null}
                    </button>
                ))}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-slate-800">
                <button
                    onClick={onBack}
                    className={`w-full flex items-center gap-2 text-gray-500 hover:text-red-600 px-4 py-2 rounded-lg transition-colors text-sm font-medium whitespace-nowrap ${isSidebarCollapsed ? 'justify-center' : ''}`}
                >
                    <LogOut size={16} />
                    {!isSidebarCollapsed && (userRole === 'ADMIN' ? 'Voltar Admin' : 'Sair')}
                </button>
            </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {/* Header */}
          <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 h-16 px-8 flex items-center justify-between sticky top-0 z-30 shadow-sm">
              <div className="flex items-center gap-4">
                  <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden text-slate-600"><Menu /></button>
                  <button onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} className="hidden md:inline-flex p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <Menu size={18} />
                  </button>
                  <h1 className="text-xl font-bold text-slate-800 dark:text-white hidden sm:block">
                      {activeSection === 'OVERVIEW' ? 'Painel de Controle' : 
                       activeSection === 'ORDERS' ? 'Gestão de Pedidos' : 
                       activeSection === 'MENU' ? 'Cardápio Digital' : 
                       activeSection === 'BUILDABLE_PRODUCTS' ? 'Cadastro de Produto Montável' :
                       activeSection === 'COUPONS' ? 'Cupons' :
                       activeSection === 'COURIERS' ? 'Frota de Entregas' :
                       activeSection === 'CUSTOMERS' ? 'Clientes' :
                       activeSection === 'FINANCE' ? 'Financeiro' :
                       activeSection === 'EXPENSES' ? 'Retirada / Entrada' :
                       activeSection === 'STOCK' ? 'Estoque' :
                       activeSection === 'SALES' ? 'Relatório de Vendas' :
                       activeSection === 'SETTINGS' ? 'Configurações' :
                       activeSection === 'TABLES' ? 'Mesas' : activeSection}
                  </h1>
              </div>
              <div className="flex items-center gap-4">
                  <button onClick={toggleTheme} className="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                      {isDarkMode ? <Banknote size={20} /> : <Banknote size={20} />}
                  </button>
                  
                  {(() => {
                      const isManualClosed = availability?.pause?.active === true;
                      const scheduleOpen = availability?.scheduleOpen === true;
                      const manualOpenOutsideSchedule =
                          storeProfile.isActive === true && availability?.scheduleOpen === false && !isManualClosed;
                      const isOpenNow = (availability?.isOpen ?? false) || manualOpenOutsideSchedule;
                      const statusLabel = isOpenNow ? 'Loja aberta' : 'Loja fechada';
                      const reasonLabel = (() => {
                          if (isManualClosed) return 'Fechada manualmente';
                          if (manualOpenOutsideSchedule) return 'Aberta manualmente';
                          if (availability?.reason === 'OPEN_SCHEDULE') return 'Por horário';
                          if (availability?.reason === 'CLOSED_SCHEDULE') return 'Fora do horário';
                          if (availability?.reason === 'NO_SCHEDULE') return 'Sem horário configurado';
                          return 'Status indefinido';
                      })();

                      return (
                          <div className="flex items-center gap-3">
                              <div className={`px-3 py-1 rounded-full border text-xs font-bold flex items-center gap-2 ${isOpenNow ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                                  <div className={`w-2 h-2 rounded-full ${isOpenNow ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></div>
                                  {statusLabel}
                              </div>
                              <span className="text-xs text-gray-500 dark:text-gray-400">{reasonLabel}</span>
                              <button
                                  onClick={handleToggleOpenStore}
                                  disabled={manualStatusUpdating}
                                  className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 border transition-colors ${
                                      isOpenNow
                                          ? 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                          : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                                  } ${manualStatusUpdating ? 'opacity-70 cursor-not-allowed' : ''}`}
                                  aria-label={isOpenNow ? 'Fechar loja' : 'Abrir loja'}
                              >
                                  {manualStatusUpdating && <Loader2 size={14} className="animate-spin" />}
                                  {manualStatusUpdating ? 'Alterando status…' : isOpenNow ? 'Fechar loja' : 'Abrir loja'}
                              </button>
                          </div>
                      );
                  })()}
              </div>
          </header>

          <main className="p-4 sm:p-8 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-slate-700 bg-gray-50 dark:bg-slate-950">
              {activeSection === 'OVERVIEW' && renderOverview()}
              {activeSection === 'SETTINGS' && renderSettings()}
              {activeSection === 'MENU' && renderMenu()}
              {activeSection === 'STOCK' && renderStock()}
              {activeSection === 'BUILDABLE_PRODUCTS' && renderBuildableProducts()}
              {activeSection === 'ORDERS' && renderOrders()}
              {activeSection === 'COUPONS' && renderCoupons()}
              {activeSection === 'COURIERS' && renderCouriers()}
              {activeSection === 'CUSTOMERS' && renderCustomers()}
              {activeSection === 'FINANCE' && renderFinance()}
              {activeSection === 'EXPENSES' && renderExpenses()}
              {activeSection === 'SALES' && renderSales()}
              {activeSection === 'TABLES' && renderTables()}
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
                              {newProduct.imageUrl ? (
                                  <button
                                      type="button"
                                      onClick={handleRemoveProductImage}
                                      className="text-xs font-bold text-red-600 hover:text-red-700"
                                  >
                                      Remover imagem
                                  </button>
                              ) : null}

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
                                <div className="flex gap-2">
                                    <select
                                        value={newProduct.category || ''}
                                        onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                                        className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                    >
                                        <option value="">Selecione</option>
                                        {menuCategories.map((category) => (
                                            <option key={category} value={category}>
                                                {category}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => setShowCategoryModal(true)}
                                        className="px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 font-bold"
                                        title="Cadastrar categoria"
                                    >
                                        +
                                    </button>
                                </div>
                              </div>
                              
                              <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer bg-gray-50 dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                                  <input 
                                    type="checkbox" 
                                    checked={newProduct.isPizza || false} 
                                    onChange={(e) => {
                                        const checked = e.target.checked;
                                        setNewProduct((prev) => {
                                            const nextProduct = {
                                                ...prev,
                                                isPizza: checked,
                                                maxFlavors: checked ? (prev.maxFlavors || 2) : 1,
                                                maxFlavorsBySize: checked
                                                    ? (prev.maxFlavorsBySize || {
                                                        brotinho: 2,
                                                        pequena: 2,
                                                        media: 3,
                                                        grande: 4,
                                                        familia: 5
                                                    })
                                                    : prev.maxFlavorsBySize,
                                                pricingStrategiesAllowed: checked
                                                    ? (prev.pricingStrategiesAllowed || ['NORMAL', 'PROPORCIONAL', 'MAX'])
                                                    : prev.pricingStrategiesAllowed,
                                                defaultPricingStrategy: checked
                                                    ? (prev.defaultPricingStrategy || 'MAX')
                                                    : prev.defaultPricingStrategy,
                                                customerCanChoosePricingStrategy: checked
                                                    ? (prev.customerCanChoosePricingStrategy ?? true)
                                                    : prev.customerCanChoosePricingStrategy
                                            };
                                            if (!checked) return nextProduct;
                                            return {
                                                ...nextProduct,
                                                optionGroups: ensurePizzaSizeGroup(nextProduct.optionGroups)
                                            };
                                        });
                                    }}
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
                                          {[1, 2, 3, 4, 5].map(num => (
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

                                      <div className="border-t border-orange-200 dark:border-orange-800 pt-4 space-y-4">
                                          <div>
                                              <p className="text-xs font-bold text-orange-800 dark:text-orange-300 uppercase mb-2">Limite por tamanho</p>
                                              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                                  {PIZZA_SIZE_OPTIONS.map((size) => {
                                                      const isAvailable = !pizzaSizeGroupForForm || pizzaAvailableSizeKeys.has(size.key);
                                                      return (
                                                          <div key={size.key} className="flex flex-col gap-1">
                                                              <label className={`text-[10px] font-bold uppercase ${isAvailable ? 'text-gray-500' : 'text-gray-300'}`}>{size.label}</label>
                                                              <input
                                                                  type="number"
                                                                  min={1}
                                                                  max={5}
                                                                  disabled={!isAvailable}
                                                                  value={(newProduct.maxFlavorsBySize || {})[size.key] || ''}
                                                                  onChange={(e) => {
                                                                      if (!isAvailable) return;
                                                                      const nextValue = parseInt(e.target.value, 10);
                                                                      setNewProduct({
                                                                          ...newProduct,
                                                                          maxFlavorsBySize: {
                                                                              ...(newProduct.maxFlavorsBySize || {}),
                                                                              [size.key]: Number.isFinite(nextValue) ? nextValue : 1
                                                                          }
                                                                      });
                                                                  }}
                                                                  className={`w-full p-2 border border-orange-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 font-bold ${isAvailable ? 'text-orange-700 dark:text-orange-400' : 'text-gray-300'}`}
                                                                  placeholder="0"
                                                              />
                                                          </div>
                                                      );
                                                  })}
                                              </div>
                                              <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-2">
                                                  Se nao definir, sera usado o maximo geral ({newProduct.maxFlavors || 1}).
                                              </p>
                                          </div>

                                          <div>
                                              <p className="text-xs font-bold text-orange-800 dark:text-orange-300 uppercase mb-2">Regras de preco</p>
                                              <div className="flex flex-wrap gap-2">
                                                  {PRICING_STRATEGIES.map((strategy) => {
                                                      const allowed = newProduct.pricingStrategiesAllowed || [];
                                                      const isChecked = allowed.includes(strategy.id as any);
                                                      return (
                                                          <label key={strategy.id} className="flex items-center gap-2 px-3 py-2 rounded-full border border-orange-200 dark:border-orange-800 text-xs font-bold text-orange-700 dark:text-orange-300 bg-white/80 dark:bg-slate-900/80">
                                                              <input
                                                                  type="checkbox"
                                                                  checked={isChecked}
                                                                  onChange={(e) => {
                                                                      const current = newProduct.pricingStrategiesAllowed || [];
                                                                      if (e.target.checked) {
                                                                          setNewProduct({
                                                                              ...newProduct,
                                                                              pricingStrategiesAllowed: [...current, strategy.id as any]
                                                                          });
                                                                          return;
                                                                      }
                                                                      if (current.length <= 1) return;
                                                                      const next = current.filter((item) => item !== strategy.id);
                                                                      setNewProduct({
                                                                          ...newProduct,
                                                                          pricingStrategiesAllowed: next,
                                                                          defaultPricingStrategy: next.includes(newProduct.defaultPricingStrategy as any)
                                                                              ? newProduct.defaultPricingStrategy
                                                                              : (next[0] as any)
                                                                      });
                                                                  }}
                                                                  className="w-4 h-4 accent-orange-600"
                                                              />
                                                              {strategy.label}
                                                          </label>
                                                      );
                                                  })}
                                              </div>
                                          </div>

                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                              <div>
                                                  <label className="text-xs font-bold text-orange-800 dark:text-orange-300 uppercase mb-1 block">Regra padrao</label>
                                                  <select
                                                      value={newProduct.defaultPricingStrategy || 'MAX'}
                                                      onChange={(e) => setNewProduct({ ...newProduct, defaultPricingStrategy: e.target.value as any })}
                                                      className="w-full p-2 border border-orange-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 font-bold text-orange-700 dark:text-orange-400"
                                                  >
                                                      {(newProduct.pricingStrategiesAllowed || ['NORMAL', 'PROPORCIONAL', 'MAX']).map((strategy) => (
                                                          <option key={strategy} value={strategy}>
                                                              {PRICING_STRATEGIES.find((item) => item.id === strategy)?.label || strategy}
                                                          </option>
                                                      ))}
                                                  </select>
                                              </div>
                                              <label className="flex items-center gap-3 p-3 border border-orange-200 dark:border-orange-800 rounded-lg text-xs font-bold text-orange-700 dark:text-orange-300 bg-white/80 dark:bg-slate-900/80">
                                                  <input
                                                      type="checkbox"
                                                      checked={newProduct.customerCanChoosePricingStrategy ?? true}
                                                      onChange={(e) => setNewProduct({ ...newProduct, customerCanChoosePricingStrategy: e.target.checked })}
                                                      className="w-4 h-4 accent-orange-600"
                                                  />
                                                  Cliente escolhe regra
                                              </label>
                                          </div>
                                      </div>

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
                          <div className="mb-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                  <div>
                                      <h4 className="text-sm font-bold text-slate-800 dark:text-white">Adicionar complementos prontos</h4>
                                      <p className="text-xs text-slate-500 dark:text-slate-400">Aplique grupos prontos para acelerar o cadastro.</p>
                                  </div>
                                  <button
                                      type="button"
                                      onClick={() => {
                                          resetTemplateDraft(null);
                                          setShowOptionGroupTemplateModal(true);
                                      }}
                                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-200"
                                  >
                                      Gerenciar templates
                                  </button>
                              </div>
                              {optionGroupTemplates.length === 0 ? (
                                  <p className="text-xs text-slate-400">Nenhum template cadastrado.</p>
                              ) : (
                                  <div className="space-y-3">
                                      {suggestedTemplates.length > 0 && (
                                          <div className="space-y-2">
                                              <p className="text-[11px] font-bold text-slate-500 uppercase">
                                                  Complementos sugeridos para esta categoria
                                              </p>
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                  {suggestedTemplates.map((template) => {
                                                      const applied = isTemplateApplied(template);
                                                      return (
                                                          <label
                                                              key={template.id}
                                                              className={`flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-600 dark:text-slate-200 ${applied ? 'opacity-70' : ''}`}
                                                          >
                                                              <input
                                                                  type="checkbox"
                                                                  checked={selectedTemplateIds.includes(template.id)}
                                                                  disabled={applied}
                                                                  onChange={(e) => handleToggleTemplateSelection(template.id, e.target.checked)}
                                                                  className="w-4 h-4 accent-red-500"
                                                              />
                                                              <span className="font-semibold">{template.name}</span>
                                                              <div className="ml-auto flex items-center gap-2 text-[11px]">
                                                                  <span className="text-slate-400">{(template.options || []).length} itens</span>
                                                                  {applied && <span className="font-semibold text-emerald-600">Já aplicado</span>}
                                                              </div>
                                                          </label>
                                                      );
                                                  })}
                                              </div>
                                          </div>
                                      )}

                                      {availableTemplates.length > 0 && (
                                          <div className="space-y-2">
                                              <p className="text-[11px] font-bold text-slate-500 uppercase">
                                                  {suggestedTemplates.length > 0 ? 'Outros complementos' : 'Complementos disponíveis'}
                                              </p>
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                  {availableTemplates.map((template) => {
                                                      const applied = isTemplateApplied(template);
                                                      return (
                                                          <label
                                                              key={template.id}
                                                              className={`flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-600 dark:text-slate-200 ${applied ? 'opacity-70' : ''}`}
                                                          >
                                                              <input
                                                                  type="checkbox"
                                                                  checked={selectedTemplateIds.includes(template.id)}
                                                                  disabled={applied}
                                                                  onChange={(e) => handleToggleTemplateSelection(template.id, e.target.checked)}
                                                                  className="w-4 h-4 accent-red-500"
                                                              />
                                                              <span className="font-semibold">{template.name}</span>
                                                              <div className="ml-auto flex items-center gap-2 text-[11px]">
                                                                  <span className="text-slate-400">{(template.options || []).length} itens</span>
                                                                  {applied && <span className="font-semibold text-emerald-600">Já aplicado</span>}
                                                              </div>
                                                          </label>
                                                      );
                                                  })}
                                              </div>
                                          </div>
                                      )}

                                      <div className="flex flex-wrap items-center gap-3">
                                          <button
                                              type="button"
                                              onClick={handleApplySelectedTemplates}
                                              disabled={selectedTemplateIds.length === 0}
                                              className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-60"
                                          >
                                              Aplicar selecionados
                                          </button>
                                          {templateNotice && <span className="text-xs text-emerald-600">{templateNotice}</span>}
                                      </div>
                                  </div>
                              )}
                          </div>
                          <div className="flex justify-between items-center mb-4">
                              <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><Layers size={18}/> Complementos e Opções</h4>
                              <button onClick={handleAddOptionGroup} className="text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg transition-colors">+ Adicionar Grupo</button>
                          </div>
                          
                          <div className="space-y-4">
                              {newProduct.optionGroups?.map((group, gIdx) => {
                                  const isSizeGroup = newProduct.isPizza && isPizzaSizeGroup(group);
                                  return (
                                  <div key={group.id} className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-200 dark:border-slate-700">
                                      <div className="flex items-start gap-4 mb-4">
                                          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                                              <input type="text" value={group.name} onChange={(e) => handleUpdateOptionGroup(group.id, 'name', e.target.value)} className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm font-bold" placeholder="Nome do Grupo" />
                                              <div className="flex items-center gap-2"><span className="text-xs text-gray-500">Mín:</span><input type="number" value={group.min} onChange={(e) => handleUpdateOptionGroup(group.id, 'min', parseInt(e.target.value))} className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" /></div>
                                              <div className="flex items-center gap-2"><span className="text-xs text-gray-500">Máx:</span><input type="number" value={group.max} onChange={(e) => handleUpdateOptionGroup(group.id, 'max', parseInt(e.target.value))} className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" /></div>
                                          </div>
                                          {!isSizeGroup && (
                                              <button onClick={() => handleRemoveOptionGroup(group.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={18}/></button>
                                          )}
                                      </div>
                                      
                                      <div className="pl-4 border-l-2 border-gray-200 dark:border-slate-600 space-y-2">
                                          {group.options.map((opt, oIdx) => (
                                              <div key={opt.id} className="flex items-center gap-2">
                                                  <input type="text" value={opt.name} onChange={(e) => handleUpdateOption(group.id, opt.id, 'name', e.target.value)} className="flex-1 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" placeholder="Nome da Opção" />
                                                  <input
                                                      type="number"
                                                      value={isSizeGroup ? (opt.price > 0 ? opt.price : '') : opt.price}
                                                      onChange={(e) => {
                                                          const raw = e.target.value;
                                                          if (isSizeGroup && raw === '') {
                                                              handleUpdateOption(group.id, opt.id, 'price', 0);
                                                              return;
                                                          }
                                                          handleUpdateOption(group.id, opt.id, 'price', parseFloat(raw));
                                                      }}
                                                      className="w-24 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                                      placeholder="R$ 0.00"
                                                  />
                                                  {isSizeGroup ? (
                                                      <label className="flex items-center gap-1 text-[10px] text-slate-500">
                                                          <input
                                                              type="checkbox"
                                                              checked={opt.isAvailable !== false}
                                                              onChange={(e) => handleUpdateOption(group.id, opt.id, 'isAvailable', e.target.checked)}
                                                              className="w-4 h-4 accent-orange-500 rounded"
                                                          />
                                                          Ativo
                                                      </label>
                                                  ) : (
                                                      <button onClick={() => handleRemoveOption(group.id, opt.id)} className="text-gray-300 hover:text-red-500"><X size={16}/></button>
                                                  )}
                                              </div>
                                          ))}
                                          {!isSizeGroup && (
                                              <button onClick={() => handleAddOptionToGroup(group.id)} className="text-xs font-bold text-blue-600 mt-2 flex items-center gap-1 hover:underline"><Plus size={12}/> Adicionar Opção</button>
                                          )}
                                      </div>
                                  </div>
                              )})}
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

      {/* BUILDABLE PRODUCT MODAL */}
      {showBuildableProductModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-scale-in">
                  <div className="p-6 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center bg-emerald-50 dark:bg-slate-800">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-white">Cadastro de Produto Montável</h3>
                      <label className="flex items-center cursor-pointer gap-2 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm">
                          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Status</span>
                          <div className="relative">
                              <input 
                                  type="checkbox" 
                                  className="sr-only peer" 
                                  checked={buildableProduct.isAvailable !== false} 
                                  onChange={(e) => setBuildableProduct({ ...buildableProduct, isAvailable: e.target.checked })}
                              />
                              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                          </div>
                          <span className={`text-xs font-bold ${buildableProduct.isAvailable !== false ? 'text-emerald-600' : 'text-gray-400'}`}>
                              {buildableProduct.isAvailable !== false ? 'Ativo' : 'Inativo'}
                          </span>
                      </label>
                      <button onClick={() => setShowBuildableProductModal(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors"><X size={20} /></button>
                  </div>

                  <div className="p-6 md:p-8 overflow-y-auto">
                      <div className="grid md:grid-cols-[280px_1fr] gap-8 mb-8">
                          <div className="flex flex-col gap-4">
                              <div 
                                  onClick={() => buildableProductInputRef.current?.click()}
                                  className="aspect-square rounded-xl border-2 border-dashed border-emerald-200 dark:border-slate-700 flex flex-col items-center justify-center text-emerald-500 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800/50 transition-all relative overflow-hidden bg-emerald-50/40 dark:bg-slate-800"
                              >
                                  {buildableProduct.imageUrl ? <img src={buildableProduct.imageUrl} alt="Produto montável" className="w-full h-full object-cover absolute" /> : <><ImageIcon size={40} className="mb-2" /><span>Enviar Foto</span></>}
                              </div>
                              <input type="file" ref={buildableProductInputRef} className="hidden" onChange={(e) => handleFileUpload(e, 'BUILDABLE_PRODUCT')} accept="image/*" />
                              {buildableProduct.imageUrl ? (
                                  <button
                                      type="button"
                                      onClick={handleRemoveBuildableImage}
                                      className="text-xs font-bold text-red-600 hover:text-red-700"
                                  >
                                      Remover imagem
                                  </button>
                              ) : null}

                              <div className="rounded-xl border border-emerald-100 dark:border-slate-700 bg-emerald-50/60 dark:bg-slate-800 p-4 text-xs text-emerald-700 dark:text-emerald-300">
                                  <p className="font-bold mb-1 uppercase">Dica rapida</p>
                                  <p>Comece com um modelo e ajuste minimos, maximos e preços em segundos.</p>
                              </div>
                          </div>

                          <div className="space-y-4">
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Produto Base</label>
                                  <input type="text" value={buildableProduct.name || ''} onChange={(e) => setBuildableProduct({ ...buildableProduct, name: e.target.value })} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" placeholder="Ex: Refeicao do dia - monte do seu jeito" />
                              </div>
                              <div>
                                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descricao (Opcional)</label>
                                  <textarea value={buildableProduct.description || ''} onChange={(e) => setBuildableProduct({ ...buildableProduct, description: e.target.value })} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white" rows={3} placeholder="Explique como funciona o produto." />
                              </div>
                              <div className="grid md:grid-cols-2 gap-4">
                                  <div>
                                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoria</label>
                                      <div className="flex gap-2">
                                          <select
                                              value={buildableProduct.category || ''}
                                              onChange={(e) => setBuildableProduct({ ...buildableProduct, category: e.target.value })}
                                              className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                          >
                                              <option value="">Selecione</option>
                                              {menuCategories.map((category) => (
                                                  <option key={category} value={category}>
                                                      {category}
                                                  </option>
                                              ))}
                                          </select>
                                          <button
                                              type="button"
                                              onClick={() => setShowCategoryModal(true)}
                                              className="px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-200 font-bold"
                                              title="Cadastrar categoria"
                                          >
                                              +
                                          </button>
                                      </div>
                                  </div>
                                  <div>
                                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Modo de preço</label>
                                      <div className="flex gap-2">
                                          <button
                                              onClick={() => setBuildableProduct({ ...buildableProduct, priceMode: 'BASE' })}
                                              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border ${buildableProduct.priceMode !== 'BY_SIZE' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-900 text-slate-500 border-gray-200 dark:border-slate-700'}`}
                                          >
                                              Preço base
                                          </button>
                                          <button
                                              onClick={() => setBuildableProduct({ ...buildableProduct, priceMode: 'BY_SIZE' })}
                                              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border ${buildableProduct.priceMode === 'BY_SIZE' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-900 text-slate-500 border-gray-200 dark:border-slate-700'}`}
                                          >
                                              Por tamanho
                                          </button>
                                      </div>
                                  </div>
                              </div>
                              {buildableProduct.priceMode === 'BY_SIZE' ? (
                                  <div className="rounded-xl border border-emerald-100 dark:border-slate-700 bg-emerald-50/60 dark:bg-slate-800 p-4 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-4">
                                      <span>Use o grupo "Tamanho" para definir preços diferentes.</span>
                                      <button onClick={handleAddSizeGroup} className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-slate-700 font-bold text-xs">
                                          Criar grupo de tamanho
                                      </button>
                                  </div>
                              ) : (
                                  <div>
                                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Preço base (R$)</label>
                                      <input type="number" value={buildableProduct.price || ''} onChange={(e) => setBuildableProduct({ ...buildableProduct, price: parseFloat(e.target.value) })} className="w-full p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white font-bold" placeholder="0.00" />
                                  </div>
                              )}
                          </div>
                      </div>

                      <div className="border-t border-gray-100 dark:border-slate-800 pt-6">
                          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                              <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-2"><Layers size={18}/> Grupos de escolha</h4>
                              <button onClick={handleAddBuildableGroup} className="text-sm font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 px-3 py-1.5 rounded-lg transition-colors">+ Adicionar grupo</button>
                          </div>

                          <div className="space-y-4">
                              {[...(buildableProduct.optionGroups || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((group) => (
                                  <div key={group.id} className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-4 border border-gray-200 dark:border-slate-700">
                                      <div className="flex flex-wrap items-center gap-3 mb-4">
                                          <input type="text" value={group.name} onChange={(e) => handleUpdateBuildableGroup(group.id, 'name', e.target.value)} className="flex-1 min-w-[180px] p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm font-bold" placeholder="Nome do grupo" />
                                          <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                                              Obrigatorio
                                              <input
                                                  type="checkbox"
                                                  checked={group.isRequired || false}
                                                  onChange={(e) => {
                                                      const isRequired = e.target.checked;
                                                      const nextMin = isRequired ? Math.max(1, group.min || 0) : 0;
                                                      handlePatchBuildableGroup(group.id, { isRequired, min: nextMin });
                                                  }}
                                                  className="w-4 h-4 accent-emerald-600 rounded"
                                              />
                                          </label>
                                          <select
                                              value={group.selectionType || (group.max === 1 ? 'SINGLE' : 'MULTIPLE')}
                                              onChange={(e) => {
                                                  const selectionType = e.target.value as 'SINGLE' | 'MULTIPLE';
                                                  const nextMax = selectionType === 'SINGLE' ? 1 : Math.max(2, group.max || 2);
                                                  handlePatchBuildableGroup(group.id, { selectionType, max: nextMax });
                                              }}
                                              className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-xs font-bold"
                                          >
                                              <option value="SINGLE">Escolha unica</option>
                                              <option value="MULTIPLE">Multipla</option>
                                          </select>
                                          <div className="flex items-center gap-2 text-xs text-gray-500">
                                              Min
                                              <input type="number" value={group.min} onChange={(e) => handleUpdateBuildableGroup(group.id, 'min', parseInt(e.target.value))} className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" />
                                          </div>
                                          <div className="flex items-center gap-2 text-xs text-gray-500">
                                              Max
                                              <input type="number" value={group.max} onChange={(e) => handleUpdateBuildableGroup(group.id, 'max', parseInt(e.target.value))} className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" />
                                          </div>
                                          <div className="flex items-center gap-2 text-xs text-gray-500">
                                              Ordem
                                              <input type="number" value={group.order || 0} onChange={(e) => handleUpdateBuildableGroup(group.id, 'order', parseInt(e.target.value))} className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" />
                                          </div>
                                          <button onClick={() => handleRemoveBuildableGroup(group.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={18}/></button>
                                      </div>

                                      <div className="grid md:grid-cols-2 gap-3 mb-4 text-xs text-gray-500">
                                          <div className="flex items-center gap-2">
                                              Regra de adicional (após)
                                              <input type="number" value={group.extraChargeAfter || 0} onChange={(e) => handleUpdateBuildableGroup(group.id, 'extraChargeAfter', parseInt(e.target.value))} className="w-20 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" />
                                          </div>
                                          <div className="flex items-center gap-2">
                                              Valor por extra (R$)
                                              <input type="number" value={group.extraChargeAmount || 0} onChange={(e) => handleUpdateBuildableGroup(group.id, 'extraChargeAmount', parseFloat(e.target.value))} className="w-24 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" />
                                          </div>
                                      </div>

                                      <div className="pl-4 border-l-2 border-gray-200 dark:border-slate-600 space-y-2">
                                          {[...(group.options || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((opt) => (
                                              <div key={opt.id} className="grid md:grid-cols-[1.3fr_0.6fr_0.6fr_0.8fr_auto] gap-2 items-center">
                                                  <input type="text" value={opt.name} onChange={(e) => handleUpdateBuildableOption(group.id, opt.id, 'name', e.target.value)} className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" placeholder="Nome do item" />
                                                  <input type="number" value={opt.price} onChange={(e) => handleUpdateBuildableOption(group.id, opt.id, 'price', parseFloat(e.target.value))} className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" placeholder="R$ 0.00" />
                                                  <input type="number" value={opt.order || 0} onChange={(e) => handleUpdateBuildableOption(group.id, opt.id, 'order', parseInt(e.target.value))} className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" placeholder="Ordem" />
                                                  <input type="text" value={opt.stockProductId || ''} onChange={(e) => handleUpdateBuildableOption(group.id, opt.id, 'stockProductId', e.target.value)} className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm" placeholder="Vinculo estoque" />
                                                  <div className="flex items-center gap-2">
                                                      <label className="flex items-center gap-1 text-xs text-slate-500">
                                                          <input type="checkbox" checked={opt.isAvailable !== false} onChange={(e) => handleUpdateBuildableOption(group.id, opt.id, 'isAvailable', e.target.checked)} className="w-4 h-4 accent-emerald-600 rounded" />
                                                          Ativo
                                                      </label>
                                                      <button onClick={() => handleRemoveBuildableOption(group.id, opt.id)} className="text-gray-300 hover:text-red-500"><X size={16}/></button>
                                                  </div>
                                              </div>
                                          ))}
                                          <button onClick={() => handleAddBuildableOption(group.id)} className="text-xs font-bold text-blue-600 mt-2 flex items-center gap-1 hover:underline"><Plus size={12}/> Adicionar item</button>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {buildableError && <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg font-bold">{buildableError}</div>}
                  </div>
                  <div className="p-6 border-t border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-end gap-3">
                      <button onClick={() => setShowBuildableProductModal(false)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors">Cancelar</button>
                      <button onClick={handleSaveBuildableProduct} className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-transform active:scale-95">Salvar Produto Montável</button>
                  </div>
              </div>
          </div>
      )}

      {/* CATEGORY MANAGER MODAL */}
      {showCategoryModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-scale-in">
                  <div className="p-6 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                          <Tag size={20} className="text-rose-600" /> Categorias do cardapio
                      </h3>
                      <button onClick={() => setShowCategoryModal(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                          <X size={20} />
                      </button>
                  </div>

                  <div className="p-6 flex-1 overflow-y-auto bg-white dark:bg-slate-900 space-y-4">
                      <div className="flex flex-col gap-2">
                          <label className="text-xs font-bold text-gray-500 uppercase">Nova categoria</label>
                          <div className="flex gap-2">
                              <input
                                  type="text"
                                  value={newCategoryName}
                                  onChange={(e) => setNewCategoryName(e.target.value)}
                                  className="flex-1 p-3 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                                  placeholder="Ex: Lanches"
                              />
                              <button
                                  onClick={handleAddMenuCategory}
                                  disabled={isSavingCategories || !newCategoryName.trim()}
                                  className="px-4 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-70"
                              >
                                  Adicionar
                              </button>
                          </div>
                      </div>

                      <div className="space-y-2">
                          <div className="flex items-center justify-between">
                              <p className="text-xs font-bold text-gray-400 uppercase">Cadastradas</p>
                              {categoryOrderNotice && (
                                  <div className="text-xs text-emerald-600">{categoryOrderNotice}</div>
                              )}
                          </div>
                          {menuCategories.length === 0 ? (
                              <p className="text-sm text-gray-400">Nenhuma categoria cadastrada.</p>
                          ) : (
                              <DndContext
                                  sensors={categorySensors}
                                  collisionDetection={closestCenter}
                                  onDragEnd={handleCategoryDragEnd}
                              >
                                  <SortableContext
                                      items={menuCategories}
                                      strategy={verticalListSortingStrategy}
                                  >
                                      <div className="space-y-2">
                                          {menuCategories.map((category) => (
                                              <SortableCategoryItem
                                                  key={category}
                                                  id={category}
                                                  label={category}
                                                  onRemove={() => handleRemoveMenuCategory(category)}
                                                  onEdit={() => handleStartEditCategory(category)}
                                                  isEditing={editingCategory === category}
                                                  editValue={editingCategory === category ? editingCategoryName : category}
                                                  onEditChange={setEditingCategoryName}
                                                  onEditSave={() => handleRenameMenuCategory(category, editingCategoryName)}
                                                  onEditCancel={handleCancelEditCategory}
                                              />
                                          ))}
                                      </div>
                                  </SortableContext>
                              </DndContext>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* OPTION GROUP TEMPLATE MODAL */}
      {showOptionGroupTemplateModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col animate-scale-in">
                  <div className="p-6 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800">
                      <h3 className="font-bold text-lg text-slate-800 dark:text-white flex items-center gap-2">
                          <Layers size={20} className="text-red-500" /> Complementos prontos
                      </h3>
                      <button
                          onClick={() => setShowOptionGroupTemplateModal(false)}
                          className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-full transition-colors"
                      >
                          <X size={20} />
                      </button>
                  </div>

                  <div className="p-6 flex-1 overflow-y-auto bg-white dark:bg-slate-900 space-y-6">
                      <div className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700">
                          <div className="flex items-center justify-between gap-4 mb-4">
                              <h4 className="text-sm font-bold text-gray-600 dark:text-gray-300 uppercase">
                                  {templateDraft.id ? 'Editar template' : 'Criar novo template'}
                              </h4>
                              {templateDraft.id && (
                                  <button
                                      onClick={() => resetTemplateDraft(null)}
                                      className="text-xs font-bold text-slate-500 hover:text-red-600"
                                  >
                                      Cancelar edicao
                                  </button>
                              )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                              <input
                                  type="text"
                                  placeholder="Nome do grupo"
                                  value={templateDraft.name || ''}
                                  onChange={(e) => setTemplateDraft((prev) => ({ ...prev, name: e.target.value }))}
                                  className="md:col-span-2 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm font-bold"
                              />
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                  Min
                                  <input
                                      type="number"
                                      value={templateDraft.min ?? 0}
                                      onChange={(e) => setTemplateDraft((prev) => ({ ...prev, min: parseInt(e.target.value, 10) }))}
                                      className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                  />
                                  Max
                                  <input
                                      type="number"
                                      value={templateDraft.max ?? 1}
                                      onChange={(e) => setTemplateDraft((prev) => ({ ...prev, max: parseInt(e.target.value, 10) }))}
                                      className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                  />
                              </div>
                          </div>

                          <div className="grid md:grid-cols-3 gap-3 mb-4 text-xs text-gray-500">
                              <label className="flex items-center gap-2">
                                  Obrigatorio
                                  <input
                                      type="checkbox"
                                      checked={templateDraft.isRequired || false}
                                      onChange={(e) => {
                                          const isRequired = e.target.checked;
                                          const nextMin = isRequired ? Math.max(1, Number(templateDraft.min || 0)) : 0;
                                          setTemplateDraft((prev) => ({ ...prev, isRequired, min: nextMin }));
                                      }}
                                      className="w-4 h-4 accent-red-600 rounded"
                                  />
                              </label>
                              <label className="flex items-center gap-2">
                                  Tipo
                                  <select
                                      value={templateDraft.selectionType || (Number(templateDraft.max || 1) === 1 ? 'SINGLE' : 'MULTIPLE')}
                                      onChange={(e) => setTemplateDraft((prev) => ({ ...prev, selectionType: e.target.value as any }))}
                                      className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-xs font-bold"
                                  >
                                      <option value="SINGLE">Escolha unica</option>
                                      <option value="MULTIPLE">Multipla</option>
                                  </select>
                              </label>
                              <div className="flex items-center gap-2">
                                  Extra apos
                                  <input
                                      type="number"
                                      value={templateDraft.extraChargeAfter ?? 0}
                                      onChange={(e) => setTemplateDraft((prev) => ({ ...prev, extraChargeAfter: parseInt(e.target.value, 10) }))}
                                      className="w-16 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                  />
                                  Valor
                                  <input
                                      type="number"
                                      value={templateDraft.extraChargeAmount ?? 0}
                                      onChange={(e) => setTemplateDraft((prev) => ({ ...prev, extraChargeAmount: parseFloat(e.target.value) }))}
                                      className="w-20 p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                  />
                              </div>
                          </div>

                          <div className="mb-4">
                              <label className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                                  <input
                                      type="checkbox"
                                      checked={Array.isArray(templateDraft.linkedCategoryIds)}
                                      onChange={(e) =>
                                          setTemplateDraft((prev) => ({
                                              ...prev,
                                              linkedCategoryIds: e.target.checked ? [] : undefined
                                          }))
                                      }
                                      className="w-4 h-4 accent-red-500"
                                  />
                                  Vincular a categorias (opcional)
                              </label>
                              {Array.isArray(templateDraft.linkedCategoryIds) && (
                                  <div className="mt-2 space-y-2">
                                      {menuCategories.length === 0 ? (
                                          <p className="text-xs text-slate-400">
                                              Nenhuma categoria cadastrada.
                                          </p>
                                      ) : (
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              {menuCategories.map((category) => {
                                                  const isChecked = templateDraft.linkedCategoryIds?.includes(category);
                                                  return (
                                                      <label
                                                          key={category}
                                                          className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-600 dark:text-slate-200"
                                                      >
                                                          <input
                                                              type="checkbox"
                                                              checked={!!isChecked}
                                                              onChange={(e) => {
                                                                  setTemplateDraft((prev) => {
                                                                      const current = Array.isArray(prev.linkedCategoryIds)
                                                                          ? prev.linkedCategoryIds
                                                                          : [];
                                                                      const next = e.target.checked
                                                                          ? [...current, category]
                                                                          : current.filter((value) => value !== category);
                                                                      return { ...prev, linkedCategoryIds: next };
                                                                  });
                                                              }}
                                                              className="w-4 h-4 accent-red-500"
                                                          />
                                                          <span className="font-semibold">{category}</span>
                                                      </label>
                                                  );
                                              })}
                                          </div>
                                      )}
                                  </div>
                              )}
                          </div>

                          <div className="pl-4 border-l-2 border-gray-200 dark:border-slate-600 space-y-2">
                              {(templateDraft.options || []).map((opt) => (
                                  <div key={opt.id} className="grid md:grid-cols-[1.2fr_0.5fr_0.5fr_auto] gap-2 items-center">
                                      <input
                                          type="text"
                                          value={opt.name}
                                          onChange={(e) => handleUpdateTemplateOption(opt.id, 'name', e.target.value)}
                                          className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                          placeholder="Nome da opcao"
                                      />
                                      <input
                                          type="number"
                                          value={opt.price}
                                          onChange={(e) => handleUpdateTemplateOption(opt.id, 'price', parseFloat(e.target.value))}
                                          className="p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-sm"
                                          placeholder="R$ 0.00"
                                      />
                                      <label className="flex items-center gap-2 text-xs text-slate-500">
                                          <input
                                              type="checkbox"
                                              checked={opt.isAvailable !== false}
                                              onChange={(e) => handleUpdateTemplateOption(opt.id, 'isAvailable', e.target.checked)}
                                              className="w-4 h-4 accent-red-500 rounded"
                                          />
                                          Ativo
                                      </label>
                                      <button
                                          onClick={() => handleRemoveTemplateOption(opt.id)}
                                          className="text-gray-300 hover:text-red-500"
                                      >
                                          <X size={16} />
                                      </button>
                                  </div>
                              ))}
                              <button
                                  onClick={handleAddTemplateOption}
                                  className="text-xs font-bold text-blue-600 mt-2 flex items-center gap-1 hover:underline"
                              >
                                  <Plus size={12} /> Adicionar opcao
                              </button>
                          </div>

                          {templateError && (
                              <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg font-bold">
                                  {templateError}
                              </div>
                          )}
                          <div className="mt-4 flex items-center gap-3">
                              <button
                                  onClick={handleSaveTemplate}
                                  className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-red-700 flex items-center gap-1"
                              >
                                  <Save size={16} /> {templateDraft.id ? 'Salvar' : 'Criar'}
                              </button>
                              {templateNotice && <span className="text-xs text-emerald-600">{templateNotice}</span>}
                          </div>
                      </div>

                      <div className="space-y-2">
                          <p className="text-xs font-bold text-gray-400 uppercase">Templates cadastrados</p>
                          {optionGroupTemplates.length === 0 ? (
                              <p className="text-sm text-gray-400">Nenhum template cadastrado.</p>
                          ) : (
                              <div className="space-y-2">
                                  {optionGroupTemplates.map((template) => (
                                      <div
                                          key={template.id}
                                          className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900"
                                      >
                                          <div>
                                              <div className="text-sm font-bold text-slate-800 dark:text-white">{template.name}</div>
                                              <div className="text-xs text-slate-400">
                                                  {(template.options || []).length} itens · min {template.min} / max {template.max}
                                              </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                              <button
                                                  onClick={() => handleEditTemplate(template)}
                                                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                              >
                                                  Editar
                                              </button>
                                              <button
                                                  onClick={() => handleDuplicateTemplate(template)}
                                                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                              >
                                                  Duplicar
                                              </button>
                                              <button
                                                  onClick={() => handleDeleteTemplate(template.id)}
                                                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                              >
                                                  Excluir
                                              </button>
                                          </div>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
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
                          <div className="mt-4">
                              <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Preco por tamanho</p>
                                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                          {PIZZA_SIZE_OPTIONS.map((size) => (
                                              <div key={size.key} className="flex flex-col gap-1">
                                                  <label className="text-[10px] font-bold text-gray-400 uppercase">{size.label}</label>
                                                  <input
                                                      type="number"
                                                      value={(newFlavor.pricesBySize || {})[size.key] ?? ''}
                                                      onChange={(e) => {
                                                          const raw = e.target.value;
                                                          const nextPrices = { ...(newFlavor.pricesBySize || {}) } as Record<string, number>;
                                                          if (raw === '') {
                                                              delete nextPrices[size.key];
                                                          } else {
                                                              const parsed = Number(raw);
                                                              if (Number.isFinite(parsed) && parsed > 0) {
                                                                  nextPrices[size.key] = parsed;
                                                              } else {
                                                                  delete nextPrices[size.key];
                                                              }
                                                          }
                                                          setNewFlavor({
                                                              ...newFlavor,
                                                              pricesBySize: nextPrices
                                                          });
                                                      }}
                                                      className="w-full p-2 border rounded bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white text-xs font-bold"
                                                      placeholder="0.00"
                                                  />
                                              </div>
                                          ))}
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
                                          <button
                                              onClick={() => setNewFlavor({ ...flavor, pricesBySize: normalizeFlavorPrices(flavor.pricesBySize) })}
                                              className="p-1.5 text-blue-500 hover:bg-blue-50 rounded"
                                          >
                                              <Edit size={14}/>
                                          </button>
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
