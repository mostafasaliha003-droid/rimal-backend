// js/checkout.js

const Checkout = {
    currentBookingData: null,

    goToBooking: function(bookingData) {
        if (!currentUser) { 
            UI.showToast('info', 'تنبيه', 'الرجاء تسجيل الدخول أولاً قبل الانتقال للحجز والاستفادة من خصم النقاط!'); 
            Auth.openAuthModal(); 
            return; 
        }

        // حفظ بيانات الغرفة والمورد في ذاكرة الواجهة
        Checkout.currentBookingData = bookingData;
        const { hotelName, price, roomName, board, policyText, paymentType } = bookingData;
        
        document.getElementById('hotelNameTitle').innerHTML = `تأكيد حجز: <i class="fa-solid fa-hotel text-slate-400 mx-1 text-sm md:text-lg"></i> <br class="md:hidden" /><bdi dir="auto" class="text-[#1f3a40] text-base md:text-2xl mt-1 md:mt-0 inline-block"><span style="unicode-bidi: plaintext;">${hotelName}</span></bdi>`;
        
        document.getElementById('selectedRoomDetails').innerHTML = `
            <div class="absolute -left-2 md:-left-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-6 md:h-6 bg-white rounded-full border-r border-[#00b4d8]/30"></div>
            <div class="absolute -right-2 md:-right-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-6 md:h-6 bg-white rounded-full border-l border-[#00b4d8]/30"></div>
            <ul class="space-y-2.5 md:space-y-3.5 text-xs md:text-base font-bold text-slate-700">
                <li class="flex items-start gap-2 md:gap-3"><i class="fa-solid fa-bed text-teal-600 mt-1 pl-0.5 shrink-0"></i><span>اختيارك: <bdi dir="auto" class="text-teal-800"><span style="unicode-bidi: plaintext;">${roomName}</span></bdi></span></li>
                <li class="flex items-start gap-2 md:gap-3"><i class="fa-solid fa-utensils text-yellow-600 mt-1 pl-1 shrink-0"></i><span>الوجبات: <span class="text-yellow-800">${board}</span></span></li>
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

        if (paymentType === 'HOTEL') { payMethodsContainer.innerHTML = electronicPaymentHTML + hotelPaymentHTML; } 
        else { payMethodsContainer.innerHTML = electronicPaymentHTML; }
        
        document.getElementById('custName').value = currentUser.name; 
        document.getElementById('custEmail').value = currentUser.email; 
        document.getElementById('custPhone').value = currentUser.phone || '';
        
        document.getElementById('summaryBasePrice').innerText = price;
        document.getElementById('checkoutAvailablePoints').innerText = currentUser.points || 0;
        
        Checkout.setupPointsDropdown(); 
        UI.switchView('bookingView');
    },

    setupPointsDropdown: function() {
        const select = document.getElementById('pointsDiscountSelect');
        if (!select) return; select.innerHTML = '<option value="0">بدون استخدام نقاط</option>';
        if(currentUser && currentUser.points >= 50 && Checkout.currentBookingData) {
            let maxPointsToUse = Math.min(currentUser.points, Checkout.currentBookingData.price * 10);
            for(let p = 50; p <= maxPointsToUse; p += 50) { select.innerHTML += `<option value="${p}">${p} نقطة (خصم ${p/10} AED)</option>`; }
        }
        Checkout.updateFinalPriceCalculation();
    },

    updateFinalPriceCalculation: function() {
        if (!Checkout.currentBookingData) return;
        const usedPts = parseInt(document.getElementById('pointsDiscountSelect').value) || 0;
        const discountAED = usedPts / 10;
        let finalAED = Math.max(0, Checkout.currentBookingData.price - discountAED);
        
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
            let finalPrice = Math.max(0, Checkout.currentBookingData.price - (pointsUsed / 10));

            // تقسيم الاسم لدبي لينك
            const nameParts = customerName.split(' ');
            const firstName = nameParts[0] || 'Guest';
            const lastName = nameParts.slice(1).join(' ') || 'Remal';

            // قراءة عدد البالغين من الواجهة (مع وضع شخصين كافتراضي لتجنب أخطاء الغرف المزدوجة)
            const adultsInputEl = document.getElementById('adultsInput');
            const adultsCount = adultsInputEl ? parseInt(adultsInputEl.value) : 2;
            const generatedPassengers = [];

            // إنشاء مسافرين بناءً على العدد المطلوب
            for (let i = 0; i < adultsCount; i++) {
                generatedPassengers.push({
                    title: "Mr.", 
                    firstName: i === 0 ? firstName : `Guest ${i+1}`, 
                    lastName: i === 0 ? lastName : lastName, 
                    age: 30 
                });
            }

            // تجميع الحزمة المتكاملة للسيرفر المزدوج
            const pendingData = { 
                bookingReference, 
                provider: Checkout.currentBookingData.provider,
                hotelId: Checkout.currentBookingData.hotelId,
                roomId: Checkout.currentBookingData.roomId,
                processKey: Checkout.currentBookingData.processKey,
                hotelName: Checkout.currentBookingData.hotelName, 
                guestName: customerName,
                customerName: customerName, 
                email, 
                phone,
                holderPhone: phone, 
                holderEmail: email,
                holderFirstName: firstName,
                holderLastName: lastName,
                passengers: generatedPassengers, // استخدام المصفوفة الديناميكية
                nationality: "AE",
                companions, 
                paymentMethod, 
                price: finalPrice, 
                oldPriceAED: finalPrice,
                pointsUsed, 
                cancellationPolicy: Checkout.currentBookingData.policyText, 
                rateKey: Checkout.currentBookingData.roomId, 
                refundType: Checkout.currentBookingData.refundType 
            };

            const API_KEY = 'rml_live_9f8b7c6d5e4a3b2c1d0e9f8a7b6c5d2e';

            // إذا كان الدفع إلكتروني (Ziina)، نرسل لمسار recheck-and-pay
            if (paymentMethod === 'visa') {
                const res = await fetch(`${API_URL}/api/v1/hotels/recheck-and-pay`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
                    body: JSON.stringify(pendingData)
                });
                const data = await res.json();

                if (data.success && data.payment_url) {
                    localStorage.setItem('pending_reservation', JSON.stringify(pendingData)); 
                    btn.innerHTML = '<i class="fa-solid fa-lock text-sm md:text-lg"></i> <span class="text-xs md:text-sm">جاري تحويلك لصفحة الدفع...</span>';
                    window.location.href = data.payment_url;
                } else {
                    UI.showToast('error', 'خطأ في التحقق', data.error || data.message || 'عذراً، لم تعد الغرفة متاحة بهذا السعر.');
                    btn.innerHTML = origText; 
                    btn.disabled = false;
                }
            } else {
                // دفع في الفندق، توجيه مباشر لتأكيد الحجز الفعلي
                const res = await fetch(`${API_URL}/api/v1/hotels/book`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
                    body: JSON.stringify(pendingData)
                });
                const data = await res.json();
                
                if (data.success) {
                    localStorage.setItem('pending_reservation', JSON.stringify(pendingData));
                    window.location.href = `/?payment=success&ref=${bookingReference}`;
                } else {
                    UI.showToast('error', 'خطأ في الحجز', data.error || 'تعذر تأكيد الحجز.');
                    btn.innerHTML = origText; 
                    btn.disabled = false;
                }
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
                        ${UI_ICONS ? UI_ICONS.modalEdit : '<i class="fa-solid fa-pen"></i>'}
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

window.Checkout = Checkout;
