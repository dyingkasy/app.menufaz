import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, Building2, Users, LogOut, Search, CheckCircle, XCircle, Trash2, ExternalLink, TrendingUp, DollarSign, ShieldCheck, Inbox, Phone, MapPin, User, Check, X, Mail, Copy, Send, Loader2, AlertTriangle, Settings, Save, HelpCircle, Info, Lock, Unlock, Banknote, ListChecks, Filter, Upload, Download, Power } from 'lucide-react';
import { Store, StoreRequest, AppSettings, ErrorLogEntry, Product, Order } from '../types';
import { CATEGORIES } from '../constants';
import { getStores, toggleStoreStatus, deleteStore, getStoreRequests, approveStoreRequest, rejectStoreRequest, getAppSettings, saveAppSettings, getErrorLogs, setErrorLogResolved, clearErrorLogs, createStoreWithUser, saveProduct, importProductsBulk, getOrders, getStoreAvailability, pauseStore, resumeStorePause } from '../services/db';
import { formatCurrencyBRL, formatOrderNumber } from '../utils/format';
import { compressImageFile } from '../utils/image';
import { uploadImageKit, deleteImageKit } from '../services/imagekit';
import { fetchCepData } from '../utils/geo';
import { useAuth } from '../contexts/AuthContext';
import emailjs from '@emailjs/browser';
import * as XLSX from 'xlsx';

interface SuperAdminDashboardProps {
    onLogout: () => void;
    onManageStore: (store: Store) => void;
    onAccessApi: () => void;
}

const buildPizzaSizeGroup = () => ({
    id: 'size-group',
    name: 'Tamanho',
    min: 1,
    max: 1,
    options: [
        { id: 'size-brotinho', name: 'Brotinho', price: 0, isAvailable: true, order: 1, stockProductId: '' },
        { id: 'size-pequena', name: 'Pequena', price: 0, isAvailable: true, order: 2, stockProductId: '' },
        { id: 'size-media', name: 'Média', price: 0, isAvailable: true, order: 3, stockProductId: '' },
        { id: 'size-grande', name: 'Grande', price: 0, isAvailable: true, order: 4, stockProductId: '' },
        { id: 'size-familia', name: 'Família', price: 0, isAvailable: true, order: 5, stockProductId: '' }
    ],
    isRequired: true,
    selectionType: 'SINGLE',
    order: 1,
    extraChargeAfter: 0,
    extraChargeAmount: 0
});

const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({ onLogout, onManageStore, onAccessApi }) => {
    const { user } = useAuth();
    const [stores, setStores] = useState<Store[]>([]);
    const [requests, setRequests] = useState<StoreRequest[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'STORES' | 'REQUESTS' | 'USERS' | 'SETTINGS' | 'LOGS'>('OVERVIEW');

    // Settings State
    const [settings, setSettings] = useState<AppSettings>({
        emailJsServiceId: '',
        emailJsTemplateId: '',
        emailJsPublicKey: '',
        errorNotifyEmailEnabled: false,
        errorNotifyEmailTo: '',
        errorNotifyEmailTemplateId: '',
        errorNotifyCooldownSec: 60
    });
    const [savingSettings, setSavingSettings] = useState(false);

    // Error Logs State
    const [logs, setLogs] = useState<ErrorLogEntry[]>([]);
    const [logsTotal, setLogsTotal] = useState(0);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsPage, setLogsPage] = useState(0);
    const [resolvingLogId, setResolvingLogId] = useState<string | null>(null);
    const [clearingLogs, setClearingLogs] = useState(false);
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
    const [logsFilters, setLogsFilters] = useState({
        source: '',
        level: '',
        search: '',
        from: '',
        to: ''
    });

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

    const [categories, setCategories] = useState(CATEGORIES);

    // Create Store State
    const [newStore, setNewStore] = useState({
        ownerName: '',
        name: '',
        email: '',
        password: '',
        phone: '',
        whatsapp: '',
        cep: '',
        street: '',
        number: '',
        district: '',
        city: '',
        state: '',
        complement: '',
        customUrl: '',
        category: 'Lanches',
        deliveryTime: '30-40 min',
        pickupTime: '20-30 min',
        deliveryFee: '5',
        imageUrl: '',
        logoUrl: '',
        imageFileId: '',
        logoFileId: '',
        acceptsDelivery: true,
        acceptsPickup: true,
        acceptsTableOrders: false,
        tableCount: '0'
    });
    const [creatingStore, setCreatingStore] = useState(false);
    const [storeImageName, setStoreImageName] = useState('');
    const [storeLogoName, setStoreLogoName] = useState('');

    // Import Products State
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [importingStoreId, setImportingStoreId] = useState<string | null>(null);
    const [importingProducts, setImportingProducts] = useState(false);
    const [importPreview, setImportPreview] = useState<Array<{
        rowNumber: number;
        name: string;
        price: number;
        category: string;
        description: string;
        imageUrl: string;
        isAvailable: boolean;
        isPizza: boolean;
        errors: string[];
    }>>([]);
    const [showImportModal, setShowImportModal] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (activeTab === 'LOGS') {
            loadLogs(0);
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'LOGS') return;
        if (logs.length === 0) {
            setSelectedLogId(null);
            return;
        }
        const exists = selectedLogId && logs.some((log) => log.id === selectedLogId);
        if (!exists) {
            setSelectedLogId(logs[0].id);
        }
    }, [activeTab, logs, selectedLogId]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [storesData, requestsData, settingsData, ordersData] = await Promise.all([
                getStores(),
                getStoreRequests(),
                getAppSettings(),
                getOrders()
            ]);
            setStores(storesData);
            setRequests(requestsData);
            setSettings((prev) => ({ ...prev, ...settingsData }));
            setOrders(ordersData);

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

    const handleNewStoreCepBlur = async () => {
        const cepData = await fetchCepData(newStore.cep);
        if (cepData) {
            setNewStore(prev => ({
                ...prev,
                street: cepData.street,
                district: cepData.district,
                city: cepData.city,
                state: cepData.state
            }));
        } else if (newStore.cep.replace(/\D/g, '').length === 8) {
            alert('CEP não encontrado.');
        }
    };

    const handleCreateStore = async () => {
        if (!newStore.ownerName.trim() || !newStore.name.trim() || !newStore.city.trim() || !newStore.email.trim() || !newStore.password.trim()) {
            alert('Preencha responsável, nome, cidade, e-mail e senha.');
            return;
        }
        if (!newStore.street.trim() || !newStore.number.trim() || !newStore.state.trim()) {
            alert('Preencha endereço completo (rua, número e estado).');
            return;
        }

        setCreatingStore(true);
        try {
            const payload = {
                ownerName: newStore.ownerName.trim(),
                email: newStore.email.trim(),
                password: newStore.password.trim(),
                phone: newStore.phone.trim(),
                store: {
                    name: newStore.name.trim(),
                    customUrl: newStore.customUrl.trim() || undefined,
                    category: newStore.category,
                    rating: 0,
                    ratingCount: 0,
                    deliveryTime: newStore.deliveryTime.trim() || '30-40 min',
                    pickupTime: newStore.pickupTime.trim() || '20-30 min',
                    deliveryFee: Number(newStore.deliveryFee) || 0,
                    imageUrl: newStore.imageUrl || '',
                    imageFileId: newStore.imageFileId || '',
                    logoUrl: newStore.logoUrl || '',
                    logoFileId: newStore.logoFileId || '',
                    isPopular: false,
                    isActive: true,
                    coordinates: { lat: -23.561684, lng: -46.655981 },
                    acceptsDelivery: newStore.acceptsDelivery,
                    acceptsPickup: newStore.acceptsPickup,
                    acceptsTableOrders: newStore.acceptsTableOrders,
                    tableCount: Math.max(0, Number(newStore.tableCount) || 0),
                    phone: newStore.phone.trim(),
                    whatsapp: newStore.whatsapp.trim(),
                    email: newStore.email.trim(),
                    cep: newStore.cep.trim(),
                    street: newStore.street.trim(),
                    number: newStore.number.trim(),
                    district: newStore.district.trim(),
                    city: newStore.city.trim(),
                    state: newStore.state.trim(),
                    complement: newStore.complement.trim()
                }
            };

            await createStoreWithUser(payload);
            await loadData();
            setNewStore({
                ownerName: '',
                name: '',
                email: '',
                password: '',
                phone: '',
                whatsapp: '',
                cep: '',
                street: '',
                number: '',
                district: '',
                city: '',
                state: '',
                complement: '',
                customUrl: '',
                category: 'Lanches',
                deliveryTime: '30-40 min',
                pickupTime: '20-30 min',
                deliveryFee: '5',
                imageUrl: '',
                logoUrl: '',
                imageFileId: '',
                logoFileId: '',
                acceptsDelivery: true,
                acceptsPickup: true,
                acceptsTableOrders: false,
                tableCount: '0'
            });
            setStoreImageName('');
            setStoreLogoName('');
            alert('Loja criada com sucesso.');
        } catch (error) {
            console.error('Error creating store', error);
            alert('Erro ao criar loja.');
        } finally {
            setCreatingStore(false);
        }
    };

    const handleStoreImageChange = async (file: File | null) => {
        if (!file) return;
        setStoreImageName(file.name);
        try {
            const base64 = await compressImageFile(file, { maxWidth: 1280, maxHeight: 720, mimeType: 'image/jpeg', quality: 0.75 });
            const upload = await uploadImageKit(base64, file.name);
            const previousId = newStore.imageFileId;
            setNewStore((prev) => ({ ...prev, imageUrl: upload.url, imageFileId: upload.fileId }));
            if (previousId) {
                try { await deleteImageKit(previousId); } catch {}
            }
        } catch (error) {
            console.error('Image upload failed', error);
            alert('Falha ao enviar imagem. Tente novamente.');
        }
    };

    const handleStoreLogoChange = async (file: File | null) => {
        if (!file) return;
        setStoreLogoName(file.name);
        try {
            const base64 = await compressImageFile(file, { maxWidth: 384, maxHeight: 384, mimeType: file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 0.8 });
            const upload = await uploadImageKit(base64, file.name);
            const previousId = newStore.logoFileId;
            setNewStore((prev) => ({ ...prev, logoUrl: upload.url, logoFileId: upload.fileId }));
            if (previousId) {
                try { await deleteImageKit(previousId); } catch {}
            }
        } catch (error) {
            console.error('Image upload failed', error);
            alert('Falha ao enviar imagem. Tente novamente.');
        }
    };

    const normalizeHeader = (value: string) =>
        value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '');

    const parsePrice = (value: unknown) => {
        if (typeof value === 'number') return value;
        const raw = String(value || '').trim();
        if (!raw) return 0;

        let cleaned = raw.replace(/[^\d,.-]/g, '');
        cleaned = cleaned.replace(/[,.]+$/g, '');
        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');
        const lastSep = Math.max(lastComma, lastDot);

        if (lastSep >= 0) {
            const digits = cleaned.replace(/[^\d]/g, '');
            const decimals = cleaned.length - lastSep - 1;
            if (!digits) return 0;
            if (decimals <= 0) return Number(digits);
            const intPart = digits.slice(0, -decimals) || '0';
            const decPart = digits.slice(-decimals);
            const parsed = Number(`${intPart}.${decPart}`);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        const parsed = Number(cleaned.replace(/[^\d-]/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const handleImportProductsClick = (storeId: string) => {
        setImportingStoreId(storeId);
        fileInputRef.current?.click();
    };

    const handleImportFile = async (file: File | null) => {
        if (!file || !importingStoreId) return;

        setImportingProducts(true);
        try {
            const extension = file.name.split('.').pop()?.toLowerCase() || '';
            let workbook: XLSX.WorkBook;
            let rows: Array<Array<unknown>> = [];

            if (extension === 'csv') {
                const text = await file.text();
                const firstLine = text.split(/\r?\n/)[0] || '';
                const semicolonCount = (firstLine.match(/;/g) || []).length;
                const commaCount = (firstLine.match(/,/g) || []).length;

                if (semicolonCount === 0 && commaCount > 0) {
                    alert('CSV inválido. Use separador ";" e valores no formato 29,90.');
                    return;
                }

                const parseCsv = (input: string) => {
                    const output: string[][] = [];
                    let row: string[] = [];
                    let value = '';
                    let inQuotes = false;

                    for (let i = 0; i < input.length; i += 1) {
                        const char = input[i];
                        const next = input[i + 1];

                        if (char === '"') {
                            if (inQuotes && next === '"') {
                                value += '"';
                                i += 1;
                            } else {
                                inQuotes = !inQuotes;
                            }
                            continue;
                        }

                        if (!inQuotes && char === ';') {
                            row.push(value);
                            value = '';
                            continue;
                        }

                        if (!inQuotes && (char === '\n' || char === '\r')) {
                            if (char === '\r' && next === '\n') i += 1;
                            row.push(value);
                            output.push(row);
                            row = [];
                            value = '';
                            continue;
                        }

                        value += char;
                    }

                    if (value.length > 0 || row.length > 0) {
                        row.push(value);
                        output.push(row);
                    }

                    return output;
                };

                rows = parseCsv(text).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
            } else {
                const buffer = await file.arrayBuffer();
                workbook = XLSX.read(buffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as Array<Array<unknown>>;
            }

            if (!rows.length) {
                alert('Planilha vazia.');
                return;
            }

            const headers = rows[0].map((h) => normalizeHeader(String(h)));
            const hasNameHeader = headers.includes('nome') || headers.includes('name');
            const hasPriceHeader = headers.includes('preco') || headers.includes('price') || headers.includes('valor');
            if (!hasNameHeader || !hasPriceHeader) {
                alert('A planilha precisa ter as colunas de nome e preço. Para CSV, use separador ";" e mantenha o formato 29,90.');
                return;
            }
            const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));

            const nextCategories = [...categories];
            const categoryLookup = new Set(nextCategories.map((cat) => (cat.name || '').toLowerCase()));
            let categoriesUpdated = false;
            const registerCategory = (value: string) => {
                const trimmed = value.trim();
                if (!trimmed) return 'Lanches';
                const key = trimmed.toLowerCase();
                if (!categoryLookup.has(key)) {
                    nextCategories.push({
                        id: `custom-${Date.now()}-${categoryLookup.size}`,
                        name: trimmed,
                        icon: '🍽️'
                    });
                    categoryLookup.add(key);
                    categoriesUpdated = true;
                }
                return trimmed;
            };
            const previewRows = [];

            for (const row of dataRows) {
                const rowData: Record<string, unknown> = {};
                headers.forEach((header, index) => {
                    rowData[header] = row[index];
                });

                const name = String(rowData.nome || rowData.name || '').trim();
                const categoryRaw = String(rowData.categoria || rowData.category || 'Lanches');
                const category = registerCategory(categoryRaw);
                const price = parsePrice(rowData.preco || rowData.price || rowData.valor);

                const errors = [];
                if (!name) errors.push('Nome obrigatório');
                if (!price) errors.push('Preço inválido');

                previewRows.push({
                    rowNumber: previewRows.length + 2,
                    name,
                    price,
                    category,
                    description: String(rowData.descricao || rowData.description || ''),
                    imageUrl: String(rowData.imagem || rowData.imageurl || ''),
                    isAvailable: String(rowData.disponivel || rowData.isavailable || 'true').toLowerCase() !== 'false',
                    isPizza: String(rowData.pizza || rowData.ispizza || 'false').toLowerCase() === 'true',
                    errors
                });
            }

            setImportPreview(previewRows);
            if (categoriesUpdated) {
                setCategories(nextCategories);
            }
            setShowImportModal(true);
        } catch (error) {
            console.error('Erro ao importar produtos', error);
            alert('Erro ao importar planilha.');
        } finally {
            setImportingProducts(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleConfirmImport = async () => {
        if (!importPreview.length || !importingStoreId) return;
        setImportingProducts(true);
        try {
            const validRows = importPreview.filter((row) => row.errors.length === 0);
            if (validRows.length === 0) {
                alert('Nenhum produto válido para importar.');
                return;
            }
            const items: Array<Omit<Product, 'id'>> = validRows.map((row) => ({
                storeId: importingStoreId,
                name: row.name,
                description: row.description,
                price: row.price,
                promoPrice: undefined,
                discountPercent: undefined,
                discountExpiresAt: undefined,
                imageUrl: row.imageUrl,
                category: row.category,
                isAvailable: row.isAvailable,
                isPizza: row.isPizza,
                allowHalfHalf: false,
                maxFlavors: row.isPizza ? 4 : undefined,
                maxFlavorsBySize: row.isPizza
                    ? { brotinho: 2, pequena: 2, media: 3, grande: 4, familia: 5 }
                    : undefined,
                pricingStrategiesAllowed: row.isPizza ? ['NORMAL', 'PROPORCIONAL', 'MAX'] : undefined,
                defaultPricingStrategy: row.isPizza ? 'MAX' : undefined,
                customerCanChoosePricingStrategy: row.isPizza ? true : undefined,
                availableFlavorIds: [],
                optionGroups: row.isPizza ? [buildPizzaSizeGroup()] : []
            }));

            const result = await importProductsBulk(items);
            alert(`Importação concluída. Criados: ${result.inserted}. Ignorados: ${importPreview.length - validRows.length}.`);
            setShowImportModal(false);
            setImportPreview([]);
            setImportingStoreId(null);
        } catch (error) {
            console.error('Erro ao importar produtos', error);
            alert('Erro ao importar produtos.');
        } finally {
            setImportingProducts(false);
        }
    };

    const handleCancelImport = () => {
        setShowImportModal(false);
        setImportPreview([]);
        setImportingStoreId(null);
    };

    const getTemplateRows = () => [
        ['nome', 'categoria', 'preco', 'descricao', 'imagem', 'disponivel', 'pizza'],
        ['Exemplo Hamburguer', 'Lanches', '29,90', 'Pão brioche + carne 180g', '', 'true', 'false']
    ];

    const handleDownloadTemplate = (format: 'csv' | 'xlsx') => {
        const rows = getTemplateRows();
        if (format === 'csv') {
            const csv = rows
                .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
                .join('\n');
            const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'modelo-produtos-menufaz.csv';
            link.click();
            URL.revokeObjectURL(url);
            return;
        }

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Produtos');
        const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'modelo-produtos-menufaz.xlsx';
        link.click();
        URL.revokeObjectURL(url);
    };

    const loadLogs = async (page: number) => {
        setLogsLoading(true);
        try {
            const limit = 50;
            const offset = page * limit;
            const response = await getErrorLogs({ ...logsFilters, limit, offset });
            setLogs(response.items);
            setLogsTotal(response.total);
            setLogsPage(page);
        } catch (error) {
            console.error('Error loading logs', error);
        } finally {
            setLogsLoading(false);
        }
    };

    const handleToggleLogResolved = async (log: ErrorLogEntry) => {
        setResolvingLogId(log.id);
        try {
            const nextResolved = !log.resolved;
            await setErrorLogResolved(log.id, nextResolved);
            setLogs((prev) => prev.map((item) => (item.id === log.id ? { ...item, resolved: nextResolved } : item)));
        } catch (error) {
            console.error('Error updating log', error);
            alert('Erro ao atualizar o log.');
        } finally {
            setResolvingLogId(null);
        }
    };

    const handleClearLogs = async () => {
        if (!logsTotal) return;
        if (!confirm('Tem certeza que deseja apagar todos os logs?')) return;
        setClearingLogs(true);
        try {
            await clearErrorLogs();
            setLogs([]);
            setLogsTotal(0);
            setLogsPage(0);
        } catch (error) {
            console.error('Error clearing logs', error);
            alert('Erro ao apagar os logs.');
        } finally {
            setClearingLogs(false);
        }
    };

    // --- BLOCKING LOGIC ---

    const isStoreBlocked = (store: Store) =>
        Boolean(store.blockReason) || store.isFinancialBlock === true;

    const handleOpenBlockModal = (store: Store) => {
        if (isStoreBlocked(store)) {
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

    const [manualToggleLoadingId, setManualToggleLoadingId] = useState<string | null>(null);

    const handleManualToggleStore = async (store: Store) => {
        if (manualToggleLoadingId === store.id) return;
        setManualToggleLoadingId(store.id);
        try {
            const availability = await getStoreAvailability(store.id);
            if (availability?.pause?.active) {
                if (!availability.scheduleOpen) {
                    const confirmed = confirm(
                        'A loja está fora do horário configurado agora. Deseja abrir manualmente mesmo assim?'
                    );
                    if (!confirmed) {
                        setManualToggleLoadingId(null);
                        return;
                    }
                }
                const result = await resumeStorePause(store.id);
                const nextAvailability = await getStoreAvailability(store.id);
                setStores((prev) =>
                    prev.map((s) =>
                        s.id === store.id
                            ? {
                                  ...s,
                                  pause: result.pause,
                                  isOpenNow: nextAvailability.isOpen
                              }
                            : s
                    )
                );
                alert('Loja aberta manualmente.');
                return;
            }

            const reason = 'Fechada manualmente pelo Super Admin';
            const minutes = 120;
            const result = await pauseStore(store.id, minutes, reason);
            const nextAvailability = await getStoreAvailability(store.id);
            setStores((prev) =>
                prev.map((s) =>
                    s.id === store.id
                        ? {
                              ...s,
                              pause: result.pause,
                              isOpenNow: nextAvailability.isOpen
                          }
                        : s
                )
            );
            alert('Loja fechada manualmente.');
        } catch (error) {
            alert('Erro ao atualizar status manual.');
        } finally {
            setManualToggleLoadingId(null);
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

            const adminParams = {
                ...templateParams,
                to_email: 'qualifazsistemas@gmail.com'
            };

            const [clientResult, adminResult] = await Promise.allSettled([
                emailjs.send(settings.emailJsServiceId, settings.emailJsTemplateId, templateParams),
                emailjs.send(settings.emailJsServiceId, settings.emailJsTemplateId, adminParams)
            ]);

            const hasFailure = [clientResult, adminResult].some(
                (result) => result.status === 'rejected' || result.value?.status !== 200
            );

            if (hasFailure) {
                throw new Error('EmailJS failed to send activation email(s)');
            }

            setEmailStatus('SUCCESS');

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
        (s.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
        s.id.includes(searchTerm)
    );

    const totalRevenue = orders
        .filter((order) => order.status !== 'CANCELLED')
        .reduce((sum, order) => sum + (order.total || 0), 0);
    const activeStores = stores.filter(s => s.isActive).length;
    const pendingRequests = requests.filter(r => r.status === 'PENDING');
    const totalOrders = orders.length;
    const completedOrders = orders.filter((order) => order.status === 'COMPLETED').length;
    const cancelledOrders = orders.filter((order) => order.status === 'CANCELLED').length;
    const completionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;
    const cancelRate = totalOrders > 0 ? Math.round((cancelledOrders / totalOrders) * 100) : 0;
    const getOrderTimestamp = (order: Order) => {
        if (!order.createdAt) return 0;
        const stamp = Date.parse(order.createdAt);
        return Number.isNaN(stamp) ? 0 : stamp;
    };
    const latestOrders = [...orders]
        .sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a))
        .slice(0, 4);
    const orderStatusMeta = (status: Order['status']) => {
        switch (status) {
            case 'PENDING':
                return { label: 'Pendente', className: 'bg-amber-100 text-amber-700' };
            case 'PREPARING':
                return { label: 'Preparando', className: 'bg-blue-100 text-blue-700' };
            case 'WAITING_COURIER':
                return { label: 'Aguardando', className: 'bg-amber-100 text-amber-700' };
            case 'DELIVERING':
                return { label: 'Em rota', className: 'bg-sky-100 text-sky-700' };
            case 'COMPLETED':
                return { label: 'Concluido', className: 'bg-emerald-100 text-emerald-700' };
            case 'CANCELLED':
                return { label: 'Cancelado', className: 'bg-rose-100 text-rose-700' };
            default:
                return { label: status, className: 'bg-slate-100 text-slate-600' };
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white font-body">
                <div className="w-full max-w-xl px-6">
                    <div className="h-6 w-40 rounded-full skeleton-shimmer mb-6 mx-auto" />
                    <div className="grid grid-cols-2 gap-4">
                        <div className="h-28 rounded-2xl skeleton-shimmer" />
                        <div className="h-28 rounded-2xl skeleton-shimmer" />
                        <div className="h-28 rounded-2xl skeleton-shimmer" />
                        <div className="h-28 rounded-2xl skeleton-shimmer" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#f6f4f1] dark:bg-slate-950 flex font-body relative">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(248,113,113,0.14),transparent_55%)]" />
            {/* Sidebar */}
            <aside className="w-72 bg-slate-950 text-white flex flex-col fixed h-full z-10 border-r border-white/5">
                <div className="p-6 border-b border-white/5 flex items-center gap-3">
                    <div className="w-11 h-11 bg-gradient-to-br from-red-600 via-orange-500 to-amber-400 rounded-2xl flex items-center justify-center shadow-lg">
                        <ShieldCheck size={24} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold tracking-tight font-display">MenuFaz</h2>
                        <p className="text-[10px] text-red-300 font-bold uppercase tracking-[0.3em]">Super Admin</p>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                    <button 
                        onClick={() => setActiveTab('OVERVIEW')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-semibold ${
                            activeTab === 'OVERVIEW'
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        <LayoutDashboard size={20} /> Visão Geral
                    </button>
                    <button 
                        onClick={() => setActiveTab('STORES')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-semibold ${
                            activeTab === 'STORES'
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        <Building2 size={20} /> Empresas
                    </button>
                    <button 
                        onClick={() => setActiveTab('REQUESTS')}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl transition-all text-sm font-semibold ${
                            activeTab === 'REQUESTS'
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
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
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-semibold ${
                            activeTab === 'USERS'
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        <Users size={20} /> Usuários
                    </button>
                    <button 
                        onClick={() => setActiveTab('SETTINGS')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-semibold ${
                            activeTab === 'SETTINGS'
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        <Settings size={20} /> Configurações
                    </button>
                    <button 
                        onClick={() => setActiveTab('LOGS')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-sm font-semibold ${
                            activeTab === 'LOGS'
                                ? 'bg-white text-slate-900 shadow-lg'
                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        <ListChecks size={20} /> Logs de Erro
                    </button>

                    <button
                        onClick={onAccessApi}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-white hover:bg-white/10 transition-all"
                    >
                        <ExternalLink size={20} /> Acessar API
                    </button>
                </nav>

                <div className="p-4 border-t border-white/5">
                    <button 
                        onClick={onLogout}
                        className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-red-600/20 hover:text-red-200 text-slate-300 py-2.5 rounded-xl transition-colors text-sm font-bold"
                    >
                        <LogOut size={16} /> Sair
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-72 p-6 lg:p-8 relative">
                <header className="sticky top-0 z-20 -mx-6 lg:-mx-8 px-6 lg:px-8 py-6 bg-[#f6f4f1]/90 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Painel</p>
                            <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display">
                            {activeTab === 'OVERVIEW' ? 'Visão Geral' : 
                             activeTab === 'STORES' ? 'Gerenciar Empresas' : 
                             activeTab === 'REQUESTS' ? 'Solicitações de Cadastro' : 
                             activeTab === 'SETTINGS' ? 'Configurações do Sistema' :
                             activeTab === 'LOGS' ? 'Monitoramento de Erros' :
                             'Usuários do Sistema'}
                            </h1>
                            <p className="text-gray-500 dark:text-gray-400">Controle total da plataforma MenuFaz.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            {activeTab === 'STORES' && (
                                <div className="relative">
                                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder="Buscar empresa por nome ou ID"
                                        className="pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/80 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-red-500 focus:border-red-400"
                                    />
                                </div>
                            )}
                            <button
                                onClick={loadData}
                                className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 hover:text-red-600 hover:border-red-300 transition-colors text-sm font-bold flex items-center gap-2"
                            >
                                <TrendingUp size={16} /> Atualizar dados
                            </button>
                        </div>
                    </div>
                </header>

                {activeTab === 'OVERVIEW' && (
                    <div className="space-y-8 animate-fade-in">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                            <div className="lg:col-span-7 bg-white/90 dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 shadow-lg p-6 relative overflow-hidden">
                                <div className="absolute -right-24 -top-16 h-48 w-48 rounded-full bg-red-500/10 blur-3xl" />
                                <div className="absolute -left-24 -bottom-20 h-56 w-56 rounded-full bg-orange-400/10 blur-3xl" />
                                <div className="relative z-10">
                                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Panorama Geral</p>
                                    <h3 className="text-3xl font-bold text-slate-900 dark:text-white font-display mt-2">
                                        {formatCurrencyBRL(totalRevenue)}
                                    </h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-300">Receita total em pedidos validos</p>

                                    <div className="mt-6 grid grid-cols-2 gap-4">
                                        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 bg-white/80 dark:bg-slate-900/70">
                                            <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Pedidos</p>
                                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{totalOrders}</p>
                                            <p className="text-xs text-slate-500 mt-1">{completionRate}% concluido · {cancelRate}% cancelado</p>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 bg-white/80 dark:bg-slate-900/70">
                                            <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">Lojas ativas</p>
                                            <p className="text-2xl font-bold text-slate-900 dark:text-white">{activeStores}</p>
                                            <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                                                <div
                                                    className="h-2 rounded-full bg-red-500"
                                                    style={{ width: `${(activeStores / (stores.length || 1)) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-6 flex flex-wrap gap-3">
                                        <button
                                            onClick={() => setActiveTab('REQUESTS')}
                                            className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold shadow-lg shadow-red-600/20"
                                        >
                                            Ver solicitacoes ({pendingRequests.length})
                                        </button>
                                        <button
                                            onClick={() => setActiveTab('STORES')}
                                            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:border-red-300 hover:text-red-600 bg-white"
                                        >
                                            Criar nova loja
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="lg:col-span-5 grid gap-4">
                                <div className="rounded-3xl border border-slate-200/70 dark:border-slate-800 bg-white p-5 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Total empresas</p>
                                            <p className="text-2xl font-bold text-slate-900">{stores.length}</p>
                                        </div>
                                        <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center">
                                            <Building2 size={22} />
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-3">Crescimento organico da rede</p>
                                </div>
                                <div className="rounded-3xl border border-slate-200/70 dark:border-slate-800 bg-white p-5 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Solicitacoes pendentes</p>
                                            <p className="text-2xl font-bold text-slate-900">{pendingRequests.length}</p>
                                        </div>
                                        <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center">
                                            <Inbox size={22} />
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-3">Precisa de aprovacao manual</p>
                                </div>
                                <div className="rounded-3xl border border-slate-200/70 dark:border-slate-800 bg-white p-5 shadow-sm">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Receita global</p>
                                            <p className="text-2xl font-bold text-slate-900">{formatCurrencyBRL(totalRevenue)}</p>
                                        </div>
                                        <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                                            <DollarSign size={22} />
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-3">Pedidos concluidos e ativos</p>
                                </div>
                            </div>

                            <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 shadow-sm p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-slate-900 dark:text-white">Pedidos recentes</h3>
                                    <span className="text-xs text-slate-400">{totalOrders} pedidos no total</span>
                                </div>
                                {latestOrders.length === 0 ? (
                                    <div className="py-10 text-center text-slate-400">Nenhum pedido registrado ainda.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {latestOrders.map((order) => {
                                            const meta = orderStatusMeta(order.status);
                                            return (
                                                <div key={order.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 dark:border-slate-800 p-4 bg-slate-50/80 dark:bg-slate-950/40">
                                                    <div>
                                                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                                            {order.customerName || 'Cliente'}
                                                        </p>
                                                        <p className="text-xs text-slate-500">Pedido #{formatOrderNumber(order)}</p>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${meta.className}`}>{meta.label}</span>
                                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                            {formatCurrencyBRL(order.total || 0)}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 shadow-sm p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="font-bold text-slate-900 dark:text-white">Saude operacional</h3>
                                    <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-600 flex items-center justify-center">
                                        <ShieldCheck size={18} />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex items-center justify-between text-xs text-slate-500">
                                            <span>Conclusao</span>
                                            <span>{completionRate}%</span>
                                        </div>
                                        <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                                            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${completionRate}%` }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between text-xs text-slate-500">
                                            <span>Cancelamentos</span>
                                            <span>{cancelRate}%</span>
                                        </div>
                                        <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                                            <div className="h-2 rounded-full bg-rose-500" style={{ width: `${cancelRate}%` }} />
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 bg-slate-50/80">
                                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Pendencias</p>
                                        <p className="text-2xl font-bold text-slate-900">{pendingRequests.length}</p>
                                        <p className="text-xs text-slate-500 mt-1">Solicitacoes aguardando aprovacao</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'SETTINGS' && (
                    <div className="grid lg:grid-cols-2 gap-8 animate-fade-in">
                        <div className="bg-white/95 dark:bg-slate-900 rounded-3xl shadow-md border border-slate-200/70 dark:border-slate-800 p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-xl flex items-center justify-center text-red-600">
                                    <Mail size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800 dark:text-white font-display">Automação de E-mail</h3>
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
                                        className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 dark:text-gray-300 mb-2">Template ID</label>
                                    <input 
                                        type="text" 
                                        value={settings.emailJsTemplateId}
                                        onChange={(e) => setSettings({...settings, emailJsTemplateId: e.target.value})}
                                        placeholder="Ex: template_xxxxx"
                                        className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-sm font-bold text-slate-700 dark:text-gray-300">Public Key</label>
                                        <a 
                                            href="https://dashboard.emailjs.com/admin/account" 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="text-xs text-red-600 hover:underline flex items-center gap-1"
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
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                </div>
                            </div>
                            
                            <div className="mt-8 flex justify-end">
                                <button 
                                    onClick={handleSaveSettings}
                                    disabled={savingSettings}
                                    className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl flex items-center gap-2 transition-all disabled:opacity-70"
                                >
                                    {savingSettings ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                                    Salvar Configurações
                                </button>
                            </div>
                        </div>

                        <div className="bg-white/95 dark:bg-slate-900 rounded-3xl shadow-md border border-slate-200/70 dark:border-slate-800 p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-xl flex items-center justify-center text-red-600">
                                    <AlertTriangle size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800 dark:text-white font-display">Notificações de Erro</h3>
                                    <p className="text-gray-500 text-sm">Dispare alertas por e-mail e WhatsApp quando ocorrerem erros.</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <label className="flex items-center gap-3 text-sm font-bold text-slate-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={!!settings.errorNotifyEmailEnabled}
                                        onChange={(e) => setSettings({ ...settings, errorNotifyEmailEnabled: e.target.checked })}
                                        className="w-4 h-4"
                                    />
                                    Ativar e-mail de alerta
                                </label>
                                <input
                                    type="text"
                                    value={settings.errorNotifyEmailTo}
                                    onChange={(e) => setSettings({ ...settings, errorNotifyEmailTo: e.target.value })}
                                    placeholder="E-mail de destino"
                                    className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                />
                                <input
                                    type="text"
                                    value={settings.errorNotifyEmailTemplateId}
                                    onChange={(e) => setSettings({ ...settings, errorNotifyEmailTemplateId: e.target.value })}
                                    placeholder="Template ID (opcional)"
                                    className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                />

                                <div className="border-t border-gray-100 dark:border-slate-800 pt-4">
                                    <label className="block text-sm font-bold text-slate-700 dark:text-gray-300 mb-2">Cooldown entre alertas (segundos)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={settings.errorNotifyCooldownSec}
                                        onChange={(e) => setSettings({ ...settings, errorNotifyCooldownSec: Number(e.target.value) })}
                                        className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                    />
                                </div>
                            </div>

                            <div className="mt-8 flex justify-end">
                                <button 
                                    onClick={handleSaveSettings}
                                    disabled={savingSettings}
                                    className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl flex items-center gap-2 transition-all disabled:opacity-70"
                                >
                                    {savingSettings ? <Loader2 className="animate-spin" /> : <Save size={18} />}
                                    Salvar Configurações
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'LOGS' && (
                    (() => {
                        const selectedLog = logs.find((log) => log.id === selectedLogId) || (logs[0] || null);
                        const stats = logs.reduce(
                            (acc, log) => {
                                acc.total += 1;
                                if (log.level === 'error') acc.errors += 1;
                                if (log.level === 'warning') acc.warnings += 1;
                                if (log.level === 'info') acc.info += 1;
                                if (!log.resolved) acc.open += 1;
                                return acc;
                            },
                            { total: 0, errors: 0, warnings: 0, info: 0, open: 0 }
                        );

                        return (
                            <div className="space-y-6 animate-fade-in">
                                <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white p-6 shadow-2xl">
                                    <div className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-red-500/30 blur-3xl"></div>
                                    <div className="absolute -bottom-20 -left-10 h-44 w-44 rounded-full bg-red-500/20 blur-3xl"></div>
                                    <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
                                        <div>
                                            <p className="text-xs uppercase tracking-[0.2em] text-red-200">Observatorio de Erros</p>
                                            <h2 className="text-2xl font-bold font-display">Radar em tempo real</h2>
                                            <p className="text-sm text-slate-300">Visualize sinais, contexto e resolucoes em um unico painel.</p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                onClick={() => loadLogs(0)}
                                                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-bold flex items-center gap-2"
                                            >
                                                <Search size={16} /> Atualizar
                                            </button>
                                            <button
                                                onClick={handleClearLogs}
                                                disabled={clearingLogs || logsLoading || logsTotal === 0}
                                                className="px-4 py-2 rounded-xl bg-white text-slate-900 text-sm font-bold disabled:opacity-60"
                                            >
                                                {clearingLogs ? 'Limpando...' : 'Zerar logs'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="relative z-10 grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <p className="text-xs text-slate-300">Total</p>
                                            <p className="text-xl font-bold">{stats.total}</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <p className="text-xs text-slate-300">Abertos</p>
                                            <p className="text-xl font-bold">{stats.open}</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <p className="text-xs text-slate-300">Erros</p>
                                            <p className="text-xl font-bold text-red-300">{stats.errors}</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <p className="text-xs text-slate-300">Warnings</p>
                                            <p className="text-xl font-bold text-yellow-200">{stats.warnings}</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <p className="text-xs text-slate-300">Info</p>
                                            <p className="text-xl font-bold text-blue-200">{stats.info}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white/95 dark:bg-slate-900 rounded-3xl shadow-md border border-slate-200/70 dark:border-slate-800 p-6">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="flex items-center gap-2 text-slate-600 dark:text-gray-300 font-bold">
                                            <Filter size={18} /> Filtros inteligentes
                                        </div>
                                        <div className="ml-auto flex gap-2">
                                            <button
                                                onClick={() => loadLogs(0)}
                                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center gap-2 text-sm shadow-md shadow-red-600/20"
                                        >
                                            <Search size={14} /> Aplicar
                                        </button>
                                            <button
                                                onClick={() => {
                                                    setLogsFilters({ source: '', level: '', search: '', from: '', to: '' });
                                                    loadLogs(0);
                                                }}
                                                className="px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-xl font-bold text-gray-500 dark:text-gray-300 text-sm"
                                            >
                                                Limpar
                                            </button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
                                        <input
                                            type="text"
                                            value={logsFilters.search}
                                            onChange={(e) => setLogsFilters({ ...logsFilters, search: e.target.value })}
                                            placeholder="Buscar mensagem"
                                            className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                        <select
                                            value={logsFilters.source}
                                            onChange={(e) => setLogsFilters({ ...logsFilters, source: e.target.value })}
                                            className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-xl outline-none bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        >
                                            <option value="">Fonte (todas)</option>
                                            <option value="server">server</option>
                                            <option value="client">client</option>
                                        </select>
                                        <select
                                            value={logsFilters.level}
                                            onChange={(e) => setLogsFilters({ ...logsFilters, level: e.target.value })}
                                            className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-xl outline-none bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        >
                                            <option value="">Nivel (todos)</option>
                                            <option value="error">error</option>
                                            <option value="warning">warning</option>
                                            <option value="info">info</option>
                                        </select>
                                        <input
                                            type="date"
                                            value={logsFilters.from}
                                            onChange={(e) => setLogsFilters({ ...logsFilters, from: e.target.value })}
                                            className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-xl outline-none bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                        <input
                                            type="date"
                                            value={logsFilters.to}
                                            onChange={(e) => setLogsFilters({ ...logsFilters, to: e.target.value })}
                                            className="w-full p-3 border border-slate-200 dark:border-slate-700 rounded-xl outline-none bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                </div>

                                <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] gap-6">
                                    <div className="bg-white/95 dark:bg-slate-900 rounded-3xl shadow-md border border-slate-200/70 dark:border-slate-800 p-6">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="font-bold text-slate-800 dark:text-white">Fluxo de Sinais</h3>
                                            <span className="text-sm text-gray-400">{logsTotal} registros</span>
                                        </div>
                                        {logsLoading ? (
                                            <div className="flex items-center justify-center py-16">
                                                <Loader2 className="animate-spin text-red-500" />
                                            </div>
                                        ) : logs.length === 0 ? (
                                            <div className="text-center text-gray-400 py-12">
                                                Nenhum log encontrado.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {logs.map((log) => {
                                                    const isActive = selectedLog?.id === log.id;
                                                    return (
                                                        <button
                                                            key={log.id}
                                                            onClick={() => setSelectedLogId(log.id)}
                                                            className={`w-full text-left rounded-2xl border p-4 transition-all ${
                                                                isActive
                                                                    ? 'border-red-500 bg-red-50 dark:bg-red-900/30'
                                                                    : 'border-slate-200/80 dark:border-slate-800 hover:border-red-300 hover:bg-red-50/40 dark:hover:bg-slate-800'
                                                            }`}
                                                        >
                                                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                                <span className="font-bold text-slate-700 dark:text-gray-200">{log.source}</span>
                                                                <span className={`px-2 py-0.5 rounded-full font-bold ${log.level === 'error' ? 'bg-red-100 text-red-600' : log.level === 'warning' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-600'}`}>
                                                                    {log.level}
                                                                </span>
                                                                <span className={`px-2 py-0.5 rounded-full font-bold ${log.resolved ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                                                                    {log.resolved ? 'Resolvido' : 'Aberto'}
                                                                </span>
                                                                <span>{new Date(log.createdAt).toLocaleString('pt-BR')}</span>
                                                            </div>
                                                            <p className="font-semibold text-slate-800 dark:text-white mt-2">{log.message}</p>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {logsTotal > 0 && (
                                            <div className="flex items-center justify-between mt-6">
                                                <button
                                                    onClick={() => loadLogs(Math.max(logsPage - 1, 0))}
                                                    disabled={logsPage === 0}
                                                    className="px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-500 disabled:opacity-50"
                                                >
                                                    Anterior
                                                </button>
                                                <span className="text-sm text-gray-500">
                                                    Pagina {logsPage + 1} de {Math.max(1, Math.ceil(logsTotal / 50))}
                                                </span>
                                                <button
                                                    onClick={() => loadLogs(Math.min(logsPage + 1, Math.ceil(logsTotal / 50) - 1))}
                                                    disabled={logsPage >= Math.ceil(logsTotal / 50) - 1}
                                                    className="px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-lg text-sm font-bold text-gray-500 disabled:opacity-50"
                                                >
                                                    Proxima
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-white/95 dark:bg-slate-900 rounded-3xl shadow-md border border-slate-200/70 dark:border-slate-800 p-6 lg:sticky lg:top-24 self-start">
                                        <div className="flex items-center justify-between mb-4">
                                            <h3 className="font-bold text-slate-800 dark:text-white">Inspecao</h3>
                                            {selectedLog && (
                                                <span className="text-xs text-gray-400">ID {selectedLog.id.slice(0, 8)}</span>
                                            )}
                                        </div>
                                        {!selectedLog ? (
                                            <div className="text-sm text-gray-400">Selecione um log para ver detalhes.</div>
                                        ) : (
                                            <div className="space-y-4">
                                                <div>
                                                    <p className="text-xs uppercase text-gray-400">Mensagem</p>
                                                    <p className="font-semibold text-slate-800 dark:text-white">{selectedLog.message}</p>
                                                </div>
                                                <div className="flex flex-wrap gap-2 text-xs">
                                                    <span className="px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">{selectedLog.source}</span>
                                                    <span className={`px-2 py-1 rounded-full font-bold ${selectedLog.level === 'error' ? 'bg-red-100 text-red-600' : selectedLog.level === 'warning' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-600'}`}>
                                                        {selectedLog.level}
                                                    </span>
                                                    <span className={`px-2 py-1 rounded-full font-bold ${selectedLog.resolved ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                                                        {selectedLog.resolved ? 'Resolvido' : 'Aberto'}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-400">
                                                    {new Date(selectedLog.createdAt).toLocaleString('pt-BR')}
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleToggleLogResolved(selectedLog)}
                                                        disabled={resolvingLogId === selectedLog.id}
                                                        className={`flex-1 px-3 py-2 text-xs rounded-lg font-bold ${selectedLog.resolved ? 'border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300' : 'bg-emerald-600 text-white'} disabled:opacity-60`}
                                                    >
                                                        {selectedLog.resolved ? 'Reabrir' : 'Marcar resolvido'}
                                                    </button>
                                                </div>
                                                {selectedLog.stack && (
                                                    <div>
                                                        <p className="text-xs uppercase text-gray-400 mb-2">Stack</p>
                                                        <pre className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-800 p-3 rounded-lg overflow-x-auto max-h-48">{selectedLog.stack}</pre>
                                                    </div>
                                                )}
                                                {selectedLog.context && Object.keys(selectedLog.context).length > 0 && (
                                                    <div>
                                                        <p className="text-xs uppercase text-gray-400 mb-2">Contexto</p>
                                                        <pre className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-800 p-3 rounded-lg overflow-x-auto max-h-48">
                                                            {JSON.stringify(selectedLog.context, null, 2)}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                            </div>
                        );
                    })()
                )}

                {activeTab === 'REQUESTS' && (
                    <div className="space-y-4 animate-fade-in">
                        {pendingRequests.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-96 bg-white/95 dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 text-gray-400">
                                <Inbox size={48} className="mb-4 opacity-20" />
                                <p>Nenhuma solicitação pendente.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {pendingRequests.map(req => (
                                    <div key={req.id} className="bg-white/95 dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 p-6 shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-xl flex items-center justify-center text-red-600">
                                                <Building2 size={24} />
                                            </div>
                                            <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                                                Pendente
                                            </span>
                                        </div>
                                        
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1 font-display">{req.storeName}</h3>
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
                    <div className="space-y-6 animate-fade-in">
                        <div className="bg-white/95 dark:bg-slate-900 rounded-3xl shadow-md border border-slate-200/70 dark:border-slate-800 p-7">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-xl flex items-center justify-center text-red-600">
                                    <Building2 size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800 dark:text-white font-display">Criar Loja</h3>
                                    <p className="text-gray-500 text-sm">Cadastro direto sem aprovação.</p>
                                </div>
                            </div>
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Responsavel</label>
                                        <p className="text-xs text-gray-400 mb-2">Pessoa que administra a loja.</p>
                                        <input
                                            type="text"
                                            value={newStore.ownerName}
                                            onChange={(e) => setNewStore({ ...newStore, ownerName: e.target.value })}
                                            placeholder="Nome do responsavel"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Telefone</label>
                                        <p className="text-xs text-gray-400 mb-2">Contato do responsavel.</p>
                                        <input
                                            type="tel"
                                            value={newStore.phone}
                                            onChange={(e) => setNewStore({ ...newStore, phone: e.target.value })}
                                            placeholder="Telefone do responsavel"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">WhatsApp</label>
                                        <p className="text-xs text-gray-400 mb-2">Numero que recebe pedidos.</p>
                                        <input
                                            type="tel"
                                            value={newStore.whatsapp}
                                            onChange={(e) => setNewStore({ ...newStore, whatsapp: e.target.value })}
                                            placeholder="WhatsApp do comercio"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">E-mail de login</label>
                                        <p className="text-xs text-gray-400 mb-2">Usado para acessar o painel.</p>
                                        <input
                                            type="email"
                                            value={newStore.email}
                                            onChange={(e) => setNewStore({ ...newStore, email: e.target.value })}
                                            placeholder="E-mail de login"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Senha</label>
                                        <p className="text-xs text-gray-400 mb-2">Senha inicial do acesso.</p>
                                        <input
                                            type="password"
                                            value={newStore.password}
                                            onChange={(e) => setNewStore({ ...newStore, password: e.target.value })}
                                            placeholder="Senha de login"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Nome da loja</label>
                                        <p className="text-xs text-gray-400 mb-2">Nome exibido no app.</p>
                                        <input
                                            type="text"
                                            value={newStore.name}
                                            onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                                            placeholder="Nome da loja"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Categoria</label>
                                        <p className="text-xs text-gray-400 mb-2">Ajuda nos filtros e busca.</p>
                                        <select
                                            value={newStore.category}
                                            onChange={(e) => setNewStore({ ...newStore, category: e.target.value })}
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        >
                                            {categories.map((cat) => (
                                                <option key={cat.id} value={cat.name}>{cat.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">URL personalizada</label>
                                        <p className="text-xs text-gray-400 mb-2">Opcional. Ex: pizzaria-do-joao.</p>
                                        <input
                                            type="text"
                                            value={newStore.customUrl}
                                            onChange={(e) => setNewStore({ ...newStore, customUrl: e.target.value })}
                                            placeholder="URL personalizada (ex: pizzaria-do-joao)"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Tempo de entrega</label>
                                        <p className="text-xs text-gray-400 mb-2">Exibido no checkout.</p>
                                        <input
                                            type="text"
                                            value={newStore.deliveryTime}
                                            onChange={(e) => setNewStore({ ...newStore, deliveryTime: e.target.value })}
                                            placeholder="Tempo de entrega (ex: 30-40 min)"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Tempo de retirada</label>
                                        <p className="text-xs text-gray-400 mb-2">Mostra para retirada.</p>
                                        <input
                                            type="text"
                                            value={newStore.pickupTime}
                                            onChange={(e) => setNewStore({ ...newStore, pickupTime: e.target.value })}
                                            placeholder="Tempo de retirada (ex: 20-30 min)"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Taxa de entrega</label>
                                        <p className="text-xs text-gray-400 mb-2">Use 0 para entrega gratis.</p>
                                        <input
                                            type="number"
                                            min="0"
                                            value={newStore.deliveryFee}
                                            onChange={(e) => setNewStore({ ...newStore, deliveryFee: e.target.value })}
                                            placeholder="Taxa de entrega"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">CEP</label>
                                        <p className="text-xs text-gray-400 mb-2">Endereco do comercio.</p>
                                        <input
                                            type="text"
                                            value={newStore.cep}
                                            onChange={(e) => setNewStore({ ...newStore, cep: e.target.value })}
                                            onBlur={handleNewStoreCepBlur}
                                            placeholder="CEP"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Rua</label>
                                        <p className="text-xs text-gray-400 mb-2">Logradouro completo.</p>
                                        <input
                                            type="text"
                                            value={newStore.street}
                                            onChange={(e) => setNewStore({ ...newStore, street: e.target.value })}
                                            placeholder="Rua / Logradouro"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Numero</label>
                                        <p className="text-xs text-gray-400 mb-2">Numero do local.</p>
                                        <input
                                            type="text"
                                            value={newStore.number}
                                            onChange={(e) => setNewStore({ ...newStore, number: e.target.value })}
                                            placeholder="Numero"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Bairro</label>
                                        <p className="text-xs text-gray-400 mb-2">Usado para entregas.</p>
                                        <input
                                            type="text"
                                            value={newStore.district}
                                            onChange={(e) => setNewStore({ ...newStore, district: e.target.value })}
                                            placeholder="Bairro"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Cidade</label>
                                        <p className="text-xs text-gray-400 mb-2">Usada para filtros.</p>
                                        <input
                                            type="text"
                                            value={newStore.city}
                                            onChange={(e) => setNewStore({ ...newStore, city: e.target.value })}
                                            placeholder="Cidade"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Estado</label>
                                        <p className="text-xs text-gray-400 mb-2">Ex: SP, MG, RJ.</p>
                                        <input
                                            type="text"
                                            value={newStore.state}
                                            onChange={(e) => setNewStore({ ...newStore, state: e.target.value })}
                                            placeholder="Estado (UF)"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Complemento</label>
                                        <p className="text-xs text-gray-400 mb-2">Opcional.</p>
                                        <input
                                            type="text"
                                            value={newStore.complement}
                                            onChange={(e) => setNewStore({ ...newStore, complement: e.target.value })}
                                            placeholder="Complemento"
                                            className="w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-500 uppercase mb-1">Mesas</label>
                                        <p className="text-xs text-gray-400 mb-2">Ative “Aceita Mesa” para editar.</p>
                                        <input
                                            type="number"
                                            min="0"
                                            value={newStore.tableCount}
                                            onChange={(e) => setNewStore({ ...newStore, tableCount: e.target.value })}
                                            placeholder="Quantidade de mesas"
                                            disabled={!newStore.acceptsTableOrders}
                                            className={`w-full p-3 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 bg-gray-50 dark:bg-slate-800 dark:text-white ${newStore.acceptsTableOrders ? '' : 'opacity-60 cursor-not-allowed'}`}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase">Logo</label>
                                        <p className="text-xs text-gray-400">Mostrada para clientes. Recomendado: 512x512 px.</p>
                                        <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-600 dark:text-slate-200 cursor-pointer hover:border-red-400">
                                            <Upload size={16} />
                                            {storeLogoName || 'Selecionar logo'}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => handleStoreLogoChange(e.target.files?.[0] || null)}
                                                className="hidden"
                                            />
                                        </label>
                                        {newStore.logoUrl ? (
                                            <>
                                                <img
                                                    src={newStore.logoUrl}
                                                    alt="Logo"
                                                    className="h-16 w-16 rounded-full object-cover border border-gray-200 dark:border-slate-700"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        if (!confirm('Remover logo da loja?')) return;
                                                        const previousId = newStore.logoFileId;
                                                        if (previousId) {
                                                            try { await deleteImageKit(previousId); } catch {}
                                                        }
                                                        setNewStore((prev) => ({ ...prev, logoUrl: '', logoFileId: '' }));
                                                        setStoreLogoName('');
                                                    }}
                                                    className="text-xs font-bold text-red-600 hover:text-red-700"
                                                >
                                                    Remover logo
                                                </button>
                                            </>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-xs font-bold text-gray-500 uppercase">Capa</label>
                                        <p className="text-xs text-gray-400">Imagem destaque no topo. Recomendado: 1600x900 px.</p>
                                        <label className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-600 dark:text-slate-200 cursor-pointer hover:border-red-400">
                                            <Upload size={16} />
                                            {storeImageName || 'Selecionar capa'}
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => handleStoreImageChange(e.target.files?.[0] || null)}
                                                className="hidden"
                                            />
                                        </label>
                                        {newStore.imageUrl ? (
                                            <>
                                                <img
                                                    src={newStore.imageUrl}
                                                    alt="Preview"
                                                    className="h-16 w-full rounded-lg object-cover border border-gray-200 dark:border-slate-700"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        if (!confirm('Remover capa da loja?')) return;
                                                        const previousId = newStore.imageFileId;
                                                        if (previousId) {
                                                            try { await deleteImageKit(previousId); } catch {}
                                                        }
                                                        setNewStore((prev) => ({ ...prev, imageUrl: '', imageFileId: '' }));
                                                        setStoreImageName('');
                                                    }}
                                                    className="text-xs font-bold text-red-600 hover:text-red-700"
                                                >
                                                    Remover capa
                                                </button>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 mt-4">
                                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={newStore.acceptsDelivery}
                                        onChange={(e) => setNewStore({ ...newStore, acceptsDelivery: e.target.checked })}
                                        className="w-4 h-4"
                                    />
                                    Aceita Delivery
                                </label>
                                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={newStore.acceptsPickup}
                                        onChange={(e) => setNewStore({ ...newStore, acceptsPickup: e.target.checked })}
                                        className="w-4 h-4"
                                    />
                                    Aceita Retirada
                                </label>
                                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={newStore.acceptsTableOrders}
                                        onChange={(e) => setNewStore({ ...newStore, acceptsTableOrders: e.target.checked })}
                                        className="w-4 h-4"
                                    />
                                    Aceita Mesa
                                </label>
                                <button
                                    onClick={handleCreateStore}
                                    disabled={creatingStore}
                                    className="ml-auto px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold flex items-center gap-2 disabled:opacity-70"
                                >
                                    {creatingStore ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                                    Criar Loja
                                </button>
                            </div>
                        </div>

                        <div className="bg-white/95 dark:bg-slate-900 rounded-3xl shadow-md border border-slate-200/70 dark:border-slate-800 overflow-hidden">
                        <div className="p-6 border-b border-slate-200/70 dark:border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display">Lojas cadastradas</h3>
                                <p className="text-sm text-slate-500">{filteredStores.length} lojas na rede</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => handleDownloadTemplate('csv')}
                                    className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-slate-800"
                                >
                                    <Download size={16} /> Baixar CSV
                                </button>
                                <button
                                    onClick={() => handleDownloadTemplate('xlsx')}
                                    className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg font-bold text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                                >
                                    <Download size={16} /> Baixar XLSX
                                </button>
                            </div>
                        </div>

                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-slate-50 dark:bg-slate-800 text-left">
                                        <tr>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Empresa</th>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Categoria</th>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Status</th>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Avaliação</th>
                                            <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-right">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                        {filteredStores.map((store) => {
                                            const ratingCount = Number(store.ratingCount ?? 0);
                                            const ratingValue = Number(store.rating) || 0;
                                            const ratingLabel = ratingCount > 0 ? ratingValue.toFixed(1) : 'Sem avaliações';
                                            const isBlocked = isStoreBlocked(store);
                                            const isClosed = !isBlocked && (store.isOpenNow === false || store.pause?.active);
                                            const statusLabel = isBlocked ? 'Bloqueada' : isClosed ? 'Fechada' : 'Aberta';
                                            const statusClasses = isBlocked
                                                ? 'bg-red-50 text-red-700 border-red-200'
                                                : isClosed
                                                ? 'bg-slate-100 text-slate-600 border-slate-200'
                                                : 'bg-green-50 text-green-700 border-green-200';

                                            return (
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
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 border ${statusClasses}`}>
                                                        {isBlocked ? <XCircle size={12} /> : isClosed ? <XCircle size={12} /> : <CheckCircle size={12} />}
                                                        {statusLabel}
                                                    </span>
                                                </td>
                                                <td className={`px-6 py-4 text-sm font-bold ${ratingCount > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
                                                    ⭐ {ratingLabel}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => handleManualToggleStore(store)}
                                                            className={`p-2 text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors ${
                                                                manualToggleLoadingId === store.id ? 'opacity-60 cursor-not-allowed' : ''
                                                            }`}
                                                            title={store.pause?.active ? 'Abrir loja manualmente' : 'Fechar loja manualmente'}
                                                            disabled={manualToggleLoadingId === store.id}
                                                        >
                                                            <Power size={18} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleOpenBlockModal(store)}
                                                            className={`p-2 ${isBlocked ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-rose-600 bg-rose-50 hover:bg-rose-100'} rounded-lg transition-colors`}
                                                            title={isBlocked ? 'Desbloquear loja' : 'Bloquear loja'}
                                                        >
                                                            {isBlocked ? <Unlock size={18} /> : <Lock size={18} />}
                                                        </button>
                                                        <button 
                                                            onClick={() => onManageStore(store)}
                                                            className="p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors" 
                                                            title="Acessar Painel da Loja"
                                                        >
                                                            <ExternalLink size={18} />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleImportProductsClick(store.id)}
                                                            className="p-2 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                                            title="Importar produtos"
                                                        >
                                                            <Upload size={18} />
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
                                        );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,.xls,.xlsx"
                            className="hidden"
                            onChange={(e) => handleImportFile(e.target.files?.[0] || null)}
                            disabled={importingProducts}
                        />
                    </div>
                )}

                {activeTab === 'USERS' && (
                    <div className="flex flex-col items-center justify-center h-96 bg-white/95 dark:bg-slate-900 rounded-3xl border border-slate-200/70 dark:border-slate-800 text-gray-400">
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

            {showImportModal && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
                        <div className="p-5 border-b border-gray-200 dark:border-slate-800 flex justify-between items-center">
                            <h3 className="font-bold text-lg text-slate-800 dark:text-white">Pré-visualização da importação</h3>
                            <button onClick={handleCancelImport} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 max-h-[70vh] overflow-y-auto">
                            <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                                Linhas válidas: {importPreview.filter((row) => row.errors.length === 0).length} ·
                                Linhas com erro: {importPreview.filter((row) => row.errors.length > 0).length}
                            </div>
                            <div className="space-y-3">
                                {importPreview.map((row) => (
                                    <div key={row.rowNumber} className="border border-gray-100 dark:border-slate-800 rounded-xl p-4">
                                        <div className="flex items-center justify-between text-sm">
                                            <div className="font-bold text-slate-800 dark:text-white">
                                                Linha {row.rowNumber} · {row.name || 'Sem nome'}
                                            </div>
                                            <div className="text-gray-500">
                                                {row.price ? formatCurrencyBRL(row.price) : '--'}
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                            Categoria: {row.category} · Disponível: {row.isAvailable ? 'Sim' : 'Não'} · Pizza: {row.isPizza ? 'Sim' : 'Não'}
                                        </div>
                                        {row.errors.length > 0 && (
                                            <div className="mt-2 text-xs text-red-600">
                                                {row.errors.join(' · ')}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="p-5 border-t border-gray-200 dark:border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={handleCancelImport}
                                className="px-4 py-2 border border-gray-200 dark:border-slate-700 rounded-lg font-bold text-gray-600 dark:text-gray-300"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmImport}
                                disabled={importingProducts}
                                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold flex items-center gap-2 disabled:opacity-70"
                            >
                                {importingProducts ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                                Importar produtos
                            </button>
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
