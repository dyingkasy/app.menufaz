import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Utensils, ShoppingBag, CreditCard, QrCode, Banknote } from 'lucide-react';
import { Order, Store } from '../types';
import { formatCurrencyBRL } from '../utils/format';
import { subscribeToTableOrders } from '../services/db';

interface TableTrackingProps {
  store: Store;
  tableNumber: string;
  tableSessionId: string;
  onBack: () => void;
  isTabletMode?: boolean;
}

const STATUS_LABELS: Record<Order['status'], string> = {
  PENDING: 'Aguardando',
  PREPARING: 'Preparando',
  WAITING_COURIER: 'Pronto',
  DELIVERING: 'Saiu para entrega',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado'
};

const TableTracking: React.FC<TableTrackingProps> = ({
  store,
  tableNumber,
  tableSessionId,
  onBack,
  isTabletMode = false
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [showAccount, setShowAccount] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToTableOrders(store.id, tableNumber, tableSessionId, (next) => {
      setOrders(next);
    });
    return () => unsubscribe();
  }, [store.id, tableNumber, tableSessionId]);
  useEffect(() => {
    if (!isTabletMode) return;
    try {
      if (sessionStorage.getItem('tablet_show_account') === '1') {
        sessionStorage.removeItem('tablet_show_account');
        setShowAccount(true);
      }
    } catch {}
  }, [isTabletMode]);

  const activeOrders = useMemo(
    () => orders.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status)),
    [orders]
  );
  const historyOrders = useMemo(
    () => orders.filter((order) => ['COMPLETED', 'CANCELLED'].includes(order.status)),
    [orders]
  );
  const ordersTotal = useMemo(
    () => orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
    [orders]
  );
  const tabletNameKey = useMemo(() => {
    if (!isTabletMode) return '';
    if (!tableNumber) return '';
    return `tablet_customer_name:${store.id}:${tableNumber}`;
  }, [isTabletMode, store.id, tableNumber]);
  const allPaid = useMemo(() => {
    if (!orders.length) return false;
    return orders.every((order) => order.paymentStatus === 'PAID' || order.status === 'COMPLETED');
  }, [orders]);

  useEffect(() => {
    if (!isTabletMode) return;
    if (!allPaid || !tabletNameKey) return;
    try {
      localStorage.removeItem(tabletNameKey);
    } catch {}
  }, [isTabletMode, allPaid, tabletNameKey]);

  const paymentOptions = useMemo(() => {
    const options: Array<{ label: string; icon: React.ReactNode }> = [];
    const methods = Array.isArray(store.paymentMethods) ? store.paymentMethods : [];
    const activeMethods = methods.filter((method) => method?.active !== false);
    if (store.pix_enabled === true && store.pix_hashes_configured === true) {
      options.push({ label: 'PIX (online)', icon: <QrCode size={16} /> });
    }
    const hasPixOffline = activeMethods.some((method) => method?.type === 'PIX');
    if (hasPixOffline) {
      options.push({ label: 'PIX', icon: <QrCode size={16} /> });
    }
    const hasCard = store.acceptsCardOnDelivery || activeMethods.some((method) => method?.type === 'CARD');
    if (hasCard) {
      options.push({ label: 'Cartão', icon: <CreditCard size={16} /> });
    }
    const hasMoney = activeMethods.some((method) => method?.type === 'MONEY');
    if (hasMoney) {
      options.push({ label: 'Dinheiro', icon: <Banknote size={16} /> });
    }
    if (options.length === 0) {
      options.push({ label: 'Consulte a loja', icon: <Banknote size={16} /> });
    }
    return options;
  }, [store]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-sans pb-20">
      <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 sticky top-0 z-20 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors">
            <ArrowLeft className="text-slate-700 dark:text-white" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-slate-800 dark:text-white">Acompanhar mesa</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">{store.name} • Mesa {tableNumber}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {isTabletMode && (
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase mb-3">Formas de pagamento</h2>
            <div className="flex flex-wrap gap-3">
              {paymentOptions.map((option) => (
                <div
                  key={option.label}
                  className="flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-200"
                >
                  {option.icon}
                  {option.label}
                </div>
              ))}
            </div>
          </section>
        )}
        {orders.length === 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-6 text-center text-gray-500 dark:text-gray-400">
            Nenhum pedido encontrado para esta mesa.
          </div>
        )}

        {activeOrders.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase">Em andamento</h2>
            {activeOrders.map((order) => (
              <div key={order.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-white">
                    <Utensils size={16} className="text-red-600" />
                    Pedido {order.id.slice(0, 6).toUpperCase()}
                  </div>
                  <span className="text-xs font-bold text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-full">
                    {STATUS_LABELS[order.status]}
                  </span>
                </div>
                <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                  {order.items.map((item, index) => (
                    <div key={`${order.id}-item-${index}`}>{item}</div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {historyOrders.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase">Finalizados</h2>
            {historyOrders.map((order) => (
              <div key={order.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-white">
                    <Utensils size={16} className="text-slate-500" />
                    Pedido {order.id.slice(0, 6).toUpperCase()}
                  </div>
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-full">
                    {STATUS_LABELS[order.status]}
                  </span>
                </div>
                <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                  {order.items.map((item, index) => (
                    <div key={`${order.id}-item-${index}`}>{item}</div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        {isTabletMode && showAccount && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white">Conta da mesa</h3>
                  <p className="text-xs text-gray-500">Mesa {tableNumber}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAccount(false)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-700"
                >
                  Fechar
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-3">
                {orders.length === 0 && (
                  <p className="text-sm text-slate-500">Nenhum pedido registrado.</p>
                )}
                {orders.map((order) => (
                  <div key={order.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
                    <div className="flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <span>Pedido {order.id.slice(0, 6).toUpperCase()}</span>
                      <span>{formatCurrencyBRL(order.total)}</span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-500">
                      {order.items.map((item, index) => (
                        <div key={`${order.id}-account-${index}`}>{item}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between text-sm font-bold text-slate-700 dark:text-slate-200">
                <span>Total atual</span>
                <span>{formatCurrencyBRL(ordersTotal)}</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default TableTracking;
