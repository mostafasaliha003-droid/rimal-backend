// js/main.js

window.onload = function() {
    const checkInInput = document.getElementById('checkInDate');
    if (checkInInput) checkInInput.valueAsDate = new Date();
    
    const checkOutInput = document.getElementById('checkOutDate');
    let tomorrow = new Date(); tomorrow.setDate(new Date().getDate() + 1);
    if (checkOutInput) checkOutInput.valueAsDate = tomorrow;

    const mealSelect = document.getElementById('boardBasisFilter');
    if (mealSelect) UI.updateBoardText(mealSelect);

    const urlParams = new URLSearchParams(window.location.search);
    if (window.location.search.includes('payment=success') || urlParams.has('ref')) {
        let refFromUrl = urlParams.get('ref');
        let pending = JSON.parse(localStorage.getItem('pending_reservation'));
        
        if (pending) {
            if (refFromUrl) pending.bookingReference = refFromUrl;
            
            fetch(`${API_URL}/api/v1/bookings/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pending)
            }).then(res => res.json()).then(data => {
                if (data.success) {
                    localStorage.removeItem('pending_reservation');
                    UI.showToast('success', 'تم تأكيد الحجز!', 'تمت عملية الدفع بنجاح عبر Ziina، وتم إرسال قسيمة PDF إلى بريدك.');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    UI.switchView('registerView');
                    Auth.fetchUserData();
                } else { UI.showToast('error', 'خطأ في الحجز', 'خطأ في تثبيت الحجز بعد الدفع: ' + data.error); }
            }).catch(err => { console.error("خطأ الاتصال:", err); UI.showToast('error', 'خطأ اتصال', 'حدث خطأ أثناء تثبيت الحجز بعد الدفع.'); });
        }
    }

    // هنا يتم تشغيل الموقع بالكامل!
    Hotels.displayHotels(allHotels);
    Auth.checkUserSession();
    Hotels.fetchLiveDestinations();
    UI.setupDropdownToggle();
    
    // دالة رسم الحجوزات في لوحة التحكم
    window.renderBookingsList = function(bookings, container) {
        let cardsHTML = '';
        bookings.forEach((booking, index) => {
            let isConfirmed = booking.status !== 'cancelled';
            const animationDelay = index * 100;
            let cardBg = isConfirmed ? 'bg-white' : 'bg-slate-50 opacity-90';
            let cardBorder = isConfirmed ? 'border-slate-200 hover:border-[#00b4d8] hover:shadow-xl' : 'border-slate-300 border-dashed';
            let statusBadge = isConfirmed 
                ? `<div class="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 md:px-3 py-1 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-black flex items-center gap-1 md:gap-1.5 shadow-sm shrink-0">${UI_ICONS.success} حجز مؤكد</div>` 
                : `<div class="bg-red-50 border border-red-200 text-red-700 px-2 md:px-3 py-1 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-black flex items-center gap-1 md:gap-1.5 shadow-sm shrink-0">${UI_ICONS.fail} حجز ملغي</div>`;
            let cancelledWatermark = !isConfirmed ? `<div class="absolute inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden"><span class="text-6xl md:text-8xl lg:text-9xl font-black text-slate-200/50 transform -rotate-12 border-4 md:border-8 border-slate-200/50 p-2 md:p-4 rounded-xl md:rounded-3xl">ملغي</span></div>` : '';
            let cleanHotelName = (booking.hotelName || '').replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}]/gu, '').trim();

            cardsHTML += `
                <div class="relative flex flex-col md:flex-row ${cardBg} rounded-2xl md:rounded-3xl shadow-md border ${cardBorder} transition-all duration-300 mb-6 md:mb-8 overflow-hidden animate-fade-in-up" style="animation-delay: ${animationDelay}ms;">
                    ${cancelledWatermark}
                    <div class="p-4 md:p-8 flex-1 min-w-0 relative z-10 flex flex-col justify-between">
                        <div class="flex flex-wrap items-center justify-between gap-2 md:gap-3 mb-4 md:mb-6 border-b border-slate-100 pb-3 md:pb-4">
                            ${statusBadge}
                            <div class="bg-slate-50 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg border border-slate-200 font-bold text-slate-500 text-[9px] md:text-[11px] flex items-center gap-1 md:gap-2">
                                المرجع: <bdi dir="ltr" class="text-[#1f3a40] tracking-wider font-black">${booking.bookingReference}</bdi>
                            </div>
                        </div>
                        <div class="flex items-start gap-3 md:gap-4 mb-4 md:mb-6">
                            <div class="w-10 h-10 md:w-14 md:h-14 bg-cyan-50 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0 border border-cyan-100 shadow-sm mt-1">
                                ${UI_ICONS.hotel}
                            </div>
                            <div class="min-w-0 flex-1">
                                <h4 class="font-black text-[#1f3a40] text-base md:text-xl lg:text-2xl leading-snug mb-1 md:mb-2 line-clamp-2" title="${cleanHotelName}"><bdi dir="auto"><span style="unicode-bidi: plaintext;">${cleanHotelName}</span></bdi></h4>
                                <span class="inline-block bg-slate-50 border border-slate-200 text-slate-600 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-sm font-bold truncate max-w-full"><bdi dir="auto"><span style="unicode-bidi: plaintext;">الغرفة: ${booking.roomType || 'غرفة فندقية مطابقة'}</span></bdi></span>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2 md:gap-2.5 mt-auto">
                            <span class="inline-flex items-center gap-1 md:gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-xs font-bold shadow-sm whitespace-nowrap">${UI_ICONS.food} ${booking.mealPlan || 'شامل الوجبات'}</span>
                            <span class="inline-flex items-center gap-1 md:gap-1.5 bg-[#00b4d8]/10 text-[#007790] border border-[#00b4d8]/30 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-xs font-black shadow-sm whitespace-nowrap">${UI_ICONS.price} <bdi dir="ltr">${booking.price} AED</bdi></span>
                        </div>
                        <div class="mt-3 md:mt-4 p-2.5 md:p-3.5 rounded-lg md:rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-start gap-2 md:gap-3">
                            ${UI_ICONS.policy}
                            <p class="text-[10px] md:text-[13px] font-bold text-slate-500 m-0 leading-relaxed"><bdi dir="auto"><span style="unicode-bidi: plaintext;">السياسة: ${booking.cancellationPolicy || 'شروط المورد مطبقة'}</span></bdi></p>
                        </div>
                    </div>
                    <div class="hidden md:block w-px border-l-2 border-dashed border-slate-200 my-6 relative z-10"><div class="absolute -top-6 -left-3 w-6 h-6 bg-[#f8fafc] rounded-full border-b border-slate-200"></div><div class="absolute -bottom-6 -left-3 w-6 h-6 bg-[#f8fafc] rounded-full border-t border-slate-200"></div></div>
                    <div class="md:hidden h-px border-t-2 border-dashed border-slate-200 mx-4 md:mx-6 relative z-10"><div class="absolute -left-4 md:-left-6 -top-2.5 md:-top-3 w-5 h-5 md:w-6 md:h-6 bg-[#f8fafc] rounded-full border-r border-slate-200"></div><div class="absolute -right-4 md:-right-6 -top-2.5 md:-top-3 w-5 h-5 md:w-6 md:h-6 bg-[#f8fafc] rounded-full border-l border-slate-200"></div></div>
                    <div class="flex flex-col justify-center gap-2 md:gap-3.5 bg-slate-50 p-4 md:p-8 shrink-0 w-full md:w-[280px] relative z-10 border-r border-transparent">
                        <a href="${API_URL}/api/bookings/pdf/${booking.bookingReference}" target="_blank" class="w-full bg-[#1f3a40] hover:bg-slate-800 text-white px-3 md:px-4 py-2.5 md:py-3.5 rounded-lg md:rounded-xl text-xs md:text-sm font-black flex items-center justify-center gap-2 md:gap-2.5 transition-all shadow-[0_4px_15px_rgba(31,58,64,0.2)] hover:shadow-[0_6px_20px_rgba(31,58,64,0.3)] active:scale-95 text-decoration-none border-none cursor-pointer">${UI_ICONS.download} تحميل قسيمة الحجز</a>
                        <button onclick="Checkout.resendVoucherEmail('${booking.bookingReference}', '${booking.email || currentUser.email}')" class="w-full border-2 border-slate-200 text-slate-600 bg-white hover:bg-slate-50 hover:text-[#00b4d8] hover:border-[#00b4d8]/50 px-3 md:px-4 py-2.5 md:py-3 rounded-lg md:rounded-xl text-xs md:text-sm font-black flex items-center justify-center gap-2 md:gap-2.5 transition-all shadow-sm active:scale-95 cursor-pointer">${UI_ICONS.email} إرسال للإيميل</button>
                        ${isConfirmed ? `<div class="h-px w-full bg-slate-200 my-1 md:my-2"></div>
                        <button onclick="Checkout.modifyBookingPrompt('${booking.bookingReference}', '${booking.customerName}', '${booking.phone || ''}')" class="w-full border border-transparent text-[#00b4d8] hover:bg-[#00b4d8]/10 px-3 md:px-4 py-2 md:py-2.5 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold flex items-center justify-center gap-1.5 md:gap-2 transition-colors active:scale-95 cursor-pointer bg-transparent">${UI_ICONS.edit} تعديل بيانات الحجز</button>
                        <button onclick="Checkout.cancelBookingAPI('${booking.bookingReference}', ${booking.price}, '${booking.refundType || 'full_100'}', '${(booking.cancellationPolicy || '').replace(/'/g, "\\'")}')" class="w-full text-red-500 hover:text-red-700 hover:bg-red-50 px-3 md:px-4 py-2 md:py-2.5 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold flex items-center justify-center gap-1.5 md:gap-2 transition-colors active:scale-95 border-none bg-transparent cursor-pointer">${UI_ICONS.cancel} إلغاء واسترداد</button>` 
                        : `<div class="bg-red-50 text-red-500 text-center py-2 md:py-3 rounded-lg md:rounded-xl text-[10px] md:text-xs font-black border border-red-200 mt-1 md:mt-2 flex items-center justify-center gap-1.5 md:gap-2 shadow-inner">${UI_ICONS.fail} تم تنفيذ سياسة الإلغاء</div>`}
                    </div>
                </div>`;
        });
        container.innerHTML = cardsHTML;
    };
};
