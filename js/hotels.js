// js/hotels.js
const API_URL = 'https://rimal-api.onrender.com';
let currentUser = JSON.parse(localStorage.getItem('rimal_current_user')) || null;
let gMap, gMarkers = [];

const UI_ICONS = {
    hotel: `<svg class="w-5 h-5 md:w-6 md:h-6 fill-[#00b4d8]" viewBox="0 0 512 512"><path d="M64 32C28.7 32 0 60.7 0 96v352c0 17.7 14.3 32 32 32h128v-96c0-17.7 14.3-32 32-32h128c17.7 0 32 14.3 32 32v96h128c17.7 0 32-14.3 32-32V96c0-35.3-28.7-64-64-64H64zM128 160h64c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16h-64c-8.8 0-16-7.2-16-16v-32c0-8.8 7.2-16 16-16zm192 0h64c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16h-64c-8.8 0-16-7.2-16-16v-32c0-8.8 7.2-16 16-16zm192 0h64c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16h-64c-8.8 0-16-7.2-16-16v-32c0-8.8 7.2-16 16-16zm192 0h64c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16h-64c-8.8 0-16-7.2-16-16v-32c0-8.8 7.2-16 16-16z"/></svg>`,
    food: `<svg class="w-3.5 h-3.5 fill-amber-600" viewBox="0 0 448 512"><path d="M416 0C400 0 288 32 288 176V288c0 35.3 28.7 64 64 64h32V480c0 17.7 14.3 32 32 32s32-14.3 32-32V352 24 0H416zM64 16C64 7.8 57.9 1 50 0C34 0 25.1 8 20.1 19.3L-7.4 85.3C-15.2 106.4 0 128 22.6 128H41.4c22.6 0 37.8-21.6 30.1-42.7L43.9 19.3C38.9 8 30 0 14 0c-7.9 1-14 7.8-14 16V480c0 17.7 14.3 32 32 32s32-14.3 32-32V16zM224 16c-17.7 0-32 14.3-32 32V256c0 17.7 14.3 32 32 32s32-14.3 32-32V48c0-17.7-14.3-32-32-32z"/></svg>`,
    price: `<svg class="w-4 h-4 fill-[#00b4d8]" viewBox="0 0 576 512"><path d="M64 64C28.7 64 0 92.7 0 128V384c0 35.3 28.7 64 64 64H512c35.3 0 64-28.7 64-64V128c0-35.3-28.7-64-64-64H64zm64 320H64V320c35.3 0 64 28.7 64 64zM64 192V128h64c0 35.3-28.7 64-64 64zM448 384c0-35.3 28.7-64 64-64v64H448zm64-192c-35.3 0-64-28.7-64-64h64v64zM288 160a96 96 0 1 1 0 192 96 96 0 1 1 0-192z"/></svg>`,
    policy: `<svg class="w-4 h-4 fill-slate-400 mt-0.5 shrink-0" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c13.3 0 24 10.7 24 24V264c0 13.3-10.7 24-24 24s-24-10.7-24-24V152c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/></svg>`,
    success: `<svg class="w-3.5 h-3.5 fill-emerald-600" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z"/></svg>`,
    fail: `<svg class="w-3.5 h-3.5 fill-red-600" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c13.3 0 24 10.7 24 24V264c0 13.3-10.7 24-24 24s-24-10.7-24-24V152c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z"/></svg>`
};

let allHotels = [
    { 
        name: "🏨 الفندق التجريبي للاختبار (Test Hotel 10 AED)", city: "دبي", priceAED: 10, basePoints: 100, lat: 25.2048, lng: 55.2708, 
        img: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80", 
        funnyPolicy: "إلغاء مجاني 100% - استرداد كامل المبلغ على الكرت في أي وقت!", 
        hotelFacilities: ["<i class='fa-solid fa-wifi'></i> واي فاي مجاني", "<i class='fa-solid fa-credit-card'></i> دفع آمن عبر Ziina"]
    },
    { 
        name: "فندق ريا كريك (Reya Creek Hotel)", city: "دبي", priceAED: 890, basePoints: 8900, lat: 25.2654, lng: 55.3272, 
        img: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80", 
        funnyPolicy: "ممنوع إدخال بطاطس حارة للغرفة!", 
        hotelFacilities: ["<i class='fa-solid fa-wifi'></i> واي فاي مجاني", "<i class='fa-solid fa-person-swimming'></i> مسبح خارجي", "<i class='fa-solid fa-dumbbell'></i> صالة رياضية"]
    },
    { 
        name: "فندق أتلانتس النخلة، دبي", city: "دبي", priceAED: 2202, basePoints: 22020, lat: 25.1304, lng: 55.1172, 
        img: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=600&q=80", 
        funnyPolicy: "سمكة الشيمو ممنوعة من المسابح!", 
        hotelFacilities: ["<i class='fa-solid fa-water'></i> شاطئ خاص", "<i class='fa-solid fa-spa'></i> مركز سبا وعافية", "<i class='fa-solid fa-bell-concierge'></i> خدمة غرف"]
    }
];

const Hotels = {
    filterHotels: function() {
        try {
            const searchInput = document.getElementById('searchInput');
            const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const cityRadio = document.querySelector('input[name="cityFilter"]:checked');
            const sortRadio = document.querySelector('input[name="sortFilter"]:checked');
            
            const cityValue = cityRadio ? cityRadio.value : 'all';
            const sortValue = sortRadio ? sortRadio.value : 'recommended';

            let filtered = allHotels.filter(h => {
                const matchesQuery = h.name.toLowerCase().includes(query) || h.city.toLowerCase().includes(query);
                const matchesCity = (cityValue === 'all' || h.city === cityValue);
                return matchesQuery && matchesCity;
            });

            if (sortValue === 'price_low') { filtered.sort((a, b) => a.priceAED - b.priceAED); } 
            else if (sortValue === 'points_high') { filtered.sort((a, b) => b.basePoints - a.basePoints); }

            Hotels.displayHotels(filtered); 
            if (typeof updateGoogleMarkers === 'function') updateGoogleMarkers(filtered); 
            if (typeof UI !== 'undefined' && UI.changeCurrency) UI.changeCurrency();
        } catch(e) { console.error("Error in filterHotels:", e); }
    },

    renderChildAges: function() {
        try {
            const count = parseInt(document.getElementById('childrenInput').value) || 0;
            const container = document.getElementById('childAgesContainer');
            if (!container) return;
            container.innerHTML = '';
            if (count > 0) {
                container.style.display = 'block';
                let html = '<label class="text-[11px] md:text-[13px] font-black text-[#1f3a40] mb-2 md:mb-3 display-block">أعمار الأطفال عند تسجيل الوصول:</label><div class="flex gap-2 md:gap-3 flex-wrap">';
                for (let i = 0; i < count; i++) { 
                    html += `<div class="flex-1 min-w-[80px] md:min-w-[100px]"><label class="text-[9px] md:text-[11px] text-slate-500 font-bold mb-1 display-block">الطفل ${i+1}</label><select class="childAgeSelect w-full p-2 md:p-2.5 rounded-lg md:rounded-xl border border-slate-300 font-bold text-xs md:text-sm outline-none focus:border-[#00b4d8]">${Hotels.generateAgeOptions()}</select></div>`; 
                }
                html += '</div>'; container.innerHTML = html;
            } else { container.style.display = 'none'; }
        } catch(e) { console.error("Error in renderChildAges:", e); }
    },

    generateAgeOptions: function() {
        let opts = ''; for (let age = 0; age <= 17; age++) { opts += `<option value="${age}">${age} سنوات</option>`; } return opts;
    },

    searchLiveHotels: async function() {
        const btn = document.getElementById('searchBtnText');
        const originalText = btn ? btn.innerHTML : '';
        if(btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm md:text-base"></i> <span class="text-xs md:text-sm">جاري البحث...</span>'; 
            btn.disabled = true;
        }

        try {
            const query = document.getElementById('searchInput') ? document.getElementById('searchInput').value : '';
            const destinationSelect = document.getElementById('destinationSelect');
            const destinationCode = destinationSelect ? destinationSelect.value : 'DXB';
            const checkIn = document.getElementById('checkInDate') ? document.getElementById('checkInDate').value : '';
            const checkOut = document.getElementById('checkOutDate') ? document.getElementById('checkOutDate').value : '';
            const adults = document.getElementById('adultsInput') ? document.getElementById('adultsInput').value : 2;
            const children = document.getElementById('childrenInput') ? document.getElementById('childrenInput').value : 0;
            const boardBasisFilter = document.getElementById('boardBasisFilter');
            const boardBasis = boardBasisFilter ? boardBasisFilter.value : 'ALL';

            let childrenAges = []; 
            document.querySelectorAll('.childAgeSelect').forEach(sel => childrenAges.push(parseInt(sel.value)));

            const res = await fetch(`${API_URL}/api/v1/hotels/search`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ checkIn, checkOut, adults: parseInt(adults), children: parseInt(children), childrenAges, boardBasis, destinationCode })
            });
            const data = await res.json();

            if (data.success && data.hotelsData && data.hotelsData.hotels) {
                let liveHotels = data.hotelsData.hotels.map((h, index) => {
                    let minRate = h.minRate ? parseFloat(h.minRate) : Math.floor(Math.random() * 1500 + 400);
                    let imgs = [ "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80", "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=600&q=80" ];
                    let mockFacilities = ["<i class='fa-solid fa-wifi'></i> واي فاي", "<i class='fa-solid fa-person-swimming'></i> مسبح", "<i class='fa-solid fa-spa'></i> سبا"];
                    let calculatedPoints = Math.floor(minRate * 10);

                    return {
                        code: h.code || "12345", name: h.name || "فندق شريك لرمال وفلّها", city: h.destinationName || "دبي",
                        priceAED: minRate, basePoints: calculatedPoints, lat: h.latitude || 25.2048 + (Math.random() * 0.1),
                        lng: h.longitude || 55.2708 + (Math.random() * 0.1), img: imgs[index % imgs.length],
                        funnyPolicy: "أسعار خيالية لفترة محدودة!", hotelFacilities: mockFacilities, rooms: h.rooms || []
                    };
                });
                if(query) liveHotels = liveHotels.filter(h => h.name.toLowerCase().includes(query.toLowerCase()));
                allHotels = [allHotels[0], ...liveHotels]; 
                Hotels.displayHotels(allHotels); 
                if (typeof updateGoogleMarkers === 'function') updateGoogleMarkers(allHotels); 
                if(window.innerWidth <= 768 && typeof UI !== 'undefined') UI.closeMobileSearchSheet(); 
            } else { 
                if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('info', 'لا توجد نتائج', 'لم نتمكن من العثور على فنادق تطابق بحثك.'); 
            }
        } catch (e) { 
            console.error(e); 
            if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('error', 'خطأ اتصال', 'خطأ في الاتصال بسيرفر الفنادق.'); 
        } finally { 
            if(btn) {
                btn.innerHTML = originalText; 
                btn.disabled = false; 
            }
        }
    },

    getMealPlanUI: function(boardType) {
        let config = { bg: 'bg-slate-50', border: 'border-slate-100', text: 'text-slate-600', icon: 'fa-utensils', iconColor: 'text-slate-400' };
        let title = boardType || 'شامل الوجبات';
        const upperBoard = boardType ? boardType.toUpperCase() : '';

        if (upperBoard.includes('RO') || upperBoard.includes('ROOM ONLY')) {
            config = { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', icon: 'fa-bed', iconColor: 'text-slate-400' };
            title = 'بدون وجبات (Room Only)';
        } else if (upperBoard.includes('BB') || upperBoard.includes('BREAKFAST')) {
            config = { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'fa-mug-hot', iconColor: 'text-amber-500' };
            title = 'شامل الإفطار (Breakfast)';
        } else if (upperBoard.includes('HB') || upperBoard.includes('HALF')) {
            config = { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', icon: 'fa-plate-wheat', iconColor: 'text-orange-500' };
            title = 'نصف إقامة (فطور وعشاء)';
        } else if (upperBoard.includes('FB') || upperBoard.includes('FULL') || upperBoard.includes('AI') || upperBoard.includes('ALL')) {
            config = { bg: 'bg-[#00b4d8]/10', border: 'border-[#00b4d8]/30', text: 'text-[#007790]', icon: 'fa-martini-glass-citrus', iconColor: 'text-[#00b4d8]' };
            title = 'شامل كلياً (All Inclusive)';
        }

        return `<span class="inline-flex items-center gap-1 md:gap-1.5 ${config.bg} ${config.text} px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-black border ${config.border} shadow-sm whitespace-nowrap">
                    <i class="fa-solid ${config.icon} ${config.iconColor} text-xs md:text-sm drop-shadow-sm"></i> ${title}
                </span>`;
    },

    displayHotels: function(hotelsArray) {
        const container = document.getElementById('hotelsContainer');
        if (!container) return; 
        container.innerHTML = '';
        
        if(!hotelsArray || hotelsArray.length === 0) {
            container.innerHTML = '<p class="text-center font-bold text-slate-400 py-10">لا توجد فنادق متاحة حالياً.</p>';
            return;
        }

        const scarcityMsgs = [ 
            { text: "باقي غرفتين فقط!", color: "text-red-600", bg: "bg-red-50", border: "border-red-100", icon: "fa-fire" },
            { text: "مطلوب بشدة اليوم", color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-100", icon: "fa-arrow-trend-up" },
            { text: "سعر حصري للأعضاء", color: "text-[#00b4d8]", bg: "bg-[#00b4d8]/10", border: "border-[#00b4d8]/20", icon: "fa-gem" }
        ];

        hotelsArray.forEach((hotel, index) => {
            let randomScarcity = scarcityMsgs[Math.floor(Math.random() * scarcityMsgs.length)];
            let randomRating = (Math.random() * (9.9 - 8.0) + 8.0).toFixed(1); 
            
            let facilitiesHTML = '';
            if(hotel.hotelFacilities) {
                hotel.hotelFacilities.forEach(fac => {
                    let styledFac = fac.replace('<i ', '<i style="color: #00b4d8;" ');
                    facilitiesHTML += `<span class="inline-flex items-center gap-1 md:gap-1.5 bg-slate-50 text-slate-600 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[9px] md:text-[11px] font-bold border border-slate-100 shrink-0">${styledFac}</span>`;
                });
            }
            const animationDelay = index * 100;
            let cashbackAED = (hotel.basePoints / 10).toFixed(0);

            let coinBadgeHTML = '';
            if (typeof currentUser !== 'undefined' && currentUser) {
                coinBadgeHTML = `
                    <div class="absolute top-2 right-2 md:top-3 md:right-3 w-12 h-12 md:w-20 md:h-20 transform transition-transform duration-300 hover:rotate-3 hover:scale-105 z-20 cursor-default">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" class="w-full h-full">
                          <defs>
                            <linearGradient id="gold-outer-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stop-color="#D4AF37"/><stop offset="50%" stop-color="#FFF2A8"/><stop offset="100%" stop-color="#996515"/>
                            </linearGradient>
                            <linearGradient id="gold-inner-${index}" x1="0%" y1="100%" x2="100%" y2="0%">
                              <stop offset="0%" stop-color="#7B4918"/><stop offset="50%" stop-color="#B8860B"/><stop offset="100%" stop-color="#F9D976"/>
                            </linearGradient>
                            <filter id="text-shadow-${index}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/></filter>
                            <filter id="coin-shadow-${index}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.3"/></filter>
                          </defs>
                          <circle cx="100" cy="100" r="90" fill="url(#gold-outer-${index})" filter="url(#coin-shadow-${index})"/>
                          <circle cx="100" cy="100" r="84" fill="none" stroke="#5c3a0d" stroke-width="3" stroke-dasharray="4 4" opacity="0.6"/>
                          <circle cx="100" cy="100" r="75" fill="url(#gold-inner-${index})"/>
                          <circle cx="100" cy="100" r="75" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.3"/>
                          <path d="M 165 110 A 62 62 0 0 0 165 70" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
                          <polygon points="165,65 172,75 158,75" fill="#ffffff" opacity="0.7"/>
                          <text x="100" y="62" font-family="'Cairo', sans-serif" font-size="22" font-weight="800" fill="#ffffff" text-anchor="middle" filter="url(#text-shadow-${index})">كاش باك</text>
                          <text x="100" y="130" font-family="'Cairo', sans-serif" font-size="70" font-weight="900" fill="#ffffff" text-anchor="middle" filter="url(#text-shadow-${index})" letter-spacing="-2">${cashbackAED}</text>
                          <text x="100" y="160" font-family="'Cairo', sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle" filter="url(#text-shadow-${index})">درهم</text>
                        </svg>
                    </div>`;
            } else {
                coinBadgeHTML = `
                    <div onclick="if(typeof Auth !== 'undefined') Auth.openAuthModal();" class="absolute top-2 right-2 md:top-3 md:right-3 w-12 h-12 md:w-20 md:h-20 cursor-pointer transform transition-transform duration-300 hover:scale-105 hover:rotate-3 z-20 pulse-coin rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" class="w-full h-full">
                          <defs>
                            <linearGradient id="dark-outer-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stop-color="#334155"/><stop offset="50%" stop-color="#64748b"/><stop offset="100%" stop-color="#0f172a"/>
                            </linearGradient>
                            <linearGradient id="dark-inner-${index}" x1="0%" y1="100%" x2="100%" y2="0%">
                              <stop offset="0%" stop-color="#020617"/><stop offset="50%" stop-color="#1e293b"/><stop offset="100%" stop-color="#475569"/>
                            </linearGradient>
                            <filter id="coin-shadow-dark-${index}" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.4"/></filter>
                          </defs>
                          <circle cx="100" cy="100" r="90" fill="url(#dark-outer-${index})" filter="url(#coin-shadow-dark-${index})"/>
                          <circle cx="100" cy="100" r="84" fill="none" stroke="#1e293b" stroke-width="3" stroke-dasharray="4 4" opacity="0.6"/>
                          <circle cx="100" cy="100" r="75" fill="url(#dark-inner-${index})"/>
                          <circle cx="100" cy="100" r="75" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.1"/>
                          <path d="M 85 75 V 65 A 15 15 0 0 1 115 65 V 75 H 120 V 115 H 80 V 75 Z M 92 75 H 108 V 65 A 8 8 0 0 0 92 65 Z" fill="#facc15" filter="url(#text-shadow-${index})"/>
                          <text x="100" y="145" font-family="'Cairo', sans-serif" font-size="22" font-weight="900" fill="#cbd5e1" text-anchor="middle">سر الأعضاء</text>
                        </svg>
                    </div>`;
            }

            let baseMealType = 'RO'; 
            if(hotel.priceAED > 800) baseMealType = 'BB';
            if(hotel.priceAED > 2000) baseMealType = 'HB';
            let mealBadge = Hotels.getMealPlanUI(baseMealType);

            // 🚀 هذا هو التصميم الأصلي الخاص بك المطابق للصور 100% بالزر الأحمر الفاخر 🚀
            container.innerHTML += `
            <div class="relative flex flex-col lg:flex-row bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-100 hover:shadow-[0_15px_40px_rgba(0,180,216,0.12)] transition-all duration-500 mb-5 md:mb-6 group overflow-hidden animate-fade-in-up" style="animation-delay: ${animationDelay}ms;">
              
              <div class="relative w-full lg:w-[320px] shrink-0 h-48 sm:h-64 lg:h-auto overflow-hidden">
                <img src="${hotel.img}" alt="${hotel.name}" class="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" onerror="this.src='https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80'" />
                <div class="absolute inset-0 bg-gradient-to-t from-[#1f3a40]/80 via-transparent to-black/20 pointer-events-none z-0"></div>
                
                <div class="absolute top-2 left-2 md:top-4 md:left-4 flex items-center bg-white/95 backdrop-blur-md rounded-lg md:rounded-xl shadow-lg overflow-hidden z-10">
                    <div class="bg-gradient-to-br from-[#1f3a40] to-[#2a4d53] text-white px-2 py-1 md:px-3 md:py-1.5 flex items-center justify-center">
                        <span class="font-black text-[10px] md:text-sm tracking-widest" dir="ltr">${randomRating}</span>
                    </div>
                    <div class="px-2 py-1 md:px-2.5 md:py-1.5 flex items-center gap-1">
                        <span class="text-[#1f3a40] font-extrabold text-[9px] md:text-[11px]">ممتاز</span>
                    </div>
                </div>
                
                ${coinBadgeHTML}
                
                <div class="absolute bottom-2 right-2 md:bottom-4 md:right-4 z-10 flex items-center gap-1 md:gap-1.5 ${randomScarcity.bg} ${randomScarcity.color} px-2 py-1 md:px-3 md:py-1.5 rounded-md md:rounded-lg text-[9px] md:text-[10px] font-black border ${randomScarcity.border} shadow-sm backdrop-blur-sm">
                    <i class="fa-solid ${randomScarcity.icon} animate-pulse"></i> ${randomScarcity.text}
                </div>
              </div>

              <div class="flex-1 p-4 sm:p-6 md:p-8 flex flex-col justify-between relative z-10 min-w-0 bg-white">
                <div>
                  <div class="flex items-center gap-1 md:gap-2 mb-1.5 md:mb-2">
                    <div class="flex text-yellow-400 text-[8px] md:text-[10px]"><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i></div>
                  </div>
                  <h3 class="text-base sm:text-xl lg:text-2xl font-black text-[#1f3a40] group-hover:text-[#00b4d8] transition-colors cursor-pointer leading-tight mb-1.5 md:mb-2 truncate"><bdi dir="auto"><span style="unicode-bidi: plaintext;">${hotel.name}</span></bdi></h3>
                  <p class="text-[11px] md:text-[13px] text-slate-500 font-bold mb-3 md:mb-4 flex items-center gap-1 md:gap-1.5 truncate"><i class="fa-solid fa-location-dot text-[#00b4d8]"></i> الإمارات - ${hotel.city} <span class="text-[#00b4d8] underline decoration-dashed cursor-pointer ml-1 md:ml-2 text-[9px] md:text-[11px]">عرض على الخريطة</span></p>
                  
                  <div class="flex flex-wrap gap-1.5 md:gap-2 mt-2 md:mt-4 justify-start">
                      ${facilitiesHTML}
                  </div>
                </div>
                <div class="mt-4 md:mt-6 flex flex-wrap items-center gap-2 md:gap-3">
                   ${mealBadge}
                   <span class="inline-flex items-center gap-1 md:gap-1.5 bg-green-50 text-green-700 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[9px] md:text-[11px] font-black border border-green-100 shadow-sm whitespace-nowrap"><i class="fa-solid fa-check text-green-500 text-xs md:text-sm"></i> إلغاء مجاني متاح</span>
                </div>
              </div>

              <div class="hidden lg:block ticket-divider-v z-20"></div>
              <div class="lg:hidden ticket-divider-h z-20 my-2"></div>

              <div class="w-full lg:w-[260px] xl:w-[280px] p-4 sm:p-6 md:p-8 flex flex-col justify-center items-center bg-gradient-to-b from-[#f8fafc] to-white shrink-0 z-10 relative border-l border-slate-50">
                <span class="bg-[#00b4d8]/10 text-[#00b4d8] text-[9px] md:text-[10px] font-black px-2 md:px-3 py-1 rounded-full mb-2 md:mb-3 border border-[#00b4d8]/20 tracking-wide">أفضل سعر متاح</span>
                <span class="text-[9px] md:text-[11px] font-bold text-slate-400 mb-0.5 md:mb-1">ابتداءً من (لليلة)</span>
                <div class="text-center mb-1 flex items-baseline justify-center gap-1 md:gap-1.5" dir="ltr">
                  <span class="text-xs md:text-sm font-bold text-slate-400 currency-label">AED</span>
                  <span class="text-3xl sm:text-4xl lg:text-5xl font-black text-[#1f3a40] tracking-tighter hotel-price-display" data-price-aed="${hotel.priceAED}">${hotel.priceAED}</span>
                </div>
                <span class="text-[9px] md:text-[10px] text-slate-400 font-bold mb-4 md:mb-6 block">شامل الضرائب والرسوم</span>

                <button class="w-full bg-gradient-to-l from-[#800000] to-[#a30000] hover:from-[#990000] hover:to-[#cc0000] active:scale-[0.98] transition-all duration-300 text-white font-black py-3 md:py-4 rounded-xl shadow-[0_8px_20px_rgba(128,0,0,0.2)] border-none cursor-pointer text-sm md:text-base flex items-center justify-center gap-1.5 md:gap-2 mb-3 md:mb-4" onclick="viewHotelDetails('${hotel.name.replace(/'/g, "\\'")}', ${hotel.priceAED}, ${JSON.stringify(hotel.rooms || []).replace(/"/g, '&quot;')})">
                  عرض الخيارات <i class="fa-solid fa-chevron-left text-[10px] md:text-sm opacity-80"></i>
                </button>

                ${currentUser 
                    ? `<div class="mt-2 md:mt-4 flex items-center justify-center gap-1 md:gap-1.5 text-amber-600 text-[9px] md:text-[10px] font-black w-full cursor-default">
                           <i class="fa-solid fa-coins text-amber-500"></i>
                           <span>استرجع ${cashbackAED} درهم في حصالتك</span>
                       </div>` 
                    : `<div onclick="if(typeof Auth !== 'undefined') Auth.openAuthModal();" class="mt-2 md:mt-4 flex items-center justify-center gap-1 md:gap-1.5 text-[#ea580c] text-[9px] md:text-[10px] font-black w-full cursor-pointer hover:text-[#c2410c] transition-colors group">
                           <i class="fa-solid fa-lock text-[#ea580c] group-hover:text-[#c2410c]"></i>
                           <span class="underline decoration-dashed underline-offset-4">سجل لتربح</span>
                       </div>`
                }
              </div>
            </div>`;
        });
        if (typeof UI !== 'undefined' && UI.changeCurrency) UI.changeCurrency();
    },

    viewHotelDetails: async function(hotelName, basePrice, apiRooms) {
        const titleEl = document.getElementById('detailsHotelName');
        if(titleEl) titleEl.innerHTML = `<bdi dir="auto"><span style="unicode-bidi: plaintext;">${hotelName}</span></bdi>`;
        
        const container = document.getElementById('roomsContainer');
        if (!container) return; 
        container.innerHTML = '';
        
        await Hotels.fetchAndDisplayHotelReviews(hotelName);

        let roomsList = [];
        if (hotelName.includes('الفندق التجريبي') || !apiRooms || apiRooms.length === 0) {
            roomsList = [
                { name: "غرفة قياسية (Standard Room)", bed: "سرير مزدوج", board: "RO", price: basePrice, points: Math.floor(basePrice*10), policyText: "غير قابل للاسترداد (Non-refundable)", isFreeCancel: false, rateKey: "MOCK-RATE-STD", paymentType: "AT", refundType: "non_refundable" },
                { name: "غرفة ديلوكس (Deluxe Room)", bed: "سرير كينج كبير", board: "BB", price: Math.floor(basePrice * 1.2), points: Math.floor(basePrice*12), policyText: "إلغاء مجاني حتى قبل الموعد بـ 48 ساعة", isFreeCancel: true, rateKey: "MOCK-RATE-DLX", paymentType: "HOTEL", refundType: "full_100" },
                { name: "جناح تنفيذي (Executive Suite)", bed: "سرير كينج + أريكة", board: "HB", price: Math.floor(basePrice * 1.8), points: Math.floor(basePrice*18), policyText: "إلغاء مجاني بالكامل - ادفع لاحقاً", isFreeCancel: true, rateKey: "MOCK-RATE-STE", paymentType: "HOTEL", refundType: "full_100" }
            ];
        } else {
            apiRooms.forEach(room => {
                if (room.rates && room.rates.length > 0) {
                    room.rates.forEach(rate => {
                        let rType = 'full_100';
                        if(rate.freeCancellation) rType = 'full_100'; else if(rate.cancellationPolicies && rate.cancellationPolicies.length > 0) rType = 'api_policy'; else rType = 'non_refundable';
                        
                        let currentPrice = rate.net ? parseFloat(rate.net) : basePrice;
                        roomsList.push({
                            name: room.name || "غرفة فندقية فاخرة", bed: "سرير مزدوج / كينج", board: rate.boardName || rate.board || "شامل الوجبات",
                            price: currentPrice, points: Math.floor(currentPrice * 10),
                            policyText: rate.formattedPolicy || "شروط الإلغاء مطبقة حسب سياسة المورد العالمي", isFreeCancel: rate.freeCancellation || false,
                            rateKey: rate.rateKey, paymentType: rate.paymentType || 'AT', refundType: rType
                        });
                    });
                }
            });
        }

        roomsList.forEach((room, index) => {
            let cancelClass = room.isFreeCancel ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800' : 'border-red-200 bg-red-50/50 text-red-800';
            let cancelIcon = room.isFreeCancel ? 'fa-shield-check text-emerald-500' : 'fa-shield-halved text-red-500';
            let policyTitleColor = room.isFreeCancel ? 'text-emerald-700' : 'text-red-700';
            const animationDelay = index * 100;
            let cashbackAED = (room.points / 10).toFixed(0);
            
            let mealBadge = Hotels.getMealPlanUI(room.board);

            let coinBadgeHTML = '';
            if (typeof currentUser !== 'undefined' && currentUser) {
                coinBadgeHTML = `
                    <div class="w-8 h-8 md:w-10 md:h-10 transform transition-transform duration-300 cursor-default shadow-md rounded-full shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" class="w-full h-full">
                          <defs>
                            <linearGradient id="gold-r-${index}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#D4AF37"/><stop offset="50%" stop-color="#FFF2A8"/><stop offset="100%" stop-color="#996515"/></linearGradient>
                          </defs>
                          <circle cx="100" cy="100" r="95" fill="url(#gold-r-${index})"/>
                          <circle cx="100" cy="100" r="80" fill="none" stroke="#5c3a0d" stroke-width="4" stroke-dasharray="6 6" opacity="0.6"/>
                          <text x="100" y="85" font-family="'Cairo', sans-serif" font-size="35" font-weight="900" fill="#7B4918" text-anchor="middle">AED</text>
                          <text x="100" y="150" font-family="'Cairo', sans-serif" font-size="70" font-weight="900" fill="#7B4918" text-anchor="middle" letter-spacing="-2">${cashbackAED}</text>
                        </svg>
                    </div>`;
            }

            container.innerHTML += `
                <div class="relative flex flex-col lg:flex-row bg-white rounded-2xl md:rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-100 hover:border-[#00b4d8]/40 transition-all duration-300 mb-5 md:mb-6 overflow-hidden group animate-fade-in-up" style="animation-delay: ${animationDelay}ms;">

                    <div class="absolute -left-12 md:-left-16 -bottom-12 md:-bottom-16 w-64 md:w-80 h-64 md:h-80 opacity-[0.02] pointer-events-none transform -rotate-12 group-hover:scale-110 transition-transform duration-700 z-0">
                        <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
                            <path d="M15,45 Q55,25 95,50 Q85,15 25,25 Z" fill="#1f3a40"/>
                            <path d="M105,75 Q65,95 25,70 Q35,105 95,95 Z" fill="#1f3a40"/>
                        </svg>
                    </div>

                    <div class="flex-1 p-4 sm:p-6 md:p-8 flex flex-col justify-between relative z-10 min-w-0 bg-transparent">
                        <h3 class="text-lg sm:text-xl md:text-2xl font-black text-[#1f3a40] leading-tight flex items-center gap-2 md:gap-3 truncate">
                            <bdi dir="auto"><span style="unicode-bidi: plaintext;">${room.name}</span></bdi>
                        </h3>
                        
                        <div class="flex flex-wrap items-center gap-2 md:gap-3 mt-3 md:mt-4">
                            <span class="inline-flex items-center gap-1 md:gap-2 bg-slate-50 text-slate-700 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-xs font-bold border border-slate-200">
                                <i class="fa-solid fa-bed text-slate-400"></i> ${room.bed}
                            </span>
                            <span class="inline-flex items-center gap-1 md:gap-2 bg-slate-50 text-slate-700 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-xs font-bold border border-slate-200">
                                <i class="fa-solid fa-user-group text-slate-400"></i> يتسع لـ 2 بالغين
                            </span>
                        </div>

                        <div class="mt-3 md:mt-5 flex items-center gap-2">
                            ${mealBadge}
                        </div>
                        
                        <div class="mt-4 md:mt-5 border ${cancelClass} p-2.5 md:p-3 px-3 md:px-4 text-[10px] md:text-xs rounded-lg md:rounded-xl font-bold flex items-start gap-2 md:gap-2.5 relative overflow-hidden bg-opacity-40">
                            <i class="fa-solid ${cancelIcon} mt-0.5 md:mt-1 relative z-10 text-sm md:text-base shrink-0"></i>
                            <div class="relative z-10 min-w-0">
                                <span class="block ${policyTitleColor} font-black text-[11px] md:text-sm mb-0.5 md:mb-1">السياسة:</span>
                                <span class="font-semibold block whitespace-pre-line text-slate-600 leading-relaxed"><bdi dir="auto"><span style="unicode-bidi: plaintext;">${room.policyText}</span></bdi></span>
                            </div>
                        </div>
                    </div>

                    <div class="hidden lg:block ticket-divider-v z-20"></div>
                    <div class="lg:hidden ticket-divider-h z-20 my-2"></div>

                    <div class="w-full lg:w-[260px] xl:w-[280px] p-4 sm:p-6 md:p-8 flex flex-col justify-center items-center bg-slate-50 shrink-0 z-10 relative border-l border-slate-50">
                        <div class="text-center mb-1 flex items-baseline justify-center gap-1 md:gap-1.5" dir="ltr">
                            <span class="text-xs md:text-sm font-bold text-slate-400 currency-label">AED</span>
                            <span class="text-3xl sm:text-4xl lg:text-5xl font-black text-[#1f3a40] tracking-tighter hotel-price-display" data-price-aed="${room.price}">${room.price}</span>
                        </div>
                        <span class="text-[9px] md:text-[10px] text-slate-400 font-bold mb-4 md:mb-5 block text-center">شامل الضرائب والرسوم للغرفة</span>

                        <button class="w-full bg-gradient-to-l from-[#800000] to-[#a30000] hover:from-[#990000] hover:to-[#cc0000] active:scale-[0.98] transition-all duration-300 text-white font-black py-3 md:py-4 rounded-xl shadow-[0_8px_20px_rgba(128,0,0,0.2)] border-none cursor-pointer text-sm md:text-base flex items-center justify-center gap-1.5 md:gap-2 mb-3 md:mb-4" 
                            onclick="if(typeof Checkout !== 'undefined') Checkout.goToBooking('${hotelName.replace(/'/g, "\\'")}', ${room.price}, '${room.name.replace(/'/g, "\\'")}', '${room.board}', '${room.policyText.replace(/'/g, "\\'")}', '${room.rateKey}', '${room.paymentType}', '${room.refundType}')">
                            <i class="fa-solid fa-lock text-white/50 text-[10px] md:text-sm"></i> حجز هذه الغرفة
                        </button>

                        <div class="w-full bg-white border border-amber-100 rounded-lg md:rounded-xl p-2 flex items-center justify-start gap-2 md:gap-3 shadow-sm cursor-default">
                            ${currentUser ? coinBadgeHTML : `<div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-amber-50 flex items-center justify-center border border-amber-200 cursor-pointer hover:bg-amber-100 shrink-0" onclick="if(typeof Auth !== 'undefined') Auth.openAuthModal()"><i class="fa-solid fa-piggy-bank text-amber-500 text-xs md:text-base"></i></div>`}
                            <div class="text-right flex-1">
                                <span class="block text-[8px] md:text-[9px] text-amber-600 font-black uppercase tracking-wider">كاش باك مسترد</span>
                                <span class="block text-[10px] md:text-xs font-black text-[#1f3a40]">${currentUser ? `+ ${cashbackAED} نقطة` : '<span class="text-slate-400 underline decoration-dashed cursor-pointer text-[9px] md:text-[10px]" onclick="if(typeof Auth !== 'undefined') Auth.openAuthModal()">سجل لتربح</span>'}</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        });
        if (typeof UI !== 'undefined' && UI.changeCurrency) UI.changeCurrency();
        if (typeof UI !== 'undefined' && UI.switchView) UI.switchView('roomSelectionView');
    },

    fetchAndDisplayHotelReviews: async function(hotelName) {
        const container = document.getElementById('hotelReviewsContainer');
        if (!container) return; 
        container.innerHTML = '<p class="text-center text-xs md:text-sm text-slate-400 font-bold py-4">جاري جلب التقييمات...</p>';
        try {
            const res = await fetch(`${API_URL}/api/v1/reviews/hotel/${encodeURIComponent(hotelName)}`);
            const data = await res.json();
            if (data.success) {
                let html = `<div class="text-center mb-5 md:mb-6"><div class="inline-flex items-center justify-center gap-2 md:gap-3 bg-slate-50 border border-slate-100 px-4 md:px-6 py-2 md:py-3 rounded-xl md:rounded-2xl flex-wrap"><span class="text-slate-600 font-bold text-xs md:text-sm">متوسط التقييم العام:</span><span class="text-[#1f3a40] font-black text-xl md:text-2xl tracking-tight" dir="ltr">${data.averageRating} <span class="text-[10px] md:text-sm text-slate-400">/ 5</span></span><div class="flex text-yellow-400 text-[10px] md:text-sm">`;
                for(let i=0; i<Math.round(data.averageRating); i++) html += '<i class="fa-solid fa-star"></i>';
                html += `</div><span class="text-[10px] md:text-xs font-bold text-slate-400">(${data.totalReviews} تقييم معتمد)</span></div></div>`;
                
                let allCombinedReviews = [...data.reviews.local, ...data.reviews.globalSupplier];
                if (allCombinedReviews.length === 0) { html += `<p class="text-center text-[10px] md:text-sm font-bold text-slate-400 py-4 md:py-6">لا توجد تقييمات محلية بعد، كن أول من يقيّم هذا الفندق!</p>`; } 
                else {
                    html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">`;
                    allCombinedReviews.forEach(rev => {
                        let stars = ''; for(let i=0; i<Math.round(rev.rating); i++) stars += '<i class="fa-solid fa-star text-yellow-400 text-[8px] md:text-xs"></i>';
                        html += `<div class="bg-slate-50/50 p-4 md:p-5 rounded-xl md:rounded-2xl border border-slate-100 hover:border-[#00b4d8]/20 transition-colors"><div class="flex items-center justify-between mb-2 md:mb-3"><div class="flex items-center gap-2 md:gap-3"><div class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-[#1f3a40] text-white flex items-center justify-center font-bold text-[10px] md:text-xs">${rev.customerName.charAt(0)}</div><strong class="text-xs md:text-sm text-[#1f3a40] truncate max-w-[120px]">${rev.customerName}</strong></div><div class="flex gap-0.5">${stars}</div></div><p class="text-slate-600 font-semibold text-[11px] md:text-sm leading-relaxed">"${rev.comment}"</p></div>`;
                    });
                    html += `</div>`;
                }
                container.innerHTML = html;
            } else { container.innerHTML = '<p class="text-center text-[10px] md:text-sm font-bold text-slate-400 py-4 md:py-6">تعذر تحميل التقييمات حالياً.</p>'; }
        } catch (e) { container.innerHTML = '<p class="text-center text-[10px] md:text-sm font-bold text-red-400 py-4 md:py-6">خطأ في الاتصال بسيرفر التقييمات.</p>'; }
    },
    
    submitHotelReview: async function(e) {
        e.preventDefault();
        const email = document.getElementById('reviewEmail') ? document.getElementById('reviewEmail').value.trim() : '';
        const customerName = document.getElementById('reviewName') ? document.getElementById('reviewName').value.trim() : '';
        const hotelName = document.getElementById('detailsHotelName') ? document.getElementById('detailsHotelName').innerText : '';
        const rating = document.getElementById('reviewRating') ? document.getElementById('reviewRating').value : '5';
        const comment = document.getElementById('reviewComment') ? document.getElementById('reviewComment').value.trim() : '';
        try {
            const res = await fetch(`${API_URL}/api/v1/reviews/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, customerName, hotelName, rating, comment }) });
            const data = await res.json();
            if (data.success) { 
                if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('success', 'تم الإرسال', data.message); 
                if (typeof UI !== 'undefined' && UI.closeReviewModal) UI.closeReviewModal(); 
                Hotels.fetchAndDisplayHotelReviews(hotelName); 
            } else { 
                if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('error', 'فشل الإرسال', data.error); 
            }
        } catch (err) { 
            if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); 
        }
    }
};

// ضمان عمل الدوال عالمياً حتى يتمكن الـ HTML من قراءتها
window.Hotels = Hotels;
window.filterHotels = Hotels.filterHotels;
window.searchLiveHotels = Hotels.searchLiveHotels;
window.renderChildAges = Hotels.renderChildAges;
window.viewHotelDetails = Hotels.viewHotelDetails;
