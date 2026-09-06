// js/checkout.js

const Checkout = {
    viewHotelDetails: async function(hotelName, basePrice, apiRooms) {
        document.getElementById('detailsHotelName').innerHTML = `<bdi dir="auto"><span style="unicode-bidi: plaintext;">${hotelName}</span></bdi>`;
        const container = document.getElementById('roomsContainer');
        if (!container) return; container.innerHTML = '';
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
            if (currentUser) {
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
                            onclick="Checkout.goToBooking('${hotelName.replace(/'/g, "\\'")}', ${room.price}, '${room.name.replace(/'/g, "\\'")}', '${room.board}', '${room.policyText.replace(/'/g, "\\'")}', '${room.rateKey}', '${room.paymentType}', '${room.refundType}')">
                            <i class="fa-solid fa-lock text-white/50 text-[10px] md:text-sm"></i> حجز هذه الغرفة
                        </button>

                        <div class="w-full bg-white border border-amber-100 rounded-lg md:rounded-xl p-2 flex items-center justify-start gap-2 md:gap-3 shadow-sm cursor-default">
                            ${currentUser ? coinBadgeHTML : `<div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-amber-50 flex items-center justify-center border border-amber-200 cursor-pointer hover:bg-amber-100 shrink-0" onclick="Auth.openAuthModal()"><i class="fa-solid fa-piggy-bank text-amber-500 text-xs md:text-base"></i></div>`}
                            <div class="text-right flex-1">
                                <span class="block text-[8px] md:text-[9px] text-amber-600 font-black uppercase tracking-wider">كاش باك مسترد</span>
                                <span class="block text-[10px] md:text-xs font-black text-[#1f3a40]">${currentUser ? `+ ${cashbackAED} نقطة` : '<span class="text-slate-400 underline decoration-dashed cursor-pointer text-[9px] md:text-[10px]" onclick="Auth.openAuthModal()">سجل لتربح</span>'}</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        });
        UI.changeCurrency(); 
        UI.switchView('roomSelectionView');
    },

    goToBooking: function(hotelName, price, roomName, boardType, policyText, rateKey, paymentType, refundType) {
        if (!currentUser) { UI.showToast('info', 'تنبيه', 'الرجاء تسجيل الدخول أولاً قبل الانتقال للحجز والاستفادة من خصم النقاط!'); Auth.openAuthModal(); return; }
        selectedHotel = `${hotelName} - ${roomName} (${boardType})`; currentBasePrice = price; currentPolicyText = policyText; currentRateKey = rateKey; currentPaymentType = paymentType || 'AT'; currentRefundType = refundType || 'full_100';
        
        document.getElementById('hotelNameTitle').innerHTML = `تأكيد حجز: <i class="fa-solid fa-hotel text-slate-400 mx-1 text-sm md:text-lg"></i> <br class="md:hidden" /><bdi dir="auto" class="text-[#1f3a40] text-base md:text-2xl mt-1 md:mt-0 inline-block"><span style="unicode-bidi: plaintext;">${hotelName}</span></bdi>`;
        document.getElementById('selectedRoomDetails').innerHTML = `
            <div class="absolute -left-2 md:-left-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-6 md:h-6 bg-white rounded-full border-r border-[#00b4d8]/30"></div>
            <div class="absolute -right-2 md:-right-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-6 md:h-6 bg-white rounded-full border-l border-[#00b4d8]/30"></div>
            <ul class="space-y-2.5 md:space-y-3.5 text-xs md:text-base font-bold text-slate-700">
                <li class="flex items-start gap-2 md:gap-3"><i class="fa-solid fa-bed text-teal-600 mt-1 pl-0.5 shrink-0"></i><span>اختيارك: <bdi dir="auto" class="text-teal-800"><span style="unicode-bidi: plaintext;">${roomName}</span></bdi></span></li>
                <li class="flex items-start gap-2 md:gap-3"><i class="fa-solid fa-utensils text-yellow-600 mt-1 pl-1 shrink-0"></i><span>الوجبات: <span class="text-yellow-800">${boardType}</span></span></li>
                <li class="flex items-start gap-2 md:gap-3"><i class="fa-solid fa-shield-halved text-green-600 mt-1 pl-1 shrink-0"></i><span>سياسة الإلغاء: <span class="text-green-800 whitespace-pre-line block mt-0.5 md:mt-1 text-[10px] md:text-sm"><bdi dir="auto"><span style="unicode-bidi: plaintext;">${policyText}</span></bdi></span></span></li>
            </ul>`;

        const payMethodsContainer = document.getElementById('paymentMethodsContainer');
        const electronicPaymentHTML = `
            <label class="bg-white border-2 border-[#00b4d8] rounded-xl p-3 md:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 md:gap-4 relative cursor-pointer selected-pay-option" onclick="Checkout.selectPayment('visa', this)">
                <input type="radio" name="payMethod" value="visa" checked class="hidden">
                <div class="absolute -top-2 -right-2 md:-top-2.5 md:-right-2.5 w-5 h-5 md:w-6 md:h-6 bg-[#00b4d8] rounded-full text-white flex items-center justify-center shadow-md check-icon"><i class="fa-solid fa-check text-[8px] md:text-xs"></i></div>
                <div class="flex items-center gap-2 md:gap-3"><i class="fa-regular fa-credit-card text-[#00b4d8] text-lg md:text-xl"></i><div><span class="block font-black text-slate-800 text-xs md:text-sm">دفع إلكتروني آمن</span><span class="block text-[10px] md:text-xs font-bold text-slate-400 mt-0.5">مطلوب مسبقاً لتأكيد الحجز</span></div></div>
                <div class="flex items-center gap-2 md:gap-2.5 text-xl md:text-2xl text-slate-300 mt-2 sm:mt-0"><i class="fa-brands fa-cc-visa"></i><i class="fa-brands fa-cc-mastercard"></i><i class="fa-brands fa-cc-apple-pay"></i></div>
            </label>`;
        
        const hotelPaymentHTML = `
            <label class="bg-white border-2 border-slate-200 rounded-xl p-3 md:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 md:gap-4 relative cursor-pointer selected-pay-option" onclick="Checkout.selectPayment('hotel', this)">
                <input type="radio" name="payMethod" value="hotel" class="hidden">
                <div class="absolute -top-2 -right-2 md:-top-2.5 md:-right-2.5 w-5 h-5 md:w-6 md:h-6 bg-[#00b4d8] rounded-full text-white items-center justify-center shadow-md check-icon hidden"><i class="fa-solid fa-check text-[8px] md:text-xs"></i></div>
                <div class="flex items-center gap-2 md:gap-3"><i class="fa-solid fa-bell-concierge text-slate-400 text-lg md:text-xl"></i><div><span class="block font-black text-slate-800 text-xs md:text-sm">الدفع في الفندق</span><span class="block text-[10px] md:text-xs font-bold text-slate-400 mt-0.5">يتم الدفع عند الاستقبال</span></div></div>
            </label>`;

        if (currentPaymentType === 'HOTEL') { payMethodsContainer.innerHTML = electronicPaymentHTML + hotelPaymentHTML; } 
        else { payMethodsContainer.innerHTML = electronicPaymentHTML; }
        
        document.getElementById('custName').value = currentUser.name; document.getElementById('custEmail').value = currentUser.email; document.getElementById('custPhone').value = currentUser.phone || '';
        
        document.getElementById('summaryBasePrice').innerText = currentBasePrice;
        document.getElementById('checkoutAvailablePoints').innerText = currentUser.points || 0;
        
        Checkout.setupPointsDropdown(); 
        UI.switchView('bookingView');
    },

    setupPointsDropdown: function() {
        const select = document.getElementById('pointsDiscountSelect');
        if (!select) return; select.innerHTML = '<option value="0">بدون استخدام نقاط</option>';
        if(currentUser && currentUser.points >= 50) {
            let maxPointsToUse = Math.min(currentUser.points, currentBasePrice * 10);
            for(let p = 50; p <= maxPointsToUse; p += 50) { select.innerHTML += `<option value="${p}">${p} نقطة (خصم ${p/10} AED)</option>`; }
        }
        Checkout.updateFinalPriceCalculation();
    },

    updateFinalPriceCalculation: function() {
        const usedPts = parseInt(document.getElementById('pointsDiscountSelect').value) || 0;
        const discountAED = usedPts / 10;
        let finalAED = Math.max(0, currentBasePrice - discountAED);
        
        const discountRow = document.getElementById('discountRow');
        if(discountAED > 0) {
            discountRow.classList.remove('hidden');
            document.getElementById('summaryDiscountAmount').innerText = discountAED;
        } else {
            discountRow.classList.add('hidden');
        }

        const selectedCurrency = document.getElementById('currencySelector').value;
        const currencyLabel = document.getElementById('finalPriceCurrencyLabel');
        const rates = { 'USD': 0.27, 'EUR': 0.25, 'SAR': 1.02, 'AED': 1 };
        
        let converted = (finalAED * rates[selectedCurrency]).toFixed(2);
        document.getElementById('finalPriceDisplay').innerText = converted;
        if (currencyLabel) currencyLabel.innerText = selectedCurrency;
    },

    selectPayment: function(method, element) {
        document.querySelectorAll('.selected-pay-option').forEach(el => {
            el.classList.remove('border-[#00b4d8]'); el.classList.add('border-slate-200');
            const checkIcon = el.querySelector('.check-icon'); if(checkIcon) { checkIcon.classList.remove('flex'); checkIcon.classList.add('hidden'); }
            const mainIcon = el.querySelector('.fa-solid, .fa-regular'); if(mainIcon) { mainIcon.classList.remove('text-[#00b4d8]'); mainIcon.classList.add('text-slate-400'); }
        });
        element.classList.remove('border-slate-200'); element.classList.add('border-[#00b4d8]');
        const activeCheck = element.querySelector('.check-icon'); if(activeCheck) { activeCheck.classList.remove('hidden'); activeCheck.classList.add('flex'); }
        const activeMain = element.querySelector('.fa-solid, .fa-regular'); if(activeMain) { activeMain.classList.remove('text-slate-400'); activeMain.classList.add('text-[#00b4d8]'); }
        element.querySelector('input').checked = true;
    },

    confirmReservation: async function(e) {
        e.preventDefault();
        const customerName = document.getElementById('custName').value; 
        const email = document.getElementById('custEmail').value; 
        const phone = document.getElementById('custPhone').value;
        const companions = document.getElementById('custCompanions').value; 
        const paymentMethod = document.querySelector('input[name="payMethod"]:checked').value; 
        const pointsUsed = parseInt(document.getElementById('pointsDiscountSelect').value) || 0;
        
        const btn = e.target.querySelector('button[type="submit"]'); 
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm md:text-lg"></i> <span class="text-xs md:text-sm">جاري التجهيز (Ziina)...</span>'; 
        btn.disabled = true;

        try {
            const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
            let finalPrice = Math.max(0, currentBasePrice - (pointsUsed / 10));

            const ziinaRes = await fetch(`${API_URL}/api/v1/payments/ziina-intent`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ amountAED: finalPrice, bookingReference: bookingReference }) 
            });
            const ziinaData = await ziinaRes.json();

            if (ziinaData.success && (ziinaData.redirect_url || ziinaData.embedded_url)) {
                const pendingData = { 
                    bookingReference, 
                    ziinaPaymentId: ziinaData.ziinaPaymentId || '', 
                    hotelName: selectedHotel, 
                    customerName, 
                    email, 
                    phone, 
                    companions, 
                    paymentMethod, 
                    price: finalPrice, 
                    pointsUsed, 
                    cancellationPolicy: currentPolicyText, 
                    rateKey: currentRateKey, 
                    refundType: currentRefundType 
                };
                localStorage.setItem('pending_reservation', JSON.stringify(pendingData)); 

                btn.innerHTML = '<i class="fa-solid fa-lock text-sm md:text-lg"></i> <span class="text-xs md:text-sm">جاري تحويلك لصفحة الدفع...</span>';
                
                const paymentUrl = ziinaData.redirect_url || ziinaData.embedded_url;
                window.location.href = paymentUrl;

            } else { 
                UI.showToast('error', 'خطأ في الدفع', ziinaData.error || 'تعذر إنشاء رابط الدفع'); 
                btn.innerHTML = origText; 
                btn.disabled = false; 
            }
        } catch(err) { 
            console.error(err); 
            UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم أثناء تجهيز الدفع.'); 
            btn.innerHTML = origText; 
            btn.disabled = false; 
        }
    },

    showPremiumModifyModal: function(bookingRef, currentName, currentPhone, onSaveCallback) {
        const modalHtml = `
            <div id="remal-modify-overlay" class="modal-overlay" style="display:flex; opacity:0; transition: 0.3s ease; z-index:9999;">
                <div class="bg-white w-[90%] max-w-md rounded-2xl md:rounded-3xl p-5 md:p-8 text-center shadow-2xl transform scale-95 transition-transform duration-300 border-t-[4px] md:border-t-[6px] border-[#00b4d8]">
                    
                    <div class="w-12 h-12 md:w-16 md:h-16 bg-cyan-50 text-[#00b4d8] rounded-full flex items-center justify-center mx-auto mb-3 md:mb-4 border border-cyan-100 shadow-sm">
                        ${UI_ICONS.modalEdit}
                    </div>
                    
                    <h3 class="text-[#1f3a40] font-black text-lg md:text-xl mb-1 md:mb-2">تحديث بيانات الحجز</h3>
                    <p class="text-slate-500 font-bold text-xs md:text-sm mb-4 md:mb-6">المرجع: <b dir="ltr" class="text-[#1f3a40]">${bookingRef}</b></p>
                    
                    <div class="space-y-4 md:space-y-5 text-right mb-6 md:mb-8" dir="rtl">
                        <div>
                            <label class="block text-[10px] md:text-xs font-bold text-slate-600 mb-1.5 md:mb-2 uppercase tracking-wide">تعديل اسم الضيف:</label>
                            <div class="relative group">
                                <i class="fa-solid fa-user absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#00b4d8] transition-colors pointer-events-none text-xs md:text-sm"></i>
                                <input type="text" id="editModalName" value="${currentName}" class="w-full bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl py-2.5 md:py-3.5 pr-9 md:pr-11 pl-3 md:pl-4 text-xs md:text-sm font-bold text-[#1f3a40] focus:outline-none focus:bg-white focus:border-[#00b4d8] focus:ring-2 focus:ring-[#00b4d8]/20 transition-all shadow-sm" />
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-[10px] md:text-xs font-bold text-slate-600 mb-1.5 md:mb-2 uppercase tracking-wide">تعديل رقم الهاتف:</label>
                            <div class="relative group">
                                <i class="fa-solid fa-phone absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#00b4d8] transition-colors pointer-events-none text-xs md:text-sm"></i>
                                <input type="tel" id="editModalPhone" value="${currentPhone}" dir="ltr" class="w-full text-left bg-slate-50 border border-slate-200 rounded-lg md:rounded-xl py-2.5 md:py-3.5 pl-9 md:pl-11 pr-3 md:pr-4 text-xs md:text-sm font-bold text-[#1f3a40] focus:outline-none focus:bg-white focus:border-[#00b4d8] focus:ring-2 focus:ring-[#00b4d8]/20 transition-all tracking-widest shadow-sm" />
                            </div>
                        </div>
                    </div>

                    <div class="flex gap-2 md:gap-3">
                        <button id="remal-modify-cancel" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 md:py-3.5 rounded-lg md:rounded-xl transition-colors cursor-pointer border-none shadow-sm text-xs md:text-sm">إلغاء</button>
                        <button id="remal-modify-save" class="flex-[1.5] bg-gradient-to-r from-[#00b4d8] to-[#007790] hover:from-[#0096b4] hover:to-[#005f73] text-white font-black py-2.5 md:py-3.5 rounded-lg md:rounded-xl transition-colors cursor-pointer border-none shadow-md flex items-center justify-center gap-1.5 md:gap-2 text-xs md:text-sm">
                            حفظ التحديثات <i class="fa-solid fa-check"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const overlay = document.getElementById('remal-modify-overlay');
        const innerBox = overlay.querySelector('.bg-white');
        
        setTimeout(() => {
            overlay.style.opacity = '1';
            innerBox.classList.remove('scale-95');
            innerBox.classList.add('scale-100');
        }, 10);

        document.getElementById('remal-modify-cancel').onclick = () => {
            overlay.style.opacity = '0';
            innerBox.classList.remove('scale-100');
            innerBox.classList.add('scale-95');
            setTimeout(() => overlay.remove(), 300);
        };

        document.getElementById('remal-modify-save').onclick = () => {
            const newName = document.getElementById('editModalName').value.trim();
            const newPhone = document.getElementById('editModalPhone').value.trim();
            
            if(!newName || !newPhone) {
                UI.showToast('error', 'بيانات ناقصة', 'الرجاء إدخال الاسم ورقم الهاتف.');
                return;
            }

            const btn = document.getElementById('remal-modify-save');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحديث...';
            btn.disabled = true;
            btn.classList.add('opacity-80', 'cursor-not-allowed');
            
            onSaveCallback(newName, newPhone, overlay, innerBox); 
        };
    },

    modifyBookingPrompt: async function(bookingReference, currentName, currentPhone) {
        Checkout.showPremiumModifyModal(bookingReference, currentName, currentPhone, async (newName, newPhone, overlay, innerBox) => {
            try {
                const res = await fetch(`${API_URL}/api/v1/bookings/modify/${bookingReference}`, { 
                    method: 'PUT', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ customerName: newName, phone: newPhone }) 
                });
                const data = await res.json();
                
                overlay.style.opacity = '0';
                innerBox.classList.remove('scale-100');
                innerBox.classList.add('scale-95');
                setTimeout(() => overlay.remove(), 300);

                if (data.success) { 
                    UI.showToast('success', 'نجاح', 'تم تحديث بيانات الضيف بنجاح!'); 
                    Auth.fetchUserData();
                } else { 
                    UI.showToast('error', 'حدث خطأ', data.error); 
                }
            } catch(e) { 
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
                UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); 
            }
        });
    },

    resendVoucherEmail: async function(bookingReference, email) {
        try {
            const res = await fetch(`${API_URL}/api/v1/bookings/resend-email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingReference, email }) });
            const data = await res.json();
            if(data.success) { UI.showToast('success', 'تم الإرسال', data.message); } else { UI.showToast('error', 'حدث خطأ', data.error); }
        } catch(e) { UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); }
    },

    showPremiumCancelModal: function(bookingRef, price, refundType, policyText, onConfirmCallback) {
        let refundAmount = 0;
        let refundPercentageText = "0%";
        
        if (refundType === 'full_100' || policyText.includes('100%')) {
            refundAmount = price;
            refundPercentageText = "100%";
        } else if (refundType === 'partial_50' || policyText.includes('50%') || policyText.includes('جزء')) {
            refundAmount = price * 0.5;
            refundPercentageText = "50%";
        } else if (refundType === 'non_refundable' || policyText.includes('غير قابل للاسترداد') || policyText.includes('لا يوجد')) {
            refundAmount = 0;
            refundPercentageText = "غير قابل للاسترداد";
        } else {
            refundAmount = 0;
            refundPercentageText = "غير قابل للاسترداد";
        }

        const modalHtml = `
            <div id="remal-cancel-overlay" class="modal-overlay" style="display:flex; opacity:0; transition: 0.3s ease; z-index:9999;">
                <div class="bg-white w-[90%] max-w-md rounded-2xl md:rounded-3xl p-5 md:p-6 text-center shadow-2xl transform scale-95 transition-transform duration-300 border-t-[4px] md:border-t-[6px] border-[#ff595e]">
                    <div class="w-12 h-12 md:w-16 md:h-16 bg-red-50 text-[#ff595e] rounded-full flex items-center justify-center mx-auto mb-3 md:mb-4">
                        <i class="fa-solid fa-triangle-exclamation text-2xl md:text-3xl"></i>
                    </div>
                    
                    <h3 class="text-[#1f3a40] font-black text-lg md:text-xl mb-1 md:mb-2">هل أنت متأكد من الإلغاء؟</h3>
                    <p class="text-slate-500 font-bold text-xs md:text-sm mb-4 md:mb-5">أنت على وشك إلغاء الحجز رقم: <b dir="ltr" class="text-[#1f3a40]">${bookingRef}</b></p>
                    
                    <div class="bg-slate-50 border border-slate-200 rounded-xl md:rounded-2xl p-3 md:p-4 mb-4 md:mb-6 text-right" dir="rtl">
                        <p class="text-xs md:text-sm font-bold text-slate-600 mb-1.5 md:mb-2 flex items-center gap-1.5 md:gap-2"><i class="fa-solid fa-file-contract text-[#00b4d8]"></i> سياسة الفندق:</p>
                        <p class="text-[10px] md:text-xs font-bold text-[#be123c] mb-3 md:mb-4 bg-red-50 p-2 rounded-lg border border-red-100"><bdi dir="auto"><span style="unicode-bidi: plaintext;">${policyText}</span></bdi></p>
                        
                        <div class="bg-white border border-slate-200 p-2 md:p-3 rounded-lg md:rounded-xl text-center">
                            <span class="block text-[10px] md:text-xs font-bold text-slate-500 mb-0.5 md:mb-1">المبلغ الخاضع للاسترداد (${refundPercentageText})</span>
                            <span class="block text-lg md:text-xl font-black text-[#1f3a40]" dir="ltr">AED ${refundAmount}</span>
                        </div>
                    </div>

                    <div class="flex gap-2 md:gap-3">
                        <button id="remal-close-btn" class="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 md:py-3 rounded-lg md:rounded-xl transition-colors cursor-pointer border-none text-xs md:text-sm">تراجع</button>
                        <button id="remal-confirm-btn" class="flex-1 bg-[#ff595e] hover:bg-red-600 text-white font-bold py-2.5 md:py-3 rounded-lg md:rounded-xl transition-colors cursor-pointer border-none shadow-md text-xs md:text-sm">نعم، ألغِ الحجز</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const overlay = document.getElementById('remal-cancel-overlay');
        const innerBox = overlay.querySelector('.bg-white');
        
        setTimeout(() => {
            overlay.style.opacity = '1';
            innerBox.classList.remove('scale-95');
            innerBox.classList.add('scale-100');
        }, 10);

        document.getElementById('remal-close-btn').onclick = () => {
            overlay.style.opacity = '0';
            innerBox.classList.remove('scale-100');
            innerBox.classList.add('scale-95');
            setTimeout(() => overlay.remove(), 300);
        };

        document.getElementById('remal-confirm-btn').onclick = () => {
            const btn = document.getElementById('remal-confirm-btn');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الإلغاء...';
            btn.disabled = true;
            btn.classList.add('opacity-70', 'cursor-not-allowed');
            onConfirmCallback(overlay, innerBox); 
        };
    },

    cancelBookingAPI: async function(bookingReference, price, refundType, policyText) {
        Checkout.showPremiumCancelModal(bookingReference, price, refundType, policyText, async (overlay, innerBox) => {
            try {
                const res = await fetch(`${API_URL}/api/v1/bookings/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingReference }) });
                const data = await res.json();
                
                overlay.style.opacity = '0';
                innerBox.classList.remove('scale-100');
                innerBox.classList.add('scale-95');
                setTimeout(() => overlay.remove(), 300);

                if(data.success) { 
                    UI.showToast('success', 'تم الإلغاء بنجاح', data.message); 
                    Auth.fetchUserData(); 
                } else { 
                    UI.showToast('error', 'حدث خطأ', data.error); 
                }
            } catch(e) { 
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 300);
                UI.showToast('error', 'خطأ اتصال', 'تعذر الاتصال بالخادم.'); 
            }
        });
    }
};
