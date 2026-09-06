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

        return `<span class="inline-flex items-center gap-1.5 ${config.bg} ${config.text} px-2.5 py-1 rounded-lg text-[9px] md:text-[10px] font-black border ${config.border} shadow-sm whitespace-nowrap">
                    <i class="fa-solid ${config.icon} ${config.iconColor}"></i> ${title}
                </span>`;
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
                if(window.innerWidth <= 768 && typeof UI !== 'undefined' && UI.closeMobileSearchSheet) UI.closeMobileSearchSheet(); 
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

    displayHotels: function(hotelsArray) {
        const container = document.getElementById('hotelsContainer');
        if (!container) return; 
        container.innerHTML = '';
        
        if(!hotelsArray || hotelsArray.length === 0) {
            container.innerHTML = '<div class="text-center py-16 bg-white rounded-3xl border border-dashed border-slate-300"><p class="font-bold text-slate-400 text-lg">لا توجد فنادق متاحة تطابق بحثك حالياً.</p></div>';
            return;
        }

        const scarcityMsgs = [ 
            { text: "باقي غرفتين فقط!", color: "text-rose-600", bg: "bg-white/95", border: "border-rose-100", icon: "fa-fire text-rose-500" },
            { text: "مطلوب بشدة اليوم", color: "text-amber-600", bg: "bg-white/95", border: "border-amber-100", icon: "fa-arrow-trend-up text-amber-500" },
            { text: "خيار المسافرين المفضل", color: "text-[#00b4d8]", bg: "bg-white/95", border: "border-[#00b4d8]/30", icon: "fa-gem text-[#00b4d8]" }
        ];

        // حقن ستايل إخفاء شريط التمرير للموبايل
        if (!document.getElementById('hide-scrollbar-style')) {
            const style = document.createElement('style');
            style.id = 'hide-scrollbar-style';
            style.innerHTML = `.hide-scrollbar::-webkit-scrollbar { display: none; } .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`;
            document.head.appendChild(style);
        }

        hotelsArray.forEach((hotel, index) => {
            let randomScarcity = scarcityMsgs[Math.floor(Math.random() * scarcityMsgs.length)];
            let randomRating = (Math.random() * (9.9 - 8.0) + 8.0).toFixed(1); 
            
            let facilitiesHTML = '';
            if(hotel.hotelFacilities) {
                hotel.hotelFacilities.forEach(fac => {
                    let styledFac = fac.replace('<i ', '<i style="color: #00b4d8;" ');
                    facilitiesHTML += `<span class="inline-flex items-center gap-1.5 text-slate-600 text-[10px] font-bold shrink-0 bg-slate-50 px-2.5 py-1 rounded border border-slate-100 shadow-sm snap-center lg:snap-align-none">${styledFac}</span>`;
                });
            }
            const animationDelay = index * 100;
            let cashbackAED = (hotel.basePoints / 10).toFixed(0);

            let baseMealType = 'RO'; 
            if(hotel.priceAED > 800) baseMealType = 'BB';
            if(hotel.priceAED > 2000) baseMealType = 'HB';
            let mealBadge = Hotels.getMealPlanUI(baseMealType);

            // 🌟 الكاش باك المتكامل (Golden Foil Cashback)
            let cashbackHTML = typeof currentUser !== 'undefined' && currentUser ? 
                `<div class="w-full bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 p-2 lg:p-2.5 rounded-xl flex items-center justify-center gap-2 shadow-[0_2px_10px_rgba(251,191,36,0.15)] mb-3 lg:mb-4 cursor-default">
                    <i class="fa-solid fa-coins text-amber-500 text-base lg:text-lg drop-shadow-sm"></i>
                    <div class="text-right">
                        <span class="block text-[8px] lg:text-[9px] text-amber-600 font-black uppercase tracking-wider mb-0.5">مكافأة حجز</span>
                        <span class="block text-[10px] lg:text-[11px] font-black text-amber-900" dir="ltr">+${cashbackAED} AED</span>
                    </div>
                </div>` : 
                `<div class="w-full bg-white border border-slate-200 p-2 lg:p-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors hover:bg-slate-50 cursor-pointer mb-3 lg:mb-4" onclick="if(typeof Auth !== 'undefined') Auth.openAuthModal();">
                    <i class="fa-solid fa-lock text-slate-400 text-base lg:text-lg"></i>
                    <div class="text-right">
                        <span class="block text-[8px] lg:text-[9px] text-slate-500 font-black uppercase tracking-wider mb-0.5">مكافأة حجز</span>
                        <span class="block text-[9px] lg:text-[10px] font-bold text-[#00b4d8] underline decoration-dashed">سجل الدخول لتربح</span>
                    </div>
                </div>`;

            // 🚀 The Ultimate World Class UNIFIED Ticket UI 🚀
            container.innerHTML += `
            <div class="relative bg-white rounded-2xl lg:rounded-[2rem] shadow-[0_8px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_15px_40px_rgba(31,58,64,0.08)] border border-slate-100 transition-all duration-300 mb-6 lg:mb-8 group overflow-hidden animate-fade-in-up flex flex-col lg:flex-row mx-1 lg:mx-0" style="animation-delay: ${animationDelay}ms;">
              
              <!-- 1. Image Section -->
              <div class="relative w-full lg:w-[320px] shrink-0 h-52 sm:h-64 lg:h-auto overflow-hidden p-2 lg:p-2.5 pb-0 lg:pb-2.5">
                <div class="w-full h-full rounded-xl lg:rounded-[1.2rem] overflow-hidden relative">
                    <img src="${hotel.img}" alt="${hotel.name}" class="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" onerror="this.src='https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80'" />
                    <div class="absolute inset-0 bg-gradient-to-t from-[#1f3a40]/90 via-black/5 to-transparent pointer-events-none z-0"></div>
                    
                    <div class="absolute top-3 left-3 flex items-center bg-white/95 backdrop-blur-md rounded-xl shadow-lg overflow-hidden z-10 p-1 border border-white/50">
                        <div class="bg-gradient-to-r from-[#1f3a40] to-[#2a4d53] text-white px-2 py-1 rounded-lg flex items-center justify-center">
                            <span class="font-black text-[11px] md:text-xs tracking-wider" dir="ltr">${randomRating}</span>
                        </div>
                        <div class="px-2 flex items-center">
                            <span class="text-[#1f3a40] font-extrabold text-[9px] md:text-[10px]">رائع</span>
                        </div>
                    </div>
                    
                    <div class="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 ${randomScarcity.bg} ${randomScarcity.color} px-2.5 py-1 rounded-lg text-[9px] md:text-[10px] font-black shadow-md border ${randomScarcity.border}">
                        <i class="fa-solid ${randomScarcity.icon} animate-pulse"></i> ${randomScarcity.text}
                    </div>
                </div>
              </div>

              <!-- 2. Hotel Details Section -->
              <div class="flex-1 p-4 lg:p-7 flex flex-col justify-between relative z-10 bg-white text-right">
                  <div>
                      <div class="flex items-center gap-1 mb-1.5 lg:mb-2 justify-start">
                        <div class="flex text-yellow-400 text-[9px] md:text-[10px] drop-shadow-sm"><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i></div>
                      </div>
                      
                      <h3 class="text-lg lg:text-2xl font-black text-[#1f3a40] group-hover:text-[#00b4d8] transition-colors cursor-pointer leading-tight mb-2 line-clamp-2 w-full text-right"><bdi dir="auto">${hotel.name}</bdi></h3>
                      
                      <p class="text-[10px] lg:text-[12px] text-slate-500 font-bold mb-3 lg:mb-4 flex items-center gap-1.5 w-full justify-start">
                          <i class="fa-solid fa-location-dot text-[#00b4d8]"></i>
                          الإمارات - ${hotel.city} 
                          <span class="text-[#00b4d8] underline decoration-dashed cursor-pointer ml-2 text-[9px] md:text-[10px] hover:text-[#007790] transition-colors">عرض الخريطة</span>
                      </p>
                      
                      <div class="flex overflow-x-auto lg:flex-wrap gap-2 mt-2 justify-start w-full snap-x hide-scrollbar pb-1 lg:pb-0" style="-webkit-overflow-scrolling: touch;">
                          ${facilitiesHTML}
                      </div>
                  </div>
                  
                  <div class="mt-3 lg:mt-4 pt-3 lg:pt-4 border-t border-slate-50 flex flex-wrap items-center gap-2 md:gap-3 w-full justify-start">
                     ${mealBadge}
                     <span class="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg text-[9px] lg:text-[10px] font-black border border-emerald-100 shadow-sm"><i class="fa-solid fa-shield-check text-emerald-500"></i> إلغاء مجاني</span>
                  </div>
              </div>

              <!-- Masterstroke: The Unified Ticket Punch Hole Divider -->
              <div class="hidden lg:flex items-center relative z-20 w-0">
                  <div class="w-px h-[90%] border-l-2 border-dashed border-slate-200 absolute left-0 top-1/2 -translate-y-1/2"></div>
                  <div class="absolute -top-4 left-[-14px] w-7 h-7 bg-[#f8fafc] rounded-full border-b border-slate-200 shadow-inner z-30"></div>
                  <div class="absolute -bottom-4 left-[-14px] w-7 h-7 bg-[#f8fafc] rounded-full border-t border-slate-200 shadow-inner z-30"></div>
              </div>
              <div class="lg:hidden h-px border-t-2 border-dashed border-slate-200 relative z-20 mx-6 my-1">
                  <div class="absolute -left-6 -top-3.5 w-7 h-7 bg-[#f8fafc] rounded-full border-r border-slate-200 shadow-inner z-30"></div>
                  <div class="absolute -right-6 -top-3.5 w-7 h-7 bg-[#f8fafc] rounded-full border-l border-slate-200 shadow-inner z-30"></div>
              </div>

              <!-- 3. The Buy Box Section -->
              <div class="w-full lg:w-[270px] xl:w-[290px] p-4 lg:p-7 flex flex-col justify-center items-center bg-slate-50 shrink-0 z-10 relative overflow-hidden rounded-b-2xl lg:rounded-bl-[2rem] lg:rounded-br-none lg:rounded-tl-[2rem]">
                
                <!-- SVG Luxury Sand Dunes Pattern -->
                <div class="absolute inset-0 opacity-[0.03] pointer-events-none hidden lg:block" style="background-image: url('data:image/svg+xml,%3Csvg width=\\'100\\' height=\\'40\\' xmlns=\\'http://www.w3.org/2000/svg\\'%3E%3Cpath d=\\'M0 20 Q 20 0, 40 20 T 80 20\\' fill=\\'none\\' stroke=\\'%23800000\\' stroke-width=\\'2\\'/%3E%3C/svg%3E'); background-size: 100px 40px;"></div>

                <div class="text-center w-full relative z-10 flex flex-col justify-center h-full">
                    
                    <div class="hidden lg:block">
                        <span class="inline-block bg-[#00b4d8]/10 text-[#00b4d8] text-[10px] font-black px-3 py-1 rounded-full mb-3 border border-[#00b4d8]/20 tracking-wide uppercase mx-auto w-fit">أفضل سعر متاح</span>
                    </div>

                    <div class="flex flex-row lg:flex-col items-center lg:justify-center justify-between w-full mb-3 lg:mb-0">
                        <div class="text-right lg:text-center">
                            <span class="text-[9px] lg:text-[10px] font-bold text-slate-400 mb-0.5 block">السعر الإجمالي (لليلة)</span>
                            <div class="flex items-baseline justify-start lg:justify-center gap-1.5 mb-0.5 lg:mb-1" dir="ltr">
                                <span class="text-xs lg:text-sm font-bold text-slate-400 currency-label">AED</span>
                                <span class="text-3xl lg:text-4xl font-black text-[#1f3a40] tracking-tighter hotel-price-display" data-price-aed="${hotel.priceAED}">${hotel.priceAED}</span>
                            </div>
                            <span class="text-[8px] lg:text-[9px] text-slate-400 font-bold block">شامل الضرائب والرسوم</span>
                        </div>
                        
                        <!-- CTA Button on Mobile -->
                        <div class="w-[130px] lg:hidden">
                            <button class="w-full bg-gradient-to-l from-[#800000] to-[#a30000] active:scale-[0.98] transition-all text-white font-black py-3 rounded-xl shadow-[0_6px_15px_rgba(128,0,0,0.2)] border-none cursor-pointer text-xs flex items-center justify-center gap-1.5" 
                                onclick="Hotels.viewHotelDetails('${hotel.name.replace(/'/g, "\\'")}', ${hotel.priceAED}, ${JSON.stringify(hotel.rooms || []).replace(/"/g, '&quot;')})">
                                تحديد الغرف <i class="fa-solid fa-chevron-left text-[9px] opacity-80 pointer-events-none"></i>
                            </button>
                        </div>
                    </div>

                    <div class="hidden lg:block w-full">
                        ${cashbackHTML}
                        <!-- CTA Button on Desktop -->
                        <button class="w-full bg-gradient-to-l from-[#800000] to-[#a30000] hover:from-[#990000] hover:to-[#cc0000] active:scale-[0.98] transition-all duration-300 text-white font-black py-3.5 rounded-xl shadow-[0_6px_15px_rgba(128,0,0,0.2)] hover:shadow-[0_10px_20px_rgba(128,0,0,0.3)] border-none cursor-pointer text-sm flex items-center justify-center gap-2" 
                            onclick="Hotels.viewHotelDetails('${hotel.name.replace(/'/g, "\\'")}', ${hotel.priceAED}, ${JSON.stringify(hotel.rooms || []).replace(/"/g, '&quot;')})">
                            تحديد الغرف <i class="fa-solid fa-chevron-left text-[10px] opacity-80 pointer-events-none"></i>
                        </button>
                    </div>
                </div>
              </div>
            </div>`;
        });
        if (typeof UI !== 'undefined' && UI.changeCurrency) UI.changeCurrency();
    },

    // 🚀 Masterstroke 4: The Ultimate Room Details View 🚀
    viewHotelDetails: async function(hotelName, basePrice, apiRooms) {
        const titleEl = document.getElementById('detailsHotelName');
        if(titleEl) titleEl.innerHTML = `<bdi dir="auto"><span style="unicode-bidi: plaintext;">${hotelName}</span></bdi>`;
        
        const container = document.getElementById('roomsContainer');
        if (!container) return; 
        
        container.innerHTML = '<div class="flex flex-col justify-center items-center py-20 gap-3"><i class="fa-solid fa-circle-notch fa-spin text-4xl text-[#00b4d8]"></i><span class="text-slate-400 font-bold text-xs">جاري تجهيز أفضل خيارات الغرف...</span></div>';
        
        if (typeof UI !== 'undefined' && UI.switchView) {
            UI.switchView('roomSelectionView');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        await Hotels.fetchAndDisplayHotelReviews(hotelName);

        // 🌟 Masterstroke 4: Sticky Action Bar (يظهر عند النزول بالصفحة)
        let stickyHeaderHTML = `
            <div class="sticky top-[60px] lg:top-[70px] z-[40] bg-white/95 backdrop-blur-xl border border-slate-200 shadow-[0_10px_30px_rgba(31,58,64,0.08)] p-3 md:p-4 mb-6 rounded-2xl flex justify-between items-center animate-fade-in-up">
                <div class="flex items-center gap-2 md:gap-3">
                    <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-cyan-50 flex items-center justify-center shrink-0 border border-cyan-100">
                        <i class="fa-solid fa-hotel text-[#00b4d8] text-xs md:text-sm"></i>
                    </div>
                    <div>
                        <h3 class="text-xs md:text-sm font-black text-[#1f3a40] line-clamp-1 w-[120px] sm:w-auto"><bdi dir="auto">${hotelName}</bdi></h3>
                        <p class="text-[9px] md:text-[10px] text-emerald-600 font-bold mt-0.5"><i class="fa-solid fa-check-circle"></i> متوفر غرف للحجز الفوري</p>
                    </div>
                </div>
                <div class="text-left flex items-center gap-3">
                    <div class="hidden sm:block text-right">
                        <span class="text-[9px] text-slate-400 block font-bold">ابتداءً من</span>
                        <div class="flex items-baseline gap-1" dir="ltr">
                            <span class="text-[10px] font-bold text-slate-400">AED</span>
                            <span class="text-lg font-black text-[#1f3a40] tracking-tighter">${basePrice}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        let roomsList = [];
        if (hotelName.includes('الفندق التجريبي') || !apiRooms || apiRooms.length === 0) {
            roomsList = [
                { name: "غرفة قياسية (Standard Room)", bed: "سرير مزدوج مريح", board: "RO", price: basePrice, points: Math.floor(basePrice*10), policyText: "حجز اقتصادي - غير قابل للاسترداد", isFreeCancel: false, rateKey: "MOCK-RATE-STD", paymentType: "AT", refundType: "non_refundable", urgency: "🔥 حجز سريع • آخر غرفة متاحة" },
                { name: "غرفة ديلوكس (Deluxe Room)", bed: "سرير كينج كبير مع إطلالة", board: "BB", price: Math.floor(basePrice * 1.2), points: Math.floor(basePrice*12), policyText: "إلغاء مجاني حتى قبل الموعد بـ 48 ساعة", isFreeCancel: true, rateKey: "MOCK-RATE-DLX", paymentType: "HOTEL", refundType: "full_100", urgency: "⚡ الأكثر طلباً • 4 أشخاص يتصفحونها" },
                { name: "جناح تنفيذي (Executive Suite)", bed: "سرير كينج فاخر + صالة", board: "HB", price: Math.floor(basePrice * 1.8), points: Math.floor(basePrice*18), policyText: "إلغاء مجاني 100% - خيار ادفع لاحقاً", isFreeCancel: true, rateKey: "MOCK-RATE-STE", paymentType: "HOTEL", refundType: "full_100", urgency: "👑 تجربة VIP فاخرة" }
            ];
        } else {
            apiRooms.forEach((room, rIdx) => {
                if (room.rates && room.rates.length > 0) {
                    room.rates.forEach((rate, rateIdx) => {
                        let rType = 'full_100';
                        if(rate.freeCancellation) rType = 'full_100'; else if(rate.cancellationPolicies && rate.cancellationPolicies.length > 0) rType = 'api_policy'; else rType = 'non_refundable';
                        let currentPrice = rate.net ? parseFloat(rate.net) : basePrice;
                        let urgencyTags = ["⚡ حجز سريع ومضمون", "🔥 مطلوب بشدة اليوم", "✨ خيار ذكي للمسافرين"];
                        roomsList.push({
                            name: room.name || "غرفة فندقية فاخرة", bed: "سرير كينج / مزدوج", board: rate.boardName || rate.board || "شامل الوجبات",
                            price: currentPrice, points: Math.floor(currentPrice * 10),
                            policyText: rate.formattedPolicy || "شروط الإلغاء مطبقة وفق سياسة الفندق", isFreeCancel: rate.freeCancellation || false,
                            rateKey: rate.rateKey, paymentType: rate.paymentType || 'AT', refundType: rType,
                            urgency: urgencyTags[(rIdx + rateIdx) % urgencyTags.length]
                        });
                    });
                }
            });
        }

        container.innerHTML = stickyHeaderHTML;
        
        roomsList.forEach((room, index) => {
            let cancelClass = room.isFreeCancel ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800' : 'border-slate-200 bg-slate-50/60 text-slate-700';
            let cancelIcon = room.isFreeCancel ? 'fa-shield-check text-emerald-500' : 'fa-circle-info text-slate-400';
            let policyTitleColor = room.isFreeCancel ? 'text-emerald-700' : 'text-slate-600';
            const animationDelay = index * 80;
            let cashbackAED = (room.points / 10).toFixed(0);
            let mealBadge = Hotels.getMealPlanUI(room.board);

            container.innerHTML += `
                <div class="relative flex flex-col lg:flex-row bg-white rounded-2xl md:rounded-[2rem] shadow-[0_4px_25px_rgba(0,0,0,0.03)] hover:shadow-[0_15px_40px_rgba(31,58,64,0.07)] border border-slate-100 transition-all duration-300 mb-6 overflow-hidden group animate-fade-in-up mx-1 lg:mx-0" style="animation-delay: ${animationDelay}ms;">
                    
                    <div class="flex-1 p-5 lg:p-7 flex flex-col justify-between relative z-10 bg-white text-right">
                        <div>
                            <div class="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-100 text-rose-600 px-2.5 py-1 rounded-full text-[9px] md:text-[10px] font-black mb-3">
                                <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
                                ${room.urgency}
                            </div>

                            <h3 class="text-lg sm:text-xl md:text-2xl font-black text-[#1f3a40] leading-tight mb-2 flex items-center gap-2 justify-start">
                                <bdi dir="auto">${room.name}</bdi>
                            </h3>

                            <div class="flex overflow-x-auto lg:flex-wrap items-center gap-2 mt-3 justify-start hide-scrollbar snap-x pb-1 lg:pb-0" style="-webkit-overflow-scrolling: touch;">
                                <span class="inline-flex items-center gap-1.5 bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-[10px] md:text-[11px] font-bold border border-slate-100 shrink-0 snap-center lg:snap-align-none">
                                    <i class="fa-solid fa-bed text-[#00b4d8]"></i> ${room.bed}
                                </span>
                                <span class="inline-flex items-center gap-1.5 bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-[10px] md:text-[11px] font-bold border border-slate-100 shrink-0 snap-center lg:snap-align-none">
                                    <i class="fa-solid fa-user-group text-[#00b4d8]"></i> يتسع لـ 2 بالغين
                                </span>
                                ${mealBadge}
                            </div>
                        </div>

                        <div class="mt-4 border ${cancelClass} p-3 rounded-xl text-[10px] md:text-xs font-bold flex items-start gap-2 relative overflow-hidden text-right">
                            <i class="fa-solid ${cancelIcon} mt-0.5 text-sm shrink-0"></i>
                            <div class="min-w-0">
                                <span class="block ${policyTitleColor} font-black text-[11px] mb-0.5">سياسة الإلغاء:</span>
                                <span class="font-semibold block text-slate-600 leading-relaxed"><bdi dir="auto">${room.policyText}</bdi></span>
                            </div>
                        </div>
                    </div>

                    <!-- Room Ticket Divider -->
                    <div class="hidden lg:flex items-center relative z-20 w-0">
                        <div class="w-px h-[85%] border-l-2 border-dashed border-slate-200 absolute left-0 top-1/2 -translate-y-1/2"></div>
                        <div class="absolute -top-3.5 left-[-12px] w-6 h-6 bg-[var(--bg-light)] rounded-full border-b border-slate-200 shadow-inner z-30"></div>
                        <div class="absolute -bottom-3.5 left-[-12px] w-6 h-6 bg-[var(--bg-light)] rounded-full border-t border-slate-200 shadow-inner z-30"></div>
                    </div>
                    <div class="lg:hidden h-px border-t-2 border-dashed border-slate-200 relative z-20 mx-6 my-1">
                        <div class="absolute -left-5 -top-3 w-6 h-6 bg-[var(--bg-light)] rounded-full border-r border-slate-200 shadow-inner z-30"></div>
                        <div class="absolute -right-5 -top-3 w-6 h-6 bg-[var(--bg-light)] rounded-full border-l border-slate-200 shadow-inner z-30"></div>
                    </div>

                    <!-- Room Buy Box (Left) -->
                    <div class="w-full lg:w-[270px] xl:w-[290px] p-5 lg:p-7 flex flex-col justify-center items-center bg-slate-50 shrink-0 z-10 relative overflow-hidden rounded-b-2xl lg:rounded-bl-[2rem] lg:rounded-br-none lg:rounded-tl-[2rem]">
                        
                        <!-- Topographic Background SVG -->
                        <div class="absolute inset-0 opacity-[0.03] pointer-events-none hidden lg:block" style="background-image: url('data:image/svg+xml,%3Csvg width=\\'80\\' height=\\'80\\' viewBox=\\'0 0 80 80\\' xmlns=\\'http://www.w3.org/2000/svg\\'%3E%3Cg fill=\\'%231f3a40\\' fill-rule=\\'evenodd\\'%3E%3Cpath d=\\'M0 0h40v40H0V0zm40 40h40v40H40V40z\\'/%3E%3C/g%3E%3C/svg%3E');"></div>

                        <div class="text-center w-full relative z-10 flex flex-col lg:flex-col flex-row justify-between lg:justify-center items-center h-full">
                            
                            <!-- Golden Foil Cashback Badge (Desktop) -->
                            <div class="hidden lg:flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-100/80 to-yellow-50 border border-amber-200/80 px-3 py-1 rounded-full mb-3 mx-auto shadow-sm w-fit">
                                <i class="fa-solid fa-coins text-amber-500 text-[11px]"></i>
                                <span class="text-[10px] font-black text-amber-900" dir="ltr">+${cashbackAED} AED كاش باك</span>
                            </div>

                            <div class="text-right lg:text-center w-1/2 lg:w-full">
                                <span class="text-[9px] lg:text-[10px] font-bold text-slate-400 mb-0.5 block">الإجمالي للغرفة</span>
                                <div class="flex items-baseline justify-start lg:justify-center gap-1 mb-1" dir="ltr">
                                    <span class="text-xs font-bold text-slate-400 currency-label">AED</span>
                                    <span class="text-3xl lg:text-4xl font-black text-[#1f3a40] tracking-tighter hotel-price-display" data-price-aed="${room.price}">${room.price}</span>
                                </div>
                                <span class="hidden lg:block text-[8px] md:text-[9px] text-slate-400 font-bold mb-4">شامل كافة الضرائب</span>
                            </div>

                            <div class="w-[140px] lg:w-full">
                                <!-- Booking CTA Button (Red Velvet Style) -->
                                <button class="w-full bg-gradient-to-l from-[#800000] to-[#a30000] hover:from-[#990000] hover:to-[#cc0000] active:scale-[0.98] transition-all duration-300 text-white font-black py-3 lg:py-3.5 rounded-xl shadow-[0_6px_18px_rgba(128,0,0,0.25)] border-none cursor-pointer text-xs md:text-sm flex items-center justify-center gap-2" 
                                    onclick="if(typeof Checkout !== 'undefined') Checkout.goToBooking('${hotelName.replace(/'/g, "\\'")}', ${room.price}, '${room.name.replace(/'/g, "\\'")}', '${room.board}', '${room.policyText.replace(/'/g, "\\'")}', '${room.rateKey}', '${room.paymentType}', '${room.refundType}')">
                                    <i class="fa-solid fa-lock text-white/60 text-[10px] md:text-xs"></i> 
                                    <span>احجز الغرفة</span>
                                </button>
                            </div>
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

// ضمان عمل الدوال عالمياً
window.Hotels = Hotels;
window.filterHotels = Hotels.filterHotels;
window.searchLiveHotels = Hotels.searchLiveHotels;
window.renderChildAges = Hotels.renderChildAges;
window.viewHotelDetails = Hotels.viewHotelDetails;
