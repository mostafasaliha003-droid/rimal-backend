import { useState } from 'react';
import { ArrowLeft, ChevronLeft, Heart, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import TopNavigationBar from './components/TopNavigationBar';
import HeroSearchSection from './components/HeroSearchSection';
import HotelRoomCard from './components/HotelRoomCard';
import { StarIcon } from './components/Icons';

const sampleRooms = [
    { name: 'جونيور سويت بإطلالة على المدينة', price: '433.06' },
    { name: 'غرفة ديلوكس بسرير كينج', price: '517.40' }
];

export default function App() {
    const [searched, setSearched] = useState(false);
    const [saved, setSaved] = useState(false);

    return (
        <div className="min-h-screen bg-remal-bg text-remal-dark">
            <TopNavigationBar />
            <main>
                <HeroSearchSection onSearch={() => setSearched(true)} />
                <section className="mx-auto max-w-7xl px-5 pb-20 pt-6 lg:px-10 lg:pt-0">
                    <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.2em] text-remal-blue">{searched ? 'نتائج البحث' : 'اختيارات رمال'}</p>
                            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">فنادق تحسّها على كيفك</h2>
                            <p className="mt-2 text-sm font-bold text-slate-400">خيارات مرتبة بعناية عشان تلقى مكانك أسرع</p>
                        </div>
                        <button type="button" className="flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 transition hover:border-remal-blue hover:text-remal-blue"><SlidersHorizontal size={15} /> ترتيب وفلترة</button>
                    </div>

                    <div className="grid gap-8 lg:grid-cols-[1.1fr_2fr]">
                        <aside className="hidden rounded-3xl border border-slate-100 bg-white p-6 lg:block">
                            <div className="mb-6 flex items-center justify-between"><h3 className="font-black">اختياراتك</h3><button className="text-xs font-bold text-remal-blue">إعادة ضبط</button></div>
                            <div className="space-y-6 text-sm">
                                <div><div className="mb-3 flex justify-between font-black"><span>الميزانية</span><span className="text-remal-blue">AED 200 - 800</span></div><div className="relative h-1.5 rounded-full bg-slate-100"><div className="absolute inset-x-10 h-full rounded-full bg-remal-blue" /><span className="absolute right-9 -top-1.5 h-4 w-4 rounded-full border-2 border-remal-blue bg-white" /><span className="absolute left-9 -top-1.5 h-4 w-4 rounded-full border-2 border-remal-blue bg-white" /></div></div>
                                <div className="border-t border-slate-100 pt-5"><p className="mb-3 font-black">تصنيف الفندق</p><div className="flex gap-2">{[3, 4, 5].map((star) => <button key={star} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black transition hover:border-remal-gold hover:text-amber-700">{star} <StarIcon size={12} className="text-remal-gold" fill="currentColor" /></button>)}</div></div>
                                <div className="border-t border-slate-100 pt-5"><p className="mb-3 font-black">مزايا الإقامة</p>{['إلغاء مجاني', 'إفطار مشمول', 'واي فاي مجاني'].map((item) => <label key={item} className="mb-3 flex items-center gap-3 text-xs font-bold text-slate-500"><input type="checkbox" className="h-4 w-4 accent-remal-blue" /> {item}</label>)}</div>
                            </div>
                        </aside>

                        <div className="space-y-5">
                            <div className="flex items-center justify-between rounded-2xl bg-remal-dark px-5 py-4 text-white"><div><p className="text-xs font-bold text-white/60">اقتراح اليوم</p><p className="mt-1 text-sm font-black">فندق بارك حياة دبي</p></div><div className="flex items-center gap-2 text-sm font-black text-remal-gold">9.2 <StarIcon size={15} fill="currentColor" /></div></div>
                            {sampleRooms.map((room) => <HotelRoomCard key={room.name} room={room} onBook={() => setSearched(true)} />)}
                            <div className="flex items-center justify-between rounded-2xl border border-dashed border-slate-300 bg-white/60 p-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600"><ShieldCheck size={20} /></div><div><p className="text-sm font-black">حجزك محمي معنا</p><p className="mt-1 text-[11px] font-bold text-slate-400">دفع آمن ودعم حقيقي وقت تحتاجه</p></div></div><button onClick={() => setSaved(!saved)} className={`rounded-full p-2.5 transition ${saved ? 'bg-remal-red text-white' : 'bg-slate-100 text-slate-400 hover:text-remal-red'}`} aria-label="حفظ الفندق"><Heart size={18} fill={saved ? 'currentColor' : 'none'} /></button></div>
                        </div>
                    </div>
                </section>
            </main>
            <footer className="border-t border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-xs font-bold text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-10"><span>© 2026 رمال وفِلّها</span><div className="flex gap-5"><a href="#">مساعدة</a><a href="#">الشروط والأحكام</a><a href="#">تواصل معنا</a></div><button className="flex items-center gap-1 text-remal-blue">العودة للأعلى <ChevronLeft size={14} /></button></div></footer>
        </div>
    );
}
