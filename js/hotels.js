// js/hotels.js

// مصفوفة احتياطية لضمان عدم توقف الفنادق تحت أي ظرف
if (typeof allHotels === 'undefined' || !allHotels || allHotels.length === 0) {
    window.allHotels = [
        { 
            name: "🏨 الفندق التجريبي للاختبار (Test Hotel)", city: "دبي", priceAED: 10, basePoints: 100, lat: 25.2048, lng: 55.2708, 
            img: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80", 
            funnyPolicy: "إلغاء مجاني 100%", 
            hotelFacilities: ["<i class='fa-solid fa-wifi'></i> واي فاي مجاني", "<i class='fa-solid fa-credit-card'></i> دفع آمن"]
        },
        { 
            name: "فندق ريا كريك (Reya Creek Hotel)", city: "دبي", priceAED: 890, basePoints: 8900, lat: 25.2654, lng: 55.3272, 
            img: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=600&q=80", 
            funnyPolicy: "إفطار فاخر مشمول", 
            hotelFacilities: ["<i class='fa-solid fa-wifi'></i> واي فاي", "<i class='fa-solid fa-person-swimming'></i> مسبح", "<i class='fa-solid fa-dumbbell'></i> جيم"]
        },
        { 
            name: "فندق أتلانتس النخلة، دبي", city: "دبي", priceAED: 2202, basePoints: 22020, lat: 25.1304, lng: 55.1172, 
            img: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=600&q=80", 
            funnyPolicy: "دخول مجاني للحديقة المائية", 
            hotelFacilities: ["<i class='fa-solid fa-water'></i> شاطئ", "<i class='fa-solid fa-spa'></i> سبا", "<i class='fa-solid fa-bell-concierge'></i> خدمة غرف"]
        }
    ];
}

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
        }

        return `<span class="inline-flex items-center gap-1.5 ${config.bg} ${config.text} px-3 py-1.5 rounded-lg text-[11px] font-black border ${config.border} shadow-sm whitespace-nowrap">
                    <i class="fa-solid ${config.icon} ${config.iconColor}"></i> ${title}
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
            { text: "باقي غرفتين فقط!", color: "text-rose-600", bg: "bg-rose-50/90", border: "border-rose-100", icon: "fa-fire" },
            { text: "مطلوب بشدة اليوم", color: "text-amber-600", bg: "bg-amber-50/90", border: "border-amber-100", icon: "fa-arrow-trend-up" },
            { text: "خيار المسافرين المفضل", color: "text-[#00b4d8]", bg: "bg-[#00b4d8]/10", border: "border-[#00b4d8]/20", icon: "fa-gem" }
        ];

        hotelsArray.forEach((hotel, index) => {
            let randomScarcity = scarcityMsgs[Math.floor(Math.random() * scarcityMsgs.length)];
            let randomRating = (Math.random() * (9.9 - 8.0) + 8.0).toFixed(1); 
            
            let facilitiesHTML = '';
            if(hotel.hotelFacilities) {
                hotel.hotelFacilities.forEach(fac => {
                    let styledFac = fac.replace('<i ', '<i style="color: #00b4d8;" ');
                    facilitiesHTML += `<span class="inline-flex items-center gap-1.5 bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-100 shrink-0">${styledFac}</span>`;
                });
            }
            const animationDelay = index * 100;
            let cashbackAED = (hotel.basePoints / 10).toFixed(0);

            let baseMealType = 'RO'; 
            if(hotel.priceAED > 800) baseMealType = 'BB';
            if(hotel.priceAED > 2000) baseMealType = 'HB';
            let mealBadge = Hotels.getMealPlanUI(baseMealType);

            // 🚀 The Ultimate World Class Card UI 🚀
            container.innerHTML += `
            <div class="relative flex flex-col lg:flex-row bg-white rounded-3xl shadow-[0_4px_25px_rgba(0,0,0,0.04)] border border-slate-100 hover:shadow-[0_20px_40px_rgba(0,180,216,0.08)] transition-all duration-400 mb-8 group overflow-hidden animate-fade-in-up" style="animation-delay: ${animationDelay}ms;">
              
              <!-- 1. Image Section (Right) -->
              <div class="relative w-full lg:w-[360px] shrink-0 h-64 lg:h-auto overflow-hidden p-2.5">
                <div class="w-full h-full rounded-[1.2rem] overflow-hidden relative">
                    <img src="${hotel.img}" alt="${hotel.name}" class="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" onerror="this.src='https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80'" />
                    <div class="absolute inset-0 bg-gradient-to-t from-[#1f3a40]/90 via-transparent to-black/20 pointer-events-none z-0"></div>
                    
                    <!-- Glassmorphism Rating Badge -->
                    <div class="absolute top-3 left-3 flex items-center bg-white/20 backdrop-blur-md border border-white/30 rounded-xl shadow-lg overflow-hidden z-10 text-white">
                        <div class="bg-[#00b4d8] px-2.5 py-1.5 flex items-center justify-center">
                            <span class="font-black text-sm tracking-wider" dir="ltr">${randomRating}</span>
                        </div>
                        <div class="px-2.5 py-1.5 flex items-center">
                            <span class="font-bold text-[11px]">رائع</span>
                        </div>
                    </div>
                    
                    <!-- Scarcity Glass Tag -->
                    <div class="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 ${randomScarcity.bg} ${randomScarcity.color} px-3 py-1.5 rounded-lg text-[10px] font-black shadow-lg backdrop-blur-md border ${randomScarcity.border}">
                        <i class="fa-solid ${randomScarcity.icon} animate-pulse"></i> ${randomScarcity.text}
                    </div>
                </div>
              </div>

              <!-- 2. Hotel Details Section (Middle) -->
              <div class="flex-1 p-5 lg:p-6 flex flex-col justify-center relative z-10 bg-white">
                  <div class="flex items-center gap-1 mb-2">
                    <div class="flex text-yellow-400 text-[10px] drop-shadow-sm"><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i></div>
                  </div>
                  
                  <h3 class="text-xl lg:text-2xl font-black text-[#1f3a40] group-hover:text-[#00b4d8] transition-colors cursor-pointer leading-tight mb-2 line-clamp-2"><bdi dir="auto">${hotel.name}</bdi></h3>
                  
                  <p class="text-[12px] text-slate-500 font-semibold mb-4 flex items-center gap-1.5 truncate">
                      <i class="fa-solid fa-location-dot text-[#00b4d8]"></i> الإمارات - ${hotel.city} 
                      <span class="text-[#00b4d8] underline decoration-dashed cursor-pointer ml-2 text-[10px] hover:text-[#007790] transition-colors">عرض على الخريطة</span>
                  </p>
                  
                  <div class="flex flex-wrap gap-2 mt-1 justify-start">
                      ${facilitiesHTML}
                  </div>
                  
                  <div class="mt-5 flex flex-wrap items-center gap-2">
                     ${mealBadge}
                     <span class="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg text-[11px] font-black border border-emerald-100 shadow-sm"><i class="fa-solid fa-shield-check text-emerald-500"></i> إلغاء مجاني متاح</span>
                  </div>
              </div>

              <!-- Masterstroke: Ticket Divider -->
              <div class="hidden lg:flex items-center relative z-20">
                  <div class="w-px h-3/4 border-l-2 border-dashed border-slate-200 relative">
                      <div class="absolute -top-12 -left-3 w-6 h-6 bg-[var(--bg-light)] rounded-full border-b border-slate-200"></div>
                      <div class="absolute -bottom-12 -left-3 w-6 h-6 bg-[var(--bg-light)] rounded-full border-t border-slate-200"></div>
                  </div>
              </div>
              <div class="lg:hidden h-px border-t-2 border-dashed border-slate-200 mx-6 relative z-20">
                  <div class="absolute -left-8 -top-3 w-6 h-6 bg-[var(--bg-light)] rounded-full border-r border-slate-200"></div>
                  <div class="absolute -right-8 -top-3 w-6 h-6 bg-[var(--bg-light)] rounded-full border-l border-slate-200"></div>
              </div>

              <!-- 3. Price & CTA Section (Left) -->
              <div class="w-full lg:w-[280px] p-6 flex flex-col justify-center items-center bg-slate-50 shrink-0 z-10 relative overflow-hidden rounded-bl-3xl rounded-br-3xl lg:rounded-bl-3xl lg:rounded-br-none lg:rounded-tl-3xl">
                
                <!-- Subtle Background Pattern (Masterstroke) -->
                <div class="absolute inset-0 opacity-[0.03] pointer-events-none" style="background-image: url('data:image/svg+xml,%3Csvg width=\\'40\\' height=\\'40\\' viewBox=\\'0 0 40 40\\' xmlns=\\'http://www.w3.org/2000/svg\\'%3E%3Cpath d=\\'M20 20.5V18H0v-2h20v-2H0v-2h20v-2H0V8h20V6H0V4h20V2H0V0h22v20h2V0h2v20h2V0h2v20h2V0h2v20h2V0h2v20h2v2H20v-1.5zM0 20h2v20H0V20zm4 0h2v20H4V20zm4 0h2v20H8V20zm4 0h2v20h-2V20zm4 0h2v20h-2V20zm4 4v16h2V24h-2zm4 0v16h2V24h-2zm4 0v16h2V24h-2zm4 0v16h2V24h-2zm4 0v16h2V24h-2z\\' fill=\\'%231f3a40\\' fill-rule=\\'evenodd\\'/%3E%3C/svg%3E');"></div>

                <div class="text-center w-full relative z-10">
                    <span class="text-[11px] font-bold text-slate-500 mb-1 block">السعر الإجمالي (لليلة)</span>
                    <div class="flex items-baseline justify-center gap-1.5" dir="ltr">
                        <span class="text-sm font-bold text-slate-400 currency-label">AED</span>
                        <span class="text-4xl font-black text-[#1f3a40] tracking-tighter hotel-price-display" data-price-aed="${hotel.priceAED}">${hotel.priceAED}</span>
                    </div>
                    <span class="text-[10px] text-slate-400 font-bold mb-4 block">شامل الضرائب والرسوم</span>

                    <!-- Premium Cyan CTA Button -->
                    <button class="w-full bg-gradient-to-r from-[#00b4d8] to-[#007790] hover:from-[#0096b4] hover:to-[#005f73] active:scale-[0.98] transition-all duration-300 text-white font-black py-3.5 rounded-xl shadow-[0_8px_20px_rgba(0,180,216,0.3)] hover:shadow-[0_12px_25px_rgba(0,180,216,0.4)] border-none cursor-pointer text-sm flex items-center justify-center gap-2 mb-4" 
                        onclick="if(typeof UI !== 'undefined' && UI.viewHotelDetails) UI.viewHotelDetails('${hotel.name.replace(/'/g, "\\'")}', ${hotel.priceAED}, ${JSON.stringify(hotel.rooms || []).replace(/"/g, '&quot;')})">
                        تحديد الغرف <i class="fa-solid fa-arrow-left-long text-xs opacity-80 pointer-events-none"></i>
                    </button>

                    <!-- Integrated Cashback Box (Clean, No Bleeding) -->
                    <div class="w-full bg-white border border-amber-100 rounded-xl p-2.5 flex items-center justify-start gap-3 shadow-sm transition-colors hover:bg-amber-50/50 cursor-pointer" onclick="if(typeof Auth !== 'undefined' && !currentUser) Auth.openAuthModal();">
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 flex items-center justify-center shadow-md shrink-0">
                            <i class="fa-solid fa-coins text-white text-lg drop-shadow-sm"></i>
                        </div>
                        <div class="text-right flex-1">
                            <span class="block text-[9px] text-amber-600 font-black uppercase tracking-wider mb-0.5">مكافأة حجز</span>
                            <span class="block text-xs font-black text-[#1f3a40]">
                                ${typeof currentUser !== 'undefined' && currentUser ? `<span dir="ltr">+ ${cashbackAED}</span> نقطة كاش باك` : '<span class="text-[#00b4d8] underline decoration-dashed text-[10px]">سجل الدخول لتربح</span>'}
                            </span>
                        </div>
                    </div>

                </div>
              </div>
            </div>`;
        });
        if (typeof UI !== 'undefined' && UI.changeCurrency) UI.changeCurrency();
    },

    // ... (باقي الدوال مثل fetchAndDisplayHotelReviews تبقى كما هي تماماً دون تغيير)
    fetchAndDisplayHotelReviews: async function(hotelName) {
        // [الكود السابق لهذه الدالة يبقى كما هو]
        const container = document.getElementById('hotelReviewsContainer');
        if (!container) return; container.innerHTML = '<p class="text-center text-xs md:text-sm text-slate-400 font-bold py-4">جاري جلب التقييمات...</p>';
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
    }
};

window.Hotels = Hotels;
