// js/ui.js

const UI = {
    showToast: function(type, title, message) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        let baseClasses = "flex items-start gap-3 md:gap-3.5 bg-white p-3 md:p-4 rounded-xl shadow-[0_15px_40px_rgba(0,0,0,0.12)] w-full max-w-sm pointer-events-auto transform transition-all duration-500 -translate-y-10 opacity-0 scale-95 border border-slate-50";
        let iconHtml = ""; let borderClass = "";
        
        if (type === 'success') {
            borderClass = "border-r-4 border-r-green-500";
            iconHtml = `<div class="mt-0.5 bg-green-50 w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center shrink-0"><i class="fa-solid fa-circle-check text-green-500 text-sm md:text-lg"></i></div>`;
        } else if (type === 'error') {
            borderClass = "border-r-4 border-r-[#ff595e]";
            iconHtml = `<div class="mt-0.5 bg-red-50 w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center shrink-0"><i class="fa-solid fa-circle-xmark text-[#ff595e] text-sm md:text-lg animate-pulse"></i></div>`;
        } else if (type === 'info') {
            borderClass = "border-r-4 border-r-[#00b4d8]";
            iconHtml = `<div class="mt-0.5 bg-[#00b4d8]/10 w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center shrink-0"><i class="fa-solid fa-circle-info text-[#00b4d8] text-sm md:text-lg"></i></div>`;
        }

        toast.className = `${baseClasses} ${borderClass}`;
        toast.innerHTML = `
            ${iconHtml}
            <div class="flex-1 pt-0.5">
                <h4 class="text-xs md:text-sm font-black text-slate-800 leading-tight">${title}</h4>
                <p class="text-[10px] md:text-xs font-bold text-slate-500 mt-1 md:mt-1.5 leading-relaxed">${message}</p>
            </div>
            <button onclick="UI.closeToast(this.parentElement)" class="text-slate-300 hover:text-slate-500 transition-colors shrink-0 mt-0.5 p-1 cursor-pointer bg-transparent border-none">
                <i class="fa-solid fa-xmark text-xs md:text-sm"></i>
            </button>
        `;

        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.remove('-translate-y-10', 'opacity-0', 'scale-95');
            toast.classList.add('translate-y-0', 'opacity-100', 'scale-100');
        }, 10);
        setTimeout(() => { UI.closeToast(toast); }, 4000);
    },

    closeToast: function(toastElement) {
        if (!toastElement) return;
        toastElement.classList.remove('translate-y-0', 'opacity-100', 'scale-100');
        toastElement.classList.add('-translate-y-4', 'opacity-0', 'scale-95');
        setTimeout(() => { toastElement.remove(); }, 500);
    },

    switchView: function(viewId) {
        document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        window.scrollTo(0, 0);
        if(window.innerWidth <= 768 && document.querySelector(`.bottom-nav-item[onclick*="${viewId}"]`)){
           document.querySelectorAll('.bottom-nav-item').forEach(el => el.classList.remove('active', 'text-[#00b4d8]'));
           const targetBtn = document.querySelector(`.bottom-nav-item[onclick*="${viewId}"]`);
           if(targetBtn) targetBtn.classList.add('active', 'text-[#00b4d8]');
        }
    },

    handleMobileScroll: function() {
        if (window.innerWidth > 768) return;
        const searchForm = document.getElementById('searchFormContainer') || document.querySelector('section.relative.z-30');
        const stickyBar = document.querySelector('.mobile-search-bar');
        
        if(searchForm && stickyBar) {
            const rect = searchForm.getBoundingClientRect();
            if (rect.bottom < 0) {
                stickyBar.classList.remove('hidden');
            } else {
                stickyBar.classList.add('hidden');
            }
        }
    },

    openMobileSearchSheet: function() {
        if (window.innerWidth > 768) return;
        const sheet = document.getElementById('mobileSearchSheet');
        const originalSearchContent = document.querySelector('section.relative.z-30 > div');
        const targetContent = document.getElementById('mobileSearchContentTarget');
        
        if (originalSearchContent && targetContent && targetContent.children.length === 0) {
             originalSearchContent.classList.add('flex-col', 'shadow-none', 'border-none', 'p-0');
             originalSearchContent.classList.remove('md:rounded-3xl');
             targetContent.appendChild(originalSearchContent);
        }
        
        sheet.classList.remove('hidden');
        setTimeout(() => sheet.classList.add('open'), 10);
        
        const overlay = document.createElement('div');
        overlay.id = 'mobileSheetOverlay';
        overlay.className = 'fixed inset-0 bg-slate-900/60 z-[3900] backdrop-blur-sm transition-opacity opacity-0';
        document.body.appendChild(overlay);
        overlay.onclick = UI.closeMobileSearchSheet;
        setTimeout(() => overlay.classList.add('opacity-100'), 10);
    },

    closeMobileSearchSheet: function() {
        const sheet = document.getElementById('mobileSearchSheet');
        const overlay = document.getElementById('mobileSheetOverlay');
        
        sheet.classList.remove('open');
        if(overlay) overlay.classList.remove('opacity-100');
        
        setTimeout(() => {
            sheet.classList.add('hidden');
            if(overlay) overlay.remove();
        }, 400);
        
        const dest = document.getElementById('destinationSelect');
        const adults = document.getElementById('adultsInput');
        if(dest && adults) {
            document.getElementById('mobileSearchSummaryDest').innerText = dest.options[dest.selectedIndex].text;
            document.getElementById('mobileSearchSummaryDetails').innerText = `البحث المخصص • ${adults.value} ضيوف`;
        }
    },

    updateBoardText: function(selectEl) {
        const displayEl = document.getElementById('selectedBoardText');
        if (selectEl && displayEl && selectEl.options[selectEl.selectedIndex]) {
            displayEl.innerText = selectEl.options[selectEl.selectedIndex].text;
        }
    },

    changeCurrency: function() {
        const selectedCurrency = document.getElementById('currencySelector').value;
        const priceElements = document.querySelectorAll('.hotel-price-display');
        const rates = { 'USD': 0.27, 'EUR': 0.25, 'SAR': 1.02, 'AED': 1 };
        
        for (let el of priceElements) {
            let basePriceAED = parseFloat(el.getAttribute('data-price-aed'));
            if (!basePriceAED) continue;
            let converted = (basePriceAED * rates[selectedCurrency]).toFixed(2);
            
            let prevSibling = el.previousElementSibling;
            if (prevSibling && prevSibling.classList.contains('currency-label')) {
                el.innerText = converted;
                prevSibling.innerText = selectedCurrency;
            } else { el.innerText = `${converted} ${selectedCurrency}`; }
        }
        if (typeof Checkout !== 'undefined') Checkout.updateFinalPriceCalculation();
    },

    changeLanguage: function(lang) {
        const htmlRoot = document.getElementById('htmlRoot');
        htmlRoot.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        htmlRoot.setAttribute('lang', lang);
        const selectField = document.querySelector('.goog-te-combo');
        if (selectField) { selectField.value = lang; selectField.dispatchEvent(new Event('change')); }
    },

    setupDropdownToggle: function() {
        const menuBtn = document.getElementById('user-menu-btn');
        const dropdown = document.getElementById('user-dropdown');
        if (!menuBtn || !dropdown) return;
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            dropdown.classList.toggle('opacity-0'); dropdown.classList.toggle('invisible'); dropdown.classList.toggle('translate-y-2');
        });
        document.addEventListener('click', (e) => {
            if (!menuBtn.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add('opacity-0', 'invisible', 'translate-y-2');
            }
        });
    },

    closeAlternativesModal: function() { document.getElementById('alternativesModal').style.display = 'none'; },
    openReviewModal: function() { 
        document.getElementById('reviewModal').style.display = 'flex'; 
        if(currentUser) { 
            document.getElementById('reviewEmail').value = currentUser.email; 
            document.getElementById('reviewName').value = currentUser.name; 
        } 
    },
    closeReviewModal: function() { document.getElementById('reviewModal').style.display = 'none'; },

    quickLookupBooking: async function(e) {
        e.preventDefault();
        const bookingReference = document.getElementById('lookupRef').value.trim();
        const email = document.getElementById('lookupEmail').value.trim();
        const resultDiv = document.getElementById('lookupResult');
        try {
            const res = await fetch(`${API_URL}/api/bookings/lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingReference, email }) });
            const data = await res.json();
            if(data.success) {
                let b = data.booking;
                resultDiv.innerHTML = `
                    <div class="bg-slate-50 border-2 border-[#00b4d8] p-4 md:p-5 rounded-xl md:rounded-2xl mt-4 text-right">
                        <h3 class="text-lg md:text-xl font-black text-[#1f3a40] mb-2 md:mb-3">${b.hotelName}</h3>
                        <p class="font-bold text-slate-700 mb-1 text-xs md:text-sm"><strong>اسم العميل:</strong> ${b.customerName}</p>
                        <p class="font-bold text-slate-700 mb-1 text-xs md:text-sm"><strong>المرجع:</strong> <span class="text-[#800000]" dir="ltr">${b.bookingReference}</span></p>
                        <p class="font-bold text-slate-700 mb-1 text-xs md:text-sm"><strong>المبلغ المدفوع:</strong> <span dir="ltr">${b.price} AED</span></p>
                        <p class="font-bold text-slate-700 mb-2 text-[10px] md:text-xs border border-slate-200 p-2 rounded bg-white"><strong>سياسة الاسترداد:</strong> <span>${b.cancellationPolicy}</span></p>
                        <p class="font-bold text-slate-700 mb-3 md:mb-4 text-xs md:text-sm"><strong>الحالة:</strong> <span class="text-emerald-600 bg-emerald-50 px-2 py-1 rounded">مؤكد رسمياً ✅</span></p>
                        <a href="${API_URL}/api/bookings/pdf/${b.bookingReference}" target="_blank" class="block w-full text-center bg-[#1f3a40] hover:bg-slate-800 text-white px-4 py-2 md:px-5 md:py-2.5 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition shadow text-decoration-none">📄 تحميل قسيمة الحجز PDF</a>
                    </div>`;
            } else { resultDiv.innerHTML = `<div class="bg-red-50 text-red-600 p-3 md:p-4 rounded-lg md:rounded-xl text-center font-bold mt-4 border border-red-200 text-xs md:text-sm">❌ ${data.error}</div>`; }
        } catch(err) { resultDiv.innerHTML = `<div class="bg-red-50 text-red-600 p-3 md:p-4 rounded-lg md:rounded-xl text-center font-bold mt-4 border border-red-200 text-xs md:text-sm">❌ خطأ في الاتصال بالخادم.</div>`; }
    }
};

window.addEventListener('scroll', UI.handleMobileScroll);
