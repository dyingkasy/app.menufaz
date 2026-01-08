import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Utensils } from 'lucide-react';
import { Order, Store } from '../types';
import { subscribeToTableOrders } from '../services/db';

interface TableTrackingProps {
  store: Store;
  tableNumber: string;
  tableSessionId: string;
  onBack: () => void;
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
  onBack
}) => {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToTableOrders(store.id, tableNumber, tableSessionId, (next) => {
      setOrders(next);
    });
    return () => unsubscribe();
  }, [store.id, tableNumber, tableSessionId]);

  const activeOrders = useMemo(
    () => orders.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status)),
    [orders]
  );
  const historyOrders = useMemo(
    () => orders.filter((order) => ['COMPLETED', 'CANCELLED'].includes(order.status)),
    [orders]
  );

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
      </main>
    </div>
  );
};

export default TableTracking;
