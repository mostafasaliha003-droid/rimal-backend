// js/main.js

// 1. دالة تهيئة الخريطة (كانت مفقودة)
window.initGoogleMap = function() {
    try {
        const uaeCenter = { lat: 25.2048, lng: 55.2708 };
        const mapEl = document.getElementById("map");
        if(!mapEl) return;
        gMap = new google.maps.Map(mapEl, {
            zoom: 10, center: uaeCenter,
            styles: [
                { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
                { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
                { elementType: "labels.text.fill", stylers: [{ color: "#1f3a40" }] },
                { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9e2fc" }] }
            ]
        });
        if(typeof allHotels !== 'undefined') window.updateGoogleMarkers(allHotels);
    } catch (e) { console.error("خطأ في تهيئة الخريطة:", e); }
};

window.updateGoogleMarkers = function(hotelsArray) {
    if (typeof gMap === 'undefined' || !gMap) return;
    try {
        if(typeof gMarkers !== 'undefined') gMarkers.forEach(m => m.setMap(null));
        gMarkers = [];
        if(!hotelsArray) return;
        hotelsArray.forEach(hotel => {
            const marker = new google.maps.Marker({ position: { lat: hotel.lat, lng: hotel.lng }, map: gMap, title: hotel.name, animation: google.maps.Animation.DROP });
            const infowindow = new google.maps.InfoWindow({ content: `<div style="font-family:Cairo; text-align:right; direction:rtl; padding:5px; font-size:12px;"><strong>${hotel.name}</strong><br>السعر: <b style="color:#ff595e;">${hotel.priceAED} AED</b></div>` });
            marker.addListener("click", () => { infowindow.open(gMap, marker); });
            gMarkers.push(marker);
        });
    } catch(e) { console.error("خطأ في تحديث الخريطة:", e); }
};

// 2. دالة جلب الوجهات المباشرة (كانت مفقودة)
window.fetchLiveDestinations = async function() {
    try {
        const res = await fetch(`${API_URL}/api/v1/hotels/destinations`);
        const data = await res.json();
        if (data.success && data.destinations && data.destinations.length > 0) {
            const select = document.getElementById('destinationSelect');
            if(select) {
                select.innerHTML = '';
                data.destinations.forEach(dest => {
                    let name = dest.name && dest.name.content ? dest.name.content : dest.code;
                    select.innerHTML += `<option value="${dest.code}">${name} (${dest.code}) 📍</option>`;
                });
            }
        }
    } catch (e) { console.error("خطأ في جلب الوجهات الجغرافية:", e); }
};

// 3. دالة تهيئة الدردشة (كانت مفقودة)
window.initLiveChatSocket = function() {
    try {
        if (typeof io === 'undefined') return;
        const socket = io(API_URL);
        const openBtn = document.getElementById('openChatBtn');
        const closeBtn = document.getElementById('closeChatBtn');
        const chatModal = document.getElementById('chatBoxModal');
        const startBtn = document.getElementById('startChatBtn');
        const authView = document.getElementById('authView');
        const messagesView = document.getElementById('messagesView');
        const errorMsg = document.getElementById('chatErrorMsg');
        const sendBtn = document.getElementById('sendMsgBtn');
        const msgInput = document.getElementById('messageInput');
        const chatMsgs = document.getElementById('chatMessages');

        let currentRef = ''; let currentName = '';

        if(openBtn && chatModal) {
            openBtn.onclick = () => { chatModal.classList.remove('hidden'); chatModal.classList.add('flex'); };
            closeBtn.onclick = () => { chatModal.classList.add('hidden'); chatModal.classList.remove('flex'); };
        }

        if(startBtn) {
            startBtn.onclick = () => {
                currentRef = document.getElementById('refCodeInput').value.trim();
                currentName = document.getElementById('clientNameInput').value.trim();
                if(!currentRef || !currentName) { errorMsg.innerText = 'يرجى إدخال رقم الحجز والاسم.'; return; }
                socket.emit('join_chat', { referenceCode: currentRef, clientName: currentName });
            };
        }

        socket.on('chat_joined', (res) => {
            if(res.success) {
                authView.style.display = 'none';
                messagesView.classList.remove('hidden'); messagesView.classList.add('flex');
                chatMsgs.innerHTML += `<div style="text-align: center; color: green; margin-bottom: 5px; font-size:11px;">${res.message}</div>`;
            } else { errorMsg.innerText = res.message; }
        });

        if(sendBtn) sendBtn.onclick = sendMessage;
        if(msgInput) msgInput.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };

        function sendMessage() {
            const text = msgInput.value.trim();
            if(!text) return;
            socket.emit('send_message', { referenceCode: currentRef, sender: currentName, message: text });
            msgInput.value = '';
        }

        socket.on('receive_message', (data) => {
            chatMsgs.innerHTML += `<div style="margin-bottom: 6px;"><b>${data.sender}:</b> ${data.message}</div>`;
            chatMsgs.scrollTop = chatMsgs.scrollHeight;
        });
    } catch(e) { console.error("خطأ في تهيئة الدردشة:", e); }
};

// 4. دالة رسم الحجوزات 
window.renderBookingsList = function(bookings, container) {
    try {
        let cardsHTML = '';
        if(!bookings || bookings.length === 0) return;
        bookings.forEach((booking, index) => {
            let isConfirmed = booking.status !== 'cancelled';
            const animationDelay = index * 100;
            let cardBg = isConfirmed ? 'bg-white' : 'bg-slate-50 opacity-90';
            let cardBorder = isConfirmed ? 'border-slate-200 hover:border-[#00b4d8] hover:shadow-xl' : 'border-slate-300 border-dashed';
            
            // حماية في حال لم يقرأ الأيقونات
            let safeIcons = typeof UI_ICONS !== 'undefined' ? UI_ICONS : {success:'✅', fail:'❌', hotel:'🏨', food:'🍽️', price:'💰', policy:'📄', download:'📥', email:'✉️', edit:'✏️', cancel:'🗑️'};

            let statusBadge = isConfirmed 
                ? `<div class="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 md:px-3 py-1 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-black flex items-center gap-1 md:gap-1.5 shadow-sm shrink-0">${safeIcons.success} حجز مؤكد</div>` 
                : `<div class="bg-red-50 border border-red-200 text-red-700 px-2 md:px-3 py-1 rounded-md md:rounded-lg text-[10px] md:text-[11px] font-black flex items-center gap-1 md:gap-1.5 shadow-sm shrink-0">${safeIcons.fail} حجز ملغي</div>`;
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
                                ${safeIcons.hotel}
                            </div>
                            <div class="min-w-0 flex-1">
                                <h4 class="font-black text-[#1f3a40] text-base md:text-xl lg:text-2xl leading-snug mb-1 md:mb-2 line-clamp-2" title="${cleanHotelName}"><bdi dir="auto"><span style="unicode-bidi: plaintext;">${cleanHotelName}</span></bdi></h4>
                                <span class="inline-block bg-slate-50 border border-slate-200 text-slate-600 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-sm font-bold truncate max-w-full"><bdi dir="auto"><span style="unicode-bidi: plaintext;">الغرفة: ${booking.roomType || 'غرفة فندقية مطابقة'}</span></bdi></span>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2 md:gap-2.5 mt-auto">
                            <span class="inline-flex items-center gap-1 md:gap-1.5 bg-amber-50 text-amber-700 border border-amber-200 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-xs font-bold shadow-sm whitespace-nowrap">${safeIcons.food} ${booking.mealPlan || 'شامل الوجبات'}</span>
                            <span class="inline-flex items-center gap-1 md:gap-1.5 bg-[#00b4d8]/10 text-[#007790] border border-[#00b4d8]/30 px-2 md:px-3 py-1 md:py-1.5 rounded-md md:rounded-lg text-[10px] md:text-xs font-black shadow-sm whitespace-nowrap">${safeIcons.price} <bdi dir="ltr">${booking.price} AED</bdi></span>
                        </div>
                        <div class="mt-3 md:mt-4 p-2.5 md:p-3.5 rounded-lg md:rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-start gap-2 md:gap-3">
                            ${safeIcons.policy}
                            <p class="text-[10px] md:text-[13px] font-bold text-slate-500 m-0 leading-relaxed"><bdi dir="auto"><span style="unicode-bidi: plaintext;">السياسة: ${booking.cancellationPolicy || 'شروط المورد مطبقة'}</span></bdi></p>
                        </div>
                    </div>
                    <div class="hidden md:block w-px border-l-2 border-dashed border-slate-200 my-6 relative z-10"><div class="absolute -top-6 -left-3 w-6 h-6 bg-[#f8fafc] rounded-full border-b border-slate-200"></div><div class="absolute -bottom-6 -left-3 w-6 h-6 bg-[#f8fafc] rounded-full border-t border-slate-200"></div></div>
                    <div class="md:hidden h-px border-t-2 border-dashed border-slate-200 mx-4 md:mx-6 relative z-10"><div class="absolute -left-4 md:-left-6 -top-2.5 md:-top-3 w-5 h-5 md:w-6 md:h-6 bg-[#f8fafc] rounded-full border-r border-slate-200"></div><div class="absolute -right-4 md:-right-6 -top-2.5 md:-top-3 w-5 h-5 md:w-6 md:h-6 bg-[#f8fafc] rounded-full border-l border-slate-200"></div></div>
                    <div class="flex flex-col justify-center gap-2 md:gap-3.5 bg-slate-50 p-4 md:p-8 shrink-0 w-full md:w-[280px] relative z-10 border-r border-transparent">
                        <a href="${typeof API_URL !== 'undefined' ? API_URL : ''}/api/bookings/pdf/${booking.bookingReference}" target="_blank" class="w-full bg-[#1f3a40] hover:bg-slate-800 text-white px-3 md:px-4 py-2.5 md:py-3.5 rounded-lg md:rounded-xl text-xs md:text-sm font-black flex items-center justify-center gap-2 md:gap-2.5 transition-all shadow-[0_4px_15px_rgba(31,58,64,0.2)] hover:shadow-[0_6px_20px_rgba(31,58,64,0.3)] active:scale-95 text-decoration-none border-none cursor-pointer">${safeIcons.download} تحميل قسيمة الحجز</a>
                        <button onclick="Checkout.resendVoucherEmail('${booking.bookingReference}', '${booking.email || (typeof currentUser !== 'undefined' ? currentUser.email : '')}')" class="w-full border-2 border-slate-200 text-slate-600 bg-white hover:bg-slate-50 hover:text-[#00b4d8] hover:border-[#00b4d8]/50 px-3 md:px-4 py-2.5 md:py-3 rounded-lg md:rounded-xl text-xs md:text-sm font-black flex items-center justify-center gap-2 md:gap-2.5 transition-all shadow-sm active:scale-95 cursor-pointer">${safeIcons.email} إرسال للإيميل</button>
                        ${isConfirmed ? `<div class="h-px w-full bg-slate-200 my-1 md:my-2"></div>
                        <button onclick="Checkout.modifyBookingPrompt('${booking.bookingReference}', '${booking.customerName}', '${booking.phone || ''}')" class="w-full border border-transparent text-[#00b4d8] hover:bg-[#00b4d8]/10 px-3 md:px-4 py-2 md:py-2.5 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold flex items-center justify-center gap-1.5 md:gap-2 transition-colors active:scale-95 cursor-pointer bg-transparent">${safeIcons.edit} تعديل بيانات الحجز</button>
                        <button onclick="Checkout.cancelBookingAPI('${booking.bookingReference}', ${booking.price}, '${booking.refundType || 'full_100'}', '${(booking.cancellationPolicy || '').replace(/'/g, "\\'")}')" class="w-full text-red-500 hover:text-red-700 hover:bg-red-50 px-3 md:px-4 py-2 md:py-2.5 rounded-lg md:rounded-xl text-[10px] md:text-xs font-bold flex items-center justify-center gap-1.5 md:gap-2 transition-colors active:scale-95 border-none bg-transparent cursor-pointer">${safeIcons.cancel} إلغاء واسترداد</button>` 
                        : `<div class="bg-red-50 text-red-500 text-center py-2 md:py-3 rounded-lg md:rounded-xl text-[10px] md:text-xs font-black border border-red-200 mt-1 md:mt-2 flex items-center justify-center gap-1.5 md:gap-2 shadow-inner">${safeIcons.fail} تم تنفيذ سياسة الإلغاء</div>`}
                    </div>
                </div>`;
        });
        container.innerHTML = cardsHTML;
    } catch(e) { console.error("خطأ في دالة رسم الحجوزات:", e); }
};

// 5. الانطلاق الآمن والمستقل (Safe Initialization)
window.onload = function() {
    console.log("🚀 جاري بدء تشغيل المنصة بأمان...");

    // إعداد التواريخ
    try {
        const checkInInput = document.getElementById('checkInDate');
        if (checkInInput) checkInInput.valueAsDate = new Date();
        const checkOutInput = document.getElementById('checkOutDate');
        let tomorrow = new Date(); tomorrow.setDate(new Date().getDate() + 1);
        if (checkOutInput) checkOutInput.valueAsDate = tomorrow;
        const mealSelect = document.getElementById('boardBasisFilter');
        if (mealSelect && typeof UI !== 'undefined') UI.updateBoardText(mealSelect);
    } catch(e) { console.warn("خطأ بسيط في إعداد التواريخ:", e); }

    // التحقق من حالة الدخول
    try {
        if (typeof Auth !== 'undefined') {
            Auth.checkUserSession();
        } else {
            console.error("❌ ملف auth.js لم يتم تحميله أو به خطأ.");
            // تفعيل الزر يدوياً كخطة بديلة
            document.getElementById('regBtnText').style.display = 'inline-block';
        }
    } catch(e) { console.error("Error in checkUserSession:", e); }

    // عرض الفنادق
    try {
        if (typeof allHotels !== 'undefined' && typeof Hotels !== 'undefined') {
            Hotels.displayHotels(allHotels);
        } else {
            console.error("❌ مصفوفة الفنادق allHotels أو ملف hotels.js مفقود.");
        }
    } catch(e) { console.error("Error in displayHotels:", e); }

    // جلب الوجهات الحية
    try {
        if (typeof fetchLiveDestinations === 'function') window.fetchLiveDestinations();
    } catch(e) { console.warn("Error in fetchLiveDestinations:", e); }

    // إعداد الدردشة والقوائم
    try {
        if (typeof UI !== 'undefined') UI.setupDropdownToggle();
        if (typeof initLiveChatSocket === 'function') window.initLiveChatSocket();
    } catch(e) { console.warn("Error in UI/Chat setup:", e); }
};
