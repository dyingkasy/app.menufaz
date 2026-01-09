
import React from 'react';
import { Star, Clock, Lock } from 'lucide-react';
import { Store } from '../types';
import { formatCurrencyBRL } from '../utils/format';

interface StoreCardProps {
  store: Store;
  onClick: (store: Store) => void;
}

const StoreCard: React.FC<StoreCardProps> = ({ store, onClick }) => {
  const ratingCount = Number(store.ratingCount ?? 0);
  const ratingValue = Number(store.rating) || 0;
  const ratingLabel = ratingCount > 0 ? ratingValue.toFixed(1) : 'Novo';

  return (
    <div 
      onClick={() => onClick(store)}
      className={`group bg-white dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-xl border border-gray-100 dark:border-slate-700 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col h-full ${!store.isActive ? 'grayscale opacity-90 hover:scale-100' : 'hover:scale-[1.02]'}`}
    >
      <div className="relative h-40 overflow-hidden">
        <img 
          src={store.imageUrl} 
          alt={store.name} 
          className="w-full h-full object-cover transform group-hover:scale-110 transition-transform duration-700 ease-out"
        />
        {store.isPopular && store.isActive && (
          <span className="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-sm z-10">
            Popular
          </span>
        )}
        {!store.isActive && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
             <span className="bg-slate-800 text-white px-4 py-1.5 rounded-lg font-bold text-sm flex items-center gap-2 border border-slate-600 shadow-lg">
                <Lock size={14} /> FECHADO
             </span>
          </div>
        )}
        <div className={`absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 ${store.isActive ? 'group-hover:opacity-100' : ''} transition-opacity duration-300`} />
      </div>
      
      <div className="p-4 flex flex-col flex-grow relative">
        <div className="flex justify-between items-start mb-1">
          <h3 className="font-bold text-gray-800 dark:text-white text-lg line-clamp-1 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
            {store.name}
          </h3>
          <div className={`flex items-center gap-1 font-semibold text-sm ${ratingCount > 0 ? 'text-yellow-500' : 'text-gray-400'}`}>
            <Star size={14} fill={ratingCount > 0 ? 'currentColor' : 'none'} />
            {ratingLabel}
          </div>
        </div>
        
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">{store.category}</p>
        
        <div className="mt-auto flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-slate-700 pt-3 group-hover:border-red-100 dark:group-hover:border-red-900/30 transition-colors">
          <div className="flex items-center gap-1">
            <Clock size={14} />
            {store.deliveryTime}{store.acceptsPickup && store.pickupTime ? ` • Retirada ${store.pickupTime}` : ''}
          </div>
          <div className={(Number(store.deliveryFee) || 0) === 0 ? 'text-green-600 dark:text-green-400 font-bold' : ''}>
            {(Number(store.deliveryFee) || 0) === 0 ? 'Entrega Grátis' : formatCurrencyBRL(Number(store.deliveryFee) || 0)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoreCard;
