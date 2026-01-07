
import React, { useState } from 'react';
import { Star, MessageSquare, User, X, ThumbsUp } from 'lucide-react';
import { Review } from '../types';

interface StoreReviewsProps {
  reviews: Review[];
  onAddReview: (rating: number, comment: string) => void;
  storeName: string;
}

const StoreReviews: React.FC<StoreReviewsProps> = ({ reviews, onAddReview, storeName }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newRating, setNewRating] = useState(5);
  const [newComment, setNewComment] = useState('');
  
  const averageRating = reviews.length > 0 
    ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1) 
    : '0.0';

  const handleSubmit = () => {
    if (newComment.trim().length < 3) {
        alert('Por favor, escreva um comentário.');
        return;
    }
    onAddReview(newRating, newComment);
    setIsModalOpen(false);
    setNewComment('');
    setNewRating(5);
  };

  return (
    <div className="animate-fade-in">
        <div className="flex items-center justify-between mb-6">
            <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-1">Avaliações</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">O que os clientes dizem sobre {storeName}</p>
            </div>
            <button 
                onClick={() => setIsModalOpen(true)}
                className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg font-bold text-sm hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex items-center gap-2"
            >
                <MessageSquare size={16} /> Avaliar Loja
            </button>
        </div>

        {/* Stats Summary */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 mb-8 flex items-center gap-8">
            <div className="text-center">
                <div className="text-4xl font-extrabold text-slate-800 dark:text-white mb-1">{averageRating}</div>
                <div className="flex justify-center gap-0.5 mb-1">
                    {[1, 2, 3, 4, 5].map(star => (
                        <Star 
                            key={star} 
                            size={14} 
                            className={star <= Math.round(Number(averageRating)) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-slate-700'} 
                        />
                    ))}
                </div>
                <div className="text-xs text-gray-400">{reviews.length} avaliações</div>
            </div>
            
            <div className="flex-1 h-24 flex flex-col justify-center gap-1 border-l border-gray-100 dark:border-slate-800 pl-8">
                {[5, 4, 3, 2, 1].map(star => {
                    const count = reviews.filter(r => Math.round(r.rating) === star).length;
                    const percent = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                        <div key={star} className="flex items-center gap-3 text-xs">
                            <span className="w-3 font-bold text-gray-500">{star}</span>
                            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${percent}%` }}></div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* Reviews List */}
        <div className="space-y-4">
            {reviews.length === 0 ? (
                <div className="text-center py-10 text-gray-400">
                    <MessageSquare size={40} className="mx-auto mb-2 opacity-20"/>
                    <p>Nenhuma avaliação ainda. Seja o primeiro!</p>
                </div>
            ) : (
                reviews.map(review => (
                    <div key={review.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gray-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400">
                                    <User size={20} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800 dark:text-white text-sm">{review.userName}</h4>
                                    <div className="flex items-center gap-2">
                                        <div className="flex gap-0.5">
                                            {[1, 2, 3, 4, 5].map(star => (
                                                <Star 
                                                    key={star} 
                                                    size={10} 
                                                    className={star <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-slate-700'} 
                                                />
                                            ))}
                                        </div>
                                        <span className="text-[10px] text-gray-400">{new Date(review.date).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-3">
                            "{review.comment}"
                        </p>
                        
                        {/* Resposta da Loja */}
                        {review.reply && (
                            <div className="mt-3 bg-gray-50 dark:bg-slate-800/50 p-3 rounded-lg border-l-2 border-red-500">
                                <p className="text-xs font-bold text-slate-700 dark:text-white mb-1 flex items-center gap-1">
                                    <ThumbsUp size={12} /> Resposta do estabelecimento
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                                    {review.reply}
                                </p>
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>

        {/* Modal de Avaliação */}
        {isModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
                    <div className="p-5 border-b border-gray-100 dark:border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-lg text-slate-800 dark:text-white">Avaliar {storeName}</h3>
                        <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full text-gray-500">
                            <X size={20} />
                        </button>
                    </div>
                    
                    <div className="p-6">
                        <div className="flex justify-center mb-6 gap-2">
                            {[1, 2, 3, 4, 5].map(star => (
                                <button 
                                    key={star}
                                    onClick={() => setNewRating(star)}
                                    className="p-1 transition-transform hover:scale-110 focus:outline-none"
                                >
                                    <Star 
                                        size={32} 
                                        className={`transition-colors ${star <= newRating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 dark:text-slate-700'}`} 
                                    />
                                </button>
                            ))}
                        </div>
                        
                        <div className="mb-4">
                            <label className="block text-sm font-bold text-slate-700 dark:text-gray-300 mb-2">Seu comentário</label>
                            <textarea 
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                placeholder="Conte como foi sua experiência..."
                                className="w-full p-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-red-500 text-sm dark:text-white min-h-[120px]"
                            />
                        </div>
                        
                        <button 
                            onClick={handleSubmit}
                            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl shadow-lg transition-all"
                        >
                            Enviar Avaliação
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default StoreReviews;