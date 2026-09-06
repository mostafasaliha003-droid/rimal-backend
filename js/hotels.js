// js/hotels.js

// مصفوفة احتياطية لضمان عدم توقف الفنادق تحت أي ظرف
if (typeof allHotels === 'undefined' || !allHotels || allHotels.length === 0) {
    window.allHotels = [
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
                if (typeof UI !== 'undefined') UI.showToast('info', 'لا توجد نتائج', 'لم نتمكن من العثور على فنادق تطابق بحثك.'); 
            }
        } catch (e) { 
            console.error(e); 
            if (typeof UI !== 'undefined') UI.showToast('error', 'خطأ اتصال', 'خطأ في الاتصال بسيرفر الفنادق.'); 
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
                          </defs>
                          <circle cx="100" cy="100" r="90" fill="url(#gold-outer-${index})"/>
                          <circle cx="100" cy="100" r="84" fill="none" stroke="#5c3a0d" stroke-width="3" stroke-dasharray="4 4" opacity="0.6"/>
                          <circle cx="100" cy="100" r="75" fill="url(#gold-inner-${index})"/>
                          <circle cx="100" cy="100" r="75" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.3"/>
                          <text x="100" y="62" font-family="'Cairo', sans-serif" font-size="22" font-weight="800" fill="#ffffff" text-anchor="middle">كاش باك</text>
                          <text x="100" y="130" font-family="'Cairo', sans-serif" font-size="70" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="-2">${cashbackAED}</text>
                          <text x="100" y="160" font-family="'Cairo', sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">درهم</text>
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
                          </defs>
                          <circle cx="100" cy="100" r="90" fill="url(#dark-outer-${index})"/>
                          <circle cx="100" cy="100" r="84" fill="none" stroke="#1e293b" stroke-width="3" stroke-dasharray="4 4" opacity="0.6"/>
                          <circle cx="100" cy="100" r="75" fill="url(#dark-inner-${index})"/>
                          <circle cx="100" cy="100" r="75" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.1"/>
                          <text x="100" y="145" font-family="'Cairo', sans-serif" font-size="22" font-weight="900" fill="#cbd5e1" text-anchor="middle">سر الأعضاء</text>
                        </svg>
                    </div>`;
            }

            let baseMealType = 'RO'; 
            if(hotel.priceAED > 800) baseMealType = 'BB';
            if(hotel.priceAED > 2000) baseMealType = 'HB';
            // 🚀 التصحيح الأهم: استدعاء دالة الوجبات من كائن Hotels مباشرة
            let mealBadge = Hotels.getMealPlanUI(baseMealType);

            container.innerHTML += `
            <div class="compact-card relative flex flex-col lg:flex-row bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-slate-100 hover:shadow-[0_15px_40px_rgba(0,180,216,0.12)] transition-all duration-500 mb-5 md:mb-6 group overflow-hidden animate-fade-in-up" style="animation-delay: ${animationDelay}ms;">
              
              <div class="img-container relative w-full lg:w-[320px] shrink-0 h-48 sm:h-64 lg:h-auto overflow-hidden rounded-t-[1.5rem] lg:rounded-none lg:rounded-r-[2rem]">
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

              <div class="compact-card-body flex-1 p-4 sm:p-6 md:p-8 flex flex-col justify-between relative z-10 min-w-0 bg-white">
                <div>
                  <div class="flex items-center gap-1 md:gap-2 mb-1.5 md:mb-2">
                    <div class="flex text-yellow-400 text-[8px] md:text-[10px]"><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i></div>
                  </div>
                  <h3 class="text-base sm:text-xl lg:text-2xl font-black text-[#1f3a40] group-hover:text-[#00b4d8] transition-colors cursor-pointer leading-tight mb-1.5 md:mb-2 truncate"><bdi dir="auto"><span style="unicode-bidi: plaintext;">${hotel.name}</span></bdi></h3>
                  <p class="text-[11px] md:text-[13px] text-slate-500 font-bold mb-3 md:mb-4 flex items-center gap-1 md:gap-1.5 truncate"><i class="fa-solid fa-location-dot text-[#00b4d8]"></i> الإمارات - ${hotel.city}</p>
                  
                  <div class="compact-facilities-scroll flex gap-1.5 md:gap-2 mt-2 md:mt-4 justify-start">
                      ${facilitiesHTML}
                  </div>
                </div>
                
                <div class="hidden lg:block ticket-divider-v z-20"></div>

                <div class="compact-price-row w-full lg:w-[260px] xl:w-[280px] p-0 lg:p-4 sm:p-6 md:p-8 flex flex-row lg:flex-col justify-between lg:justify-center items-end lg:items-center bg-transparent lg:bg-gradient-to-b from-[#f8fafc] to-white shrink-0 z-10 relative lg:border-l border-slate-50 lg:p-6">
                    <div class="price-box text-right lg:text-center mb-0 lg:mb-4 w-1/2 lg:w-auto">
                        <span class="hidden lg:inline-block bg-[#00b4d8]/10 text-[#00b4d8] text-[9px] md:text-[10px] font-black px-2 md:px-3 py-1 rounded-full mb-2 border border-[#00b4d8]/20 tracking-wide">أفضل سعر متاح</span>
                        <span class="text-[8px] md:text-[11px] font-bold text-slate-400 mb-0.5 block">ابتداءً من (لليلة)</span>
                        <div class="flex items-baseline justify-start lg:justify-center gap-1 md:gap-1.5" dir="ltr">
                            <span class="text-[10px] md:text-sm font-bold text-slate-400 currency-label">AED</span>
                            <span class="text-xl sm:text-4xl lg:text-5xl font-black text-[#1f3a40] tracking-tighter hotel-price-display" data-price-aed="${hotel.priceAED}">${hotel.priceAED}</span>
                        </div>
                        <span class="text-[7px] md:text-[10px] text-slate-400 font-bold block mt-0.5">شامل الضرائب والرسوم</span>
                    </div>

                    <button class="w-auto lg:w-full bg-gradient-to-l from-[#800000] to-[#a30000] hover:from-[#990000] hover:to-[#cc0000] active:scale-[0.98] transition-all duration-300 text-white font-black py-2.5 px-4 md:py-4 rounded-xl shadow-md border-none cursor-pointer text-xs md:text-base flex items-center justify-center gap-1.5 md:gap-2 m-0" onclick="if(typeof Checkout !== 'undefined') Checkout.viewHotelDetails('${hotel.name.replace(/'/g, "\\'")}', ${hotel.priceAED}, ${JSON.stringify(hotel.rooms || []).replace(/"/g, '&quot;')})">
                        عرض الخيارات <i class="fa-solid fa-chevron-left text-[8px] md:text-sm opacity-80"></i>
                    </button>
                </div>

              </div>
            </div>`;
        });
        if (typeof UI !== 'undefined' && UI.changeCurrency) UI.changeCurrency();
    },

    fetchAndDisplayHotelReviews: async function(hotelName) {
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

// ضمان عمل الدوال عالمياً حتى لا يتعطل أي زر
window.Hotels = Hotels;
window.filterHotels = Hotels.filterHotels;
window.searchLiveHotels = Hotels.searchLiveHotels;
window.renderChildAges = Hotels.renderChildAges;
